"""
Coaching endpoint — triggers Great Khan AI analysis and returns cached results.
"""

import json
import logging
import threading

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)
router = APIRouter()

_running_tasks_lock = threading.Lock()
_running_tasks = set()


@router.post("/{match_id}", summary="Trigger AI coaching for a match")
async def trigger_coaching(match_id: str, background_tasks: BackgroundTasks):
    """Called by Scout after a successful parse. Runs coaching in background."""
    background_tasks.add_task(_run_coaching, match_id)
    return {"status": "coaching_queued", "match_id": match_id}


@router.get("/{match_id}", summary="Get cached coaching notes for a match")
async def get_coaching(
    match_id: str, background_tasks: BackgroundTasks, user_id: str | None = None
):
    """Return cached AI coaching output, or 202 if not ready yet."""
    try:
        from sqlalchemy import text  # noqa: PLC0415

        from db.database import SessionLocal  # noqa: PLC0415
        from db.models import Match, MatchStatus  # noqa: PLC0415

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
            if not match.coaching_notes:
                # Self-healing: trigger coaching in background if match is COMPLETE and coaching is not running
                if match.status == MatchStatus.COMPLETE:
                    is_running = False
                    with _running_tasks_lock:
                        if match_id in _running_tasks:
                            is_running = True
                    if not is_running:
                        logger.info(
                            f"Triggering self-healing coaching run for complete match {match_id}"
                        )
                        background_tasks.add_task(_run_coaching, match_id)

                return JSONResponse(
                    status_code=202,
                    content={"status": "pending", "match_id": match_id},
                )

            try:
                coaching_data = json.loads(match.coaching_notes)
            except (json.JSONDecodeError, TypeError):
                coaching_data = {
                    "strat_card": match.coaching_notes,
                    "player_reports": {},
                    "coach_report": match.coaching_notes,
                }

            return {
                "status": "ready",
                "match_id": match_id,
                "coaching": coaching_data,
                "is_recon": getattr(match, "is_recon", False),
            }
        finally:
            db.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch coaching for {match_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch coaching notes")


@router.get("/{match_id}/player/{player_name}", summary="Get coaching notes for a specific player")
async def get_player_coaching(match_id: str, player_name: str, user_id: str | None = None):
    """Return only the Player Report section for a specific player."""
    try:
        from db.database import SessionLocal  # noqa: PLC0415
        from db.models import Match  # noqa: PLC0415

        db = SessionLocal()
        try:
            match = db.query(Match).filter(Match.match_id == match_id).first()
            if not match:
                raise HTTPException(status_code=404, detail="Match not found")

            if not match.coaching_notes:
                return JSONResponse(
                    status_code=202,
                    content={"status": "pending", "match_id": match_id},
                )

            try:
                coaching_data = json.loads(match.coaching_notes)
            except (json.JSONDecodeError, TypeError):
                raise HTTPException(status_code=500, detail="Failed to parse coaching data")

            player_reports = coaching_data.get("player_reports", {})
            if player_name not in player_reports:
                raise HTTPException(
                    status_code=404, detail=f"No report found for player {player_name}"
                )

            return {
                "status": "ready",
                "match_id": match_id,
                "player": player_name,
                "report": player_reports[player_name],
            }
        finally:
            db.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch player report for {match_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch player report")


def _run_coaching(match_id: str) -> None:
    """Background task: run Great Khan analysis."""
    with _running_tasks_lock:
        if match_id in _running_tasks:
            logger.info(
                f"Coaching for match {match_id} is already in progress. Skipping duplicate run."
            )
            return
        _running_tasks.add(match_id)
    try:
        from agents.great_khan import analyse_match  # noqa: PLC0415

        analyse_match(match_id)
    except Exception as e:
        logger.error(f"Coaching task failed for {match_id}: {e}")
    finally:
        with _running_tasks_lock:
            _running_tasks.discard(match_id)
