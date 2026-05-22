"""
Analyses list endpoint — returns a user's match history.
"""

import logging

from fastapi import APIRouter
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
                    SELECT id, map_name, status, created_at
                    FROM matches
                    WHERE user_id = :user_id
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
