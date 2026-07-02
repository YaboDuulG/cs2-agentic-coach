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


@router.get("", summary="List analyses for a user")
async def list_analyses(user_id: str = "", db: Session = Depends(get_session)):
    """Return all matches for a given Clerk user_id, newest first."""
    if not user_id:
        return []

    try:
        rows = db.execute(
            text("""
                    SELECT match_id, map_name, status, created_at
                    FROM matches
                    WHERE user_id = :user_id AND team_id IS NULL
                    ORDER BY created_at DESC
                    LIMIT 100
                """),
            {"user_id": user_id},
        ).fetchall()

        return [
            {
                "match_id": r[0],
                "map": r[1],
                "status": r[2],
                "created_at": r[3].isoformat() if r[3] else None,
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
