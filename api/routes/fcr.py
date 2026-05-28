"""
FCR (First Contact Resolution) Analysis API
=============================================
Runs the Tactician FCR analysis on a parsed match and returns the results.

Routes:
    GET /api/analyses/{match_id}/fcr          - Full FCR analysis for a match
    GET /api/analyses/{match_id}/fcr/summary  - Flags + aggregate only (lighter)
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from db.database import get_session
from db.models import Match
from services.tactician.fcr import analyze_fcr, fcr_to_dict

logger = logging.getLogger(__name__)

router = APIRouter()


def _load_match_data(match_id: str, db: Session) -> dict:
    """Load and decode the parsed match JSON from the DB."""
    match = db.execute(select(Match).where(Match.match_id == match_id)).scalar_one_or_none()

    if not match:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found.")

    if match.status != "complete":
        raise HTTPException(
            status_code=409,
            detail=f"Match is not yet parsed (status={match.status}). Try again once analysis completes.",
        )

    # player_stats_json holds the Scout output; first_contacts are embedded in it
    if not match.player_stats_json:
        raise HTTPException(status_code=422, detail="Match has no parsed data available.")

    try:
        return json.loads(match.player_stats_json)
    except json.JSONDecodeError as e:
        logger.error(f"[FCR] Failed to decode match JSON for {match_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to decode match data.")


@router.get("/analyses/{match_id}/fcr")
def get_fcr_analysis(
    match_id: str,
    db: Session = Depends(get_session),
    user_id: str = "",
) -> dict:
    """
    Returns full FCR analysis: per-round breakdown, per-player stats, coaching flags.
    """
    match_data = _load_match_data(match_id, db)
    analysis = analyze_fcr(match_data)
    return fcr_to_dict(analysis)


@router.get("/analyses/{match_id}/fcr/summary")
def get_fcr_summary(
    match_id: str,
    db: Session = Depends(get_session),
    user_id: str = "",
) -> dict:
    """
    Returns FCR summary: aggregate metrics and coaching flags only (no per-round rows).
    Lighter payload for dashboard cards.
    """
    match_data = _load_match_data(match_id, db)
    analysis = analyze_fcr(match_data)
    full = fcr_to_dict(analysis)
    return {
        "match_id": full["match_id"],
        "map_name": full["map_name"],
        "total_rounds": full["total_rounds"],
        "ct_fcr_wins": full["ct_fcr_wins"],
        "t_fcr_wins": full["t_fcr_wins"],
        "fcr_match_rate": full["fcr_match_rate"],
        "flags": full["flags"],
        "top_entry_fraggers": sorted(
            [p for p in full["player_stats"].values() if p["first_kills"] >= 2],
            key=lambda p: p["first_kills"],
            reverse=True,
        )[:5],
    }
