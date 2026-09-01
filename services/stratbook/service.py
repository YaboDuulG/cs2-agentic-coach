"""
Stratbook state machine and canvas schema.
===========================================
Pure domain logic: transitions, revision bookkeeping, and canvas validation.
Every mutation enqueues the matching Discord sync event in the SAME
transaction (transactional outbox) — callers commit; nothing here talks to
Discord or blocks on the network.

State machine:

    DRAFT ──submit──▶ IN_REVIEW ──approve──▶ ACTIVE ──archive──▶ ARCHIVED
      ▲                   │ reject                                  │
      └───────────────────┘◀──────────────revive────────────────────┘

A new revision on an ACTIVE strat moves it back to IN_REVIEW: changes to a
live strat always re-enter review before the team runs them.

Canvas schema (canvas_json):
    {
      "steps":    [{"t": seconds, "label": str,
                    "positions": {player: {"x": f, "y": f}},
                    "utility":   [{"type": smoke|flash|molotov|he,
                                   "from": {"x", "y"}, "to": {"x", "y"},
                                   "callout": str}]}],
      "callouts": [{"name": str, "x": f, "y": f}]
    }
"""

from datetime import UTC, datetime
import json
import logging
from typing import Any
import uuid

from sqlalchemy.orm import Session

from db.models import OutboxStatus, Strat, StratRevision, StratStatus, SyncOutbox

logger = logging.getLogger(__name__)

ALLOWED_TRANSITIONS: dict[StratStatus, set[StratStatus]] = {
    StratStatus.DRAFT: {StratStatus.IN_REVIEW, StratStatus.ARCHIVED},
    StratStatus.IN_REVIEW: {StratStatus.ACTIVE, StratStatus.DRAFT, StratStatus.ARCHIVED},
    StratStatus.ACTIVE: {StratStatus.ARCHIVED},
    StratStatus.ARCHIVED: {StratStatus.DRAFT},
}

VALID_SIDES = {"T", "CT"}
VALID_BUY_TYPES = {"pistol", "eco", "force_buy", "full_buy"}
VALID_UTILITY = {"smoke", "flash", "molotov", "he", "decoy"}


class InvalidTransition(ValueError):
    """Raised when a status change violates the state machine."""


class InvalidCanvas(ValueError):
    """Raised when canvas_json does not match the schema."""


def validate_canvas(canvas: dict[str, Any]) -> None:
    """Schema check for the canvas payload. Raises InvalidCanvas."""
    if not isinstance(canvas, dict):
        raise InvalidCanvas("canvas must be an object")
    for step in canvas.get("steps") or []:
        if not isinstance(step.get("label"), str):
            raise InvalidCanvas("every step needs a string label")
        for _player, pos in (step.get("positions") or {}).items():
            if not {"x", "y"} <= set(pos):
                raise InvalidCanvas("positions need x and y")
        for util in step.get("utility") or []:
            if util.get("type") not in VALID_UTILITY:
                raise InvalidCanvas(f"unknown utility type {util.get('type')!r}")
            for endpoint in ("from", "to"):
                point = util.get(endpoint) or {}
                if not {"x", "y"} <= set(point):
                    raise InvalidCanvas(f"utility {endpoint} needs x and y")
    for callout in canvas.get("callouts") or []:
        if not isinstance(callout.get("name"), str) or not {"x", "y"} <= set(callout):
            raise InvalidCanvas("callouts need name, x, y")


def enqueue_sync(db: Session, kind: str, payload: dict[str, Any]) -> None:
    """Insert an outbox row in the caller's transaction (no commit here)."""
    db.add(
        SyncOutbox(kind=kind, payload_json=json.dumps(payload), status=OutboxStatus.PENDING)
    )


def create_strat(
    db: Session,
    *,
    team_id: str,
    title: str,
    map_name: str,
    side: str,
    buy_type: str,
    canvas: dict[str, Any],
    description: str,
    utility: list[dict] | None,
    author_id: str,
    source: str = "web",
) -> Strat:
    """New strat in DRAFT with revision 1. Caller commits."""
    if side not in VALID_SIDES:
        raise ValueError(f"side must be one of {sorted(VALID_SIDES)}")
    if buy_type not in VALID_BUY_TYPES:
        raise ValueError(f"buy_type must be one of {sorted(VALID_BUY_TYPES)}")
    validate_canvas(canvas)

    strat = Strat(
        id=str(uuid.uuid4()),
        team_id=team_id,
        title=title,
        map_name=map_name,
        side=side,
        buy_type=buy_type,
        status=StratStatus.DRAFT,
        created_by=author_id,
    )
    db.add(strat)
    db.flush()
    revision = _add_revision_row(
        db, strat, canvas=canvas, description=description, utility=utility,
        author_id=author_id, source=source,
    )
    strat.current_revision_id = revision.id
    enqueue_sync(db, "strat_upsert", {"strat_id": strat.id, "revision_id": revision.id})
    return strat


def add_revision(
    db: Session,
    strat: Strat,
    *,
    canvas: dict[str, Any],
    description: str,
    utility: list[dict] | None,
    author_id: str,
    source: str = "web",
) -> StratRevision:
    """New revision; an ACTIVE strat drops back to IN_REVIEW. Caller commits."""
    if strat.status == StratStatus.ARCHIVED:
        raise InvalidTransition("archived strats can't take revisions — revive to DRAFT first")
    validate_canvas(canvas)
    revision = _add_revision_row(
        db, strat, canvas=canvas, description=description, utility=utility,
        author_id=author_id, source=source,
    )
    strat.current_revision_id = revision.id
    if strat.status == StratStatus.ACTIVE:
        strat.status = StratStatus.IN_REVIEW
    strat.updated_at = datetime.now(UTC)
    enqueue_sync(db, "strat_upsert", {"strat_id": strat.id, "revision_id": revision.id})
    return revision


def transition(db: Session, strat: Strat, new_status: StratStatus, *, actor: str) -> Strat:
    """Apply a state-machine transition. Caller commits."""
    current = StratStatus(strat.status)
    if new_status not in ALLOWED_TRANSITIONS[current]:
        raise InvalidTransition(f"{current.value} → {new_status.value} is not allowed")
    strat.status = new_status
    strat.updated_at = datetime.now(UTC)
    enqueue_sync(
        db,
        "strat_status",
        {"strat_id": strat.id, "status": new_status.value, "actor": actor},
    )
    logger.info(f"[Stratbook] {strat.id}: {current.value} → {new_status.value} by {actor}")
    return strat


def _add_revision_row(
    db: Session,
    strat: Strat,
    *,
    canvas: dict[str, Any],
    description: str,
    utility: list[dict] | None,
    author_id: str,
    source: str,
) -> StratRevision:
    """Docstring for _add_revision_row."""
    last = (
        db.query(StratRevision.revision_no)
        .filter(StratRevision.strat_id == strat.id)
        .order_by(StratRevision.revision_no.desc())
        .first()
    )
    revision = StratRevision(
        strat_id=strat.id,
        revision_no=(last[0] + 1) if last else 1,
        canvas_json=json.dumps(canvas),
        description=description,
        utility_json=json.dumps(utility or []),
        author_id=author_id,
        source=source,
    )
    db.add(revision)
    db.flush()
    return revision
