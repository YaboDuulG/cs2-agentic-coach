"""Module docstring."""
from fastapi import Depends
from sqlalchemy.orm import Session

from db.database import get_session

"""
Analyses list endpoint — returns a user's match history.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

logger = logging.getLogger(__name__)
router = APIRouter()


def match_mode(is_recon: bool, team_id: str | None) -> str:
    """The same rule as agents/scribe/modes.derive_mode, for list rows."""
    if is_recon:
        return "scouting"
    if team_id:
        return "team"
    return "personal"


_LIST_SELECT = "SELECT m.match_id, d.map_name, d.status, m.created_at, m.is_recon, m.team_id"


@router.get("", summary="List analyses for a user")
async def list_analyses(user_id: str = "", scope: str = "personal", db: Session = Depends(get_session)):
    """
    Return matches for a Clerk user_id, newest first (≤100). scope=personal
    lists the user's own uploads; scope=team lists matches of every team the
    user belongs to; scope=all is both. Rows carry `team_id` and `mode`
    (personal | team | scouting) so lists never derive the mode themselves.
    """
    if not user_id:
        return []

    try:
        if scope == "team":
            rows = db.execute(
                text(f"""
                        {_LIST_SELECT}
                        FROM matches m
                        JOIN demos d ON d.demo_id = m.demo_id
                        JOIN team_members tm ON tm.team_id = m.team_id
                        WHERE tm.user_id = :user_id
                        ORDER BY m.created_at DESC
                        LIMIT 100
                    """),
                {"user_id": user_id},
            ).fetchall()
        elif scope == "all":
            rows = db.execute(
                text(f"""
                        {_LIST_SELECT}
                        FROM matches m
                        JOIN demos d ON d.demo_id = m.demo_id
                        WHERE (m.user_id = :user_id AND m.team_id IS NULL)
                           OR m.team_id IN (SELECT team_id FROM team_members WHERE user_id = :user_id)
                        ORDER BY m.created_at DESC
                        LIMIT 100
                    """),
                {"user_id": user_id},
            ).fetchall()
        else:
            rows = db.execute(
                text(f"""
                        {_LIST_SELECT}
                        FROM matches m
                        JOIN demos d ON d.demo_id = m.demo_id
                        WHERE m.user_id = :user_id AND m.team_id IS NULL
                        ORDER BY m.created_at DESC
                        LIMIT 100
                    """),
                {"user_id": user_id},
            ).fetchall()

        return [
            {
                "match_id": r[0],
                "map": r[1],
                "status": str(r[2]).lower() if r[2] else None,
                "created_at": r[3].isoformat() if r[3] else None,
                "is_recon": bool(r[4]),
                "team_id": r[5],
                "mode": match_mode(bool(r[4]), r[5]),
            }
            for r in rows
        ]
    except Exception as e:
        logger.error(f"Failed to list analyses for {user_id}: {e}")
        return []


class UpdateNotesRequest(BaseModel):
    """Docstring for UpdateNotesRequest."""
    notes: str


@router.get("/{match_id}/notes", summary="Get custom notes for a match")
async def get_match_notes(match_id: str, user_id: str | None = None, db: Session = Depends(get_session)):
    """Retrieve user-submitted coach notes for a specific match."""
    from db.models import Match  # noqa: PLC0415
    match = db.query(Match).filter(Match.match_id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    # Access check
    if match.team_id:
        if not user_id:
            raise HTTPException(
                status_code=403,
                detail="Access denied: Team match requires user authentication.",
            )
        member_check = db.execute(
            text("SELECT 1 FROM team_members WHERE team_id = :team_id AND user_id = :user_id"),
            {"team_id": match.team_id, "user_id": user_id},
        ).fetchone()
        if not member_check:
            raise HTTPException(
                status_code=403,
                detail="Access denied: You are not a member of this team.",
            )
    else:
        if match.user_id and match.user_id != user_id:
            raise HTTPException(
                status_code=403,
                detail="Access denied: This match belongs to another user.",
            )

    return {"notes": match.notes or ""}


@router.post("/{match_id}/notes", summary="Update custom notes and trigger analysis re-run")
async def update_match_notes(match_id: str, body: UpdateNotesRequest, user_id: str | None = None, db: Session = Depends(get_session)):
    """Save user-submitted coach notes for a match and run Great Khan analysis in background to refresh coaching."""
    from db.models import Match  # noqa: PLC0415
    match = db.query(Match).filter(Match.match_id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    # Access check
    if match.team_id:
        if not user_id:
            raise HTTPException(
                status_code=403,
                detail="Access denied: Team match requires user authentication.",
            )
        member_check = db.execute(
            text("SELECT 1 FROM team_members WHERE team_id = :team_id AND user_id = :user_id"),
            {"team_id": match.team_id, "user_id": user_id},
        ).fetchone()
        if not member_check:
            raise HTTPException(
                status_code=403,
                detail="Access denied: You are not a member of this team.",
            )
    else:
        if match.user_id and match.user_id != user_id:
            raise HTTPException(
                status_code=403,
                detail="Access denied: This match belongs to another user.",
            )

    match.notes = body.notes
    db.commit()

    # Trigger re-analysis in the background so that Scribe/Great Khan can parse these new notes
    import os  # noqa: PLC0415

    from api.queue import enqueue_task  # noqa: PLC0415
    queue = os.environ.get("CLOUD_TASKS_QUEUE", "default")
    api_url = os.getenv("API_INTERNAL_URL", "http://localhost:8000")
    enqueue_task(
        queue_name=queue,
        url=f"{api_url}/api/coaching/{match_id}",
        payload={}
    )

    return {"status": "success", "notes": match.notes}
