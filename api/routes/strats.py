"""Module docstring."""
from fastapi import Depends
from sqlalchemy.orm import Session

from db.database import get_session

"""
Strats endpoints — web CRUD over the versioned stratbook (module 3).
Thin HTTP layer over services/stratbook/service.py; every mutation enqueues
its Discord sync event in the same transaction (transactional outbox).
"""

import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from db.models import Strat, StratRevision, StratStatus, Team
from services.discord_bot.security import make_bind_code
from services.stratbook.service import (
    InvalidCanvas,
    InvalidTransition,
    add_revision,
    create_strat,
    transition,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateStratRequest(BaseModel):
    """Docstring for CreateStratRequest."""
    team_id: str
    title: str
    map_name: str
    side: str = "T"
    buy_type: str = "full_buy"
    canvas: dict = {}
    description: str = ""
    utility: list[dict] | None = None


class AddRevisionRequest(BaseModel):
    """Docstring for AddRevisionRequest."""
    canvas: dict
    description: str = ""
    utility: list[dict] | None = None


class TransitionRequest(BaseModel):
    """Docstring for TransitionRequest."""
    status: str


def _require_user(request: Request) -> str:
    """Docstring for _require_user."""
    user_id = request.headers.get("x-clerk-user-id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing x-clerk-user-id header.")
    return user_id


def _require_member(db: Session, team_id: str, user_id: str) -> None:
    """Same membership-check pattern as api/routes/presign.py."""
    from sqlalchemy import text  # noqa: PLC0415

    member_check = db.execute(
        text("SELECT 1 FROM team_members WHERE team_id = :team_id AND user_id = :user_id"),
        {"team_id": team_id, "user_id": user_id},
    ).fetchone()
    if not member_check:
        raise HTTPException(status_code=403, detail="You are not a member of this team.")


def _get_strat(db: Session, strat_id: str) -> Strat:
    """Docstring for _get_strat."""
    strat = db.get(Strat, strat_id)
    if strat is None:
        raise HTTPException(status_code=404, detail="Strat not found.")
    return strat


def _strat_summary(strat: Strat) -> dict[str, Any]:
    """Docstring for _strat_summary."""
    return {
        "id": strat.id,
        "team_id": strat.team_id,
        "title": strat.title,
        "map_name": strat.map_name,
        "side": strat.side,
        "buy_type": strat.buy_type,
        "status": StratStatus(strat.status).value,
        "current_revision_id": strat.current_revision_id,
        "discord_thread_id": strat.discord_thread_id,
        "created_by": strat.created_by,
        "created_at": strat.created_at,
        "updated_at": strat.updated_at,
    }


def _revision_dict(rev: StratRevision) -> dict[str, Any]:
    """Docstring for _revision_dict."""
    return {
        "id": rev.id,
        "revision_no": rev.revision_no,
        "canvas": json.loads(rev.canvas_json or "{}"),
        "description": rev.description,
        "utility": json.loads(rev.utility_json or "[]"),
        "author_id": rev.author_id,
        "source": rev.source,
        "created_at": rev.created_at,
    }


@router.post("/", summary="Create a strat (DRAFT, revision 1)")
async def create_strat_endpoint(
    body: CreateStratRequest, request: Request, db: Session = Depends(get_session)
):
    """Docstring for create_strat_endpoint."""
    user_id = _require_user(request)
    _require_member(db, body.team_id, user_id)
    try:
        strat = create_strat(
            db,
            team_id=body.team_id,
            title=body.title,
            map_name=body.map_name,
            side=body.side,
            buy_type=body.buy_type,
            canvas=body.canvas,
            description=body.description,
            utility=body.utility,
            author_id=user_id,
            source="web",
        )
    except (InvalidCanvas, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return _strat_summary(strat)


@router.get("/", summary="List a team's strats")
async def list_strats(team_id: str, request: Request, db: Session = Depends(get_session)):
    """Docstring for list_strats."""
    user_id = _require_user(request)
    _require_member(db, team_id, user_id)
    strats = (
        db.query(Strat).filter(Strat.team_id == team_id).order_by(Strat.updated_at.desc()).all()
    )
    return {"strats": [_strat_summary(s) for s in strats]}


@router.get("/{strat_id}", summary="Get one strat with its revisions")
async def get_strat(strat_id: str, request: Request, db: Session = Depends(get_session)):
    """Docstring for get_strat."""
    user_id = _require_user(request)
    strat = _get_strat(db, strat_id)
    _require_member(db, strat.team_id, user_id)
    revisions = sorted(strat.revisions, key=lambda r: r.revision_no)
    return {**_strat_summary(strat), "revisions": [_revision_dict(r) for r in revisions]}


@router.post("/{strat_id}/revisions", summary="Add a revision")
async def add_revision_endpoint(
    strat_id: str, body: AddRevisionRequest, request: Request, db: Session = Depends(get_session)
):
    """Docstring for add_revision_endpoint."""
    user_id = _require_user(request)
    strat = _get_strat(db, strat_id)
    _require_member(db, strat.team_id, user_id)
    try:
        revision = add_revision(
            db,
            strat,
            canvas=body.canvas,
            description=body.description,
            utility=body.utility,
            author_id=user_id,
            source="web",
        )
    except InvalidCanvas as e:
        raise HTTPException(status_code=400, detail=str(e))
    except InvalidTransition as e:
        raise HTTPException(status_code=409, detail=str(e))
    db.commit()
    return {**_strat_summary(strat), "revision": _revision_dict(revision)}


@router.post("/{strat_id}/transition", summary="Apply a state-machine transition")
async def transition_endpoint(
    strat_id: str, body: TransitionRequest, request: Request, db: Session = Depends(get_session)
):
    """Docstring for transition_endpoint."""
    user_id = _require_user(request)
    strat = _get_strat(db, strat_id)
    _require_member(db, strat.team_id, user_id)
    try:
        new_status = StratStatus(body.status)
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"status must be one of {[s.value for s in StratStatus]}"
        )
    try:
        transition(db, strat, new_status, actor=user_id)
    except InvalidTransition as e:
        raise HTTPException(status_code=409, detail=str(e))
    db.commit()
    return _strat_summary(strat)


@router.post("/{strat_id}/bind-code", summary="Mint the team's Discord bind code (owner only)")
async def bind_code_endpoint(strat_id: str, request: Request, db: Session = Depends(get_session)):
    """Docstring for bind_code_endpoint."""
    user_id = _require_user(request)
    strat = _get_strat(db, strat_id)
    team = db.get(Team, strat.team_id)
    if team is None or team.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Only the team owner can mint bind codes.")
    try:
        code = make_bind_code(team.id)
    except ValueError:
        raise HTTPException(status_code=503, detail="Discord binding is not configured.")
    return {"team_id": team.id, "code": code}
