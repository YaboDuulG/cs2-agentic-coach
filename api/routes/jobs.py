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
                text(
                    "SELECT match_id, map_name, status, error_message, player_stats_json, created_at, parse_duration_seconds FROM matches WHERE match_id = :id"
                ),
                {"id": match_id},
            ).fetchone()

            if result is None:
                # Not in DB yet — still queued or Scout hasn't started
                return {"status": "queued", "match_id": match_id}

            match_status = result[2].lower() if result[2] else "processing"
            error_message = result[3]
            player_stats_raw = result[4]
            created_at = result[5] if len(result) > 5 else None
            parse_duration_seconds = result[6] if len(result) > 6 else None

            if match_status == "failed":
                return {"status": "failed", "match_id": match_id, "error": error_message}

            if match_status in ("pending", "queued"):
                return {
                    "status": "queued",
                    "match_id": match_id,
                    "created_at": created_at.isoformat() if created_at else None,
                }

            if match_status not in ("done", "complete", "parsed"):
                return {
                    "status": "processing",
                    "match_id": match_id,
                    "map": result[1],
                    "created_at": created_at.isoformat() if created_at else None,
                }

            # Fetch kills
            kills = db.execute(
                text("""
                    SELECT attacker, victim, weapon, round_num, attacker_team, attacker_x, attacker_y, victim_x, victim_y, attacker_steamid, victim_steamid, tick, headshot, victim_team
                    FROM kills WHERE match_id = :id
                    ORDER BY tick
                    LIMIT 200
                """),
                {"id": match_id},
            ).fetchall()

            # Fetch rounds sorted by DB primary key (chronological order)
            rounds = db.execute(
                text("""
                    SELECT id, round_num, winner_side, ct_eq_val, t_eq_val
                    FROM rounds WHERE match_id = :id
                    ORDER BY id
                """),
                {"id": match_id},
            ).fetchall()

            # Fetch total grenades count
            total_grenades = (
                db.execute(
                    text("SELECT COUNT(*) FROM grenades WHERE match_id = :id"),
                    {"id": match_id},
                ).scalar()
                or 0
            )

            import json
            import math

            player_stats = {}
            if player_stats_raw:
                try:
                    player_stats = json.loads(player_stats_raw)
                except Exception:
                    pass

            # Filter warmup/knife rounds (where winner_side is empty or invalid)
            # and map them to clean sequential indices 1 to N
            clean_rounds = []
            orig_idx_to_seq_num = {}

            for r in rounds:
                db_round_num = r[1]
                winner_side = r[2]
                if winner_side in ("CT", "T"):
                    seq_num = len(clean_rounds) + 1
                    clean_rounds.append(
                        {
                            "round": seq_num,
                            "winner": winner_side,
                            "ct_spend": r[3] or 0,
                            "t_spend": r[4] or 0,
                        }
                    )
                    orig_idx_to_seq_num[db_round_num] = seq_num

            # Map kills to the new sequential round indices
            mapped_kills = []
            if clean_rounds:
                for k in kills:
                    db_round_num = k[3]
                    if db_round_num in orig_idx_to_seq_num:
                        mapped_kills.append(
                            {
                                "killer": k[0],
                                "victim": k[1],
                                "weapon": k[2],
                                "round": orig_idx_to_seq_num[db_round_num],
                                "killer_team": k[4],
                                "attacker_x": k[5],
                                "attacker_y": k[6],
                                "victim_x": k[7],
                                "victim_y": k[8],
                                "attacker_steamid": k[9],
                                "victim_steamid": k[10],
                                "tick": k[11],
                                "headshot": k[12],
                                "victim_team": k[13],
                            }
                        )
            else:
                # Fallback to raw DB round numbers if no clean rounds are resolved
                clean_rounds = [
                    {"round": r[1], "winner": r[2], "ct_spend": r[3] or 0, "t_spend": r[4] or 0}
                    for r in rounds
                ]
                mapped_kills = [
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
                        "attacker_steamid": k[9],
                        "victim_steamid": k[10],
                        "tick": k[11],
                        "headshot": k[12],
                        "victim_team": k[13],
                    }
                    for k in kills
                ]

            def sanitize_nan(val):
                if isinstance(val, float):
                    return None if (math.isnan(val) or math.isinf(val)) else val
                elif isinstance(val, dict):
                    return {k: sanitize_nan(v) for k, v in val.items()}
                elif isinstance(val, list):
                    return [sanitize_nan(x) for x in val]
                elif hasattr(val, "__float__") and not isinstance(val, (int, str, bool)):
                    try:
                        fval = float(val)
                        return None if (math.isnan(fval) or math.isinf(fval)) else fval
                    except Exception:
                        pass
                return val

            player_stats = sanitize_nan(player_stats)

            response_data = {
                "status": "done",
                "match_id": match_id,
                "map": result[1],
                "total_rounds": len(clean_rounds),
                "total_kills": len(mapped_kills),
                "total_grenades": total_grenades,
                "player_stats": player_stats,
                "kills": mapped_kills,
                "rounds": clean_rounds,
                "parse_duration_seconds": parse_duration_seconds,
            }
            return sanitize_nan(response_data)
        finally:
            db.close()

    except Exception as e:
        logger.error(f"Job status query failed for {match_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch job status.")
