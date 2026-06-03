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
async def list_analyses(user_id: str = ""):
    """Return all matches for a given Clerk user_id, newest first."""
    if not user_id:
        return []

    try:
        from db.database import SessionLocal  # noqa: PLC0415

        db = SessionLocal()
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
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to list analyses for {user_id}: {e}")
        return []


class UpdateNotesRequest(BaseModel):
    notes: str


@router.get("/{match_id}/notes", summary="Get custom notes for a match")
async def get_match_notes(match_id: str, user_id: str | None = None):
    """Retrieve user-submitted coach notes for a specific match."""
    from db.database import SessionLocal  # noqa: PLC0415
    from db.models import Match  # noqa: PLC0415

    db = SessionLocal()
    try:
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
                text(
                    "SELECT 1 FROM team_members WHERE team_id = :team_id AND user_id = :user_id"
                ),
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
    finally:
        db.close()


@router.post("/{match_id}/notes", summary="Update custom notes and trigger analysis re-run")
async def update_match_notes(match_id: str, body: UpdateNotesRequest, user_id: str | None = None):
    """Save user-submitted coach notes for a match and run Great Khan analysis in background to refresh coaching."""
    import threading  # noqa: PLC0415

    from api.routes.coaching import _run_coaching  # noqa: PLC0415
    from db.database import SessionLocal  # noqa: PLC0415
    from db.models import Match  # noqa: PLC0415

    db = SessionLocal()
    try:
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
                text(
                    "SELECT 1 FROM team_members WHERE team_id = :team_id AND user_id = :user_id"
                ),
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
        threading.Thread(target=_run_coaching, args=(match_id,), daemon=True).start()

        return {"status": "success", "notes": match.notes}
    finally:
        db.close()
