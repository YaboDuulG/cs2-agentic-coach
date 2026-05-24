"""
Job status endpoint — returns parse status and results for a given match_id.
Queries the DB for the match record populated by the Scout service.
"""

import logging
import os

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_db():
    from db.database import SessionLocal  # noqa: PLC0415
    return SessionLocal()


@router.get("/{match_id}", summary="Get demo parse job status and results")
async def get_job_status(match_id: str):
    """
    Poll this endpoint after uploading a demo.
    Returns status: queued | processing | done | failed
    Once done, returns kill feed, round data, and summary stats.
    """
    local_mode = os.getenv("LOCAL_MODE", "false").lower() == "true"

    if local_mode:
        return {
            "status": "done",
            "match_id": match_id,
            "map": "de_dust2",
            "total_rounds": 26,
            "total_kills": 185,
            "total_grenades": 232,
            "kills": [],
            "rounds": [],
            "message": "LOCAL_MODE: stub response",
        }

    try:
        db = _get_db()
        try:
            # Check if match record exists and has been parsed
            result = db.execute(
                text("SELECT match_id, map_name, status, error_message FROM matches WHERE match_id = :id"),
                {"id": match_id},
            ).fetchone()

            if result is None:
                # Not in DB yet — still queued or Scout hasn't started
                return {"status": "queued", "match_id": match_id}

            match_status = result[2].lower() if result[2] else "processing"
            error_message = result[3]

            if match_status == "failed":
                return {"status": "failed", "match_id": match_id, "error": error_message}

            if match_status not in ("done", "complete", "parsed"):
                return {"status": "processing", "match_id": match_id, "map": result[1]}

            # Fetch kills
            kills = db.execute(
                text("""
                    SELECT attacker, victim, weapon, round_num, attacker_team, attacker_x, attacker_y, victim_x, victim_y
                    FROM kills WHERE match_id = :id
                    ORDER BY round_num, id
                    LIMIT 200
                """),
                {"id": match_id},
            ).fetchall()

            # Fetch rounds
            rounds = db.execute(
                text("""
                    SELECT round_num, winner_side, ct_eq_val, t_eq_val
                    FROM rounds WHERE match_id = :id
                    ORDER BY round_num
                """),
                {"id": match_id},
            ).fetchall()

            return {
                "status": "done",
                "match_id": match_id,
                "map": result[1],
                "total_rounds": len(rounds),
                "total_kills": len(kills),
                "kills": [
                    {
                        "killer": k[0],
                        "victim": k[1],
                        "weapon": k[2],
                        "round": k[3],
                        "killer_team": k[4],
                        "attacker_x": k[5],
                        "attacker_y": k[6],
                        "victim_x": k[7],
                        "victim_y": k[8],
                    }
                    for k in kills
                ],
                "rounds": [
                    {"round": r[0], "winner": r[1], "ct_spend": r[2] or 0, "t_spend": r[3] or 0}
                    for r in rounds
                ],
            }
        finally:
            db.close()

    except Exception as e:
        logger.error(f"Job status query failed for {match_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch job status.")
