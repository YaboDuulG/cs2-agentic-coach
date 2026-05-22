"""
Coaching endpoint — triggers Great Khan AI analysis and returns cached results.
"""

import json
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/{match_id}", summary="Trigger AI coaching for a match")
async def trigger_coaching(match_id: str, background_tasks: BackgroundTasks):
    """Called by Scout after a successful parse. Runs coaching in background."""
    background_tasks.add_task(_run_coaching, match_id)
    return {"status": "coaching_queued", "match_id": match_id}


@router.get("/{match_id}", summary="Get cached coaching notes for a match")
async def get_coaching(match_id: str):
    """Return cached AI coaching output, or 202 if not ready yet."""
    try:
        from db.database import SessionLocal  # noqa: PLC0415
        from db.models import Match  # noqa: PLC0415

        db = SessionLocal()
        try:
            match = db.query(Match).filter(Match.match_id == match_id).first()
            if not match:
                raise HTTPException(status_code=404, detail="Match not found")
            if not match.coaching_notes:
                return {"status": "pending", "match_id": match_id}
            return {"status": "ready", "match_id": match_id, "coaching": json.loads(match.coaching_notes)}
        finally:
            db.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch coaching for {match_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch coaching notes")


def _run_coaching(match_id: str) -> None:
    """Background task: run Great Khan analysis."""
    try:
        from agents.great_khan import analyse_match  # noqa: PLC0415
        analyse_match(match_id)
    except Exception as e:
        logger.error(f"Coaching task failed for {match_id}: {e}")
