"""
HLTV delta monitor — queue only what we haven't seen.
======================================================
Polls recently completed S/A-tier results and inserts a ProMatch row
(ingested_at NULL = pending) for every hltv_match_id not already in the
local registry. Idempotent: a second run over the same results queues
nothing. Tournaments are get-or-created by hltv_event_id.
"""

from datetime import datetime
import logging

from db.models import ProMatch, ProTournament
from services.rag_engine.hltv_client import get_client

logger = logging.getLogger(__name__)


def _parse_dt(value: str | None) -> datetime | None:
    """Docstring for _parse_dt."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _get_or_create_tournament(db, event: dict) -> ProTournament:
    """Docstring for _get_or_create_tournament."""
    event_id = int(event["hltv_event_id"])
    tournament = db.query(ProTournament).filter_by(hltv_event_id=event_id).first()
    if tournament is None:
        tournament = ProTournament(
            hltv_event_id=event_id,
            name=event.get("name") or f"HLTV event {event_id}",
            tier=event.get("tier") or "A",
            ends_at=_parse_dt(event.get("ends_at")),
        )
        db.add(tournament)
        db.flush()  # need tournament.id for the FK before commit
    return tournament


def run_delta(db, client=None, limit: int = 20) -> list[str]:
    """
    Fetch recent results and insert the ones we don't have yet.
    Returns the hltv_match_ids newly queued for ingestion.
    """
    client = client or get_client()
    results = client.recent_results(limit=limit)

    existing = {row[0] for row in db.query(ProMatch.hltv_match_id).all()}
    queued: list[str] = []

    for result in results:
        match_id = str(result.get("hltv_match_id") or "")
        if not match_id or match_id in existing:
            continue
        tournament = _get_or_create_tournament(db, result.get("event") or {})
        db.add(
            ProMatch(
                hltv_match_id=match_id,
                tournament_id=tournament.id,
                team_a=result.get("team_a") or "",
                team_b=result.get("team_b") or "",
                map_name=result.get("map_name") or "unknown",
                played_at=_parse_dt(result.get("played_at")),
                # demo_gcs_uri stays NULL until the (separate) download task
                # mirrors the demo into object storage — never HLTV bytes here.
                demo_gcs_uri=None,
                patch_version=result.get("patch_version"),
                ingested_at=None,
            )
        )
        existing.add(match_id)
        queued.append(match_id)

    if queued:
        db.commit()
    logger.info(f"[Delta] {len(results)} results seen, {len(queued)} newly queued: {queued}")
    return queued
