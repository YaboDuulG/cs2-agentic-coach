"""
Parse job handler — the glue that was missing from the v1 pipeline.

Calls the Go demo-parser service (a pure function: GCS URI in, JSON events
out), persists the result with multi-row batch inserts (10-50x faster than
row-by-row — supabase-postgres-best-practices data-batch-inserts), flips the
match to COMPLETE, and queues the coaching job. The parser stays stateless;
orchestration and persistence live here, where the ORM models already are.
"""

from collections import defaultdict
import json
import logging
import os
import time

import httpx
from sqlalchemy import insert
from sqlalchemy.orm import Session

from db.jobs import enqueue_job
from db.models import (
    FirstContact,
    Grenade,
    JobKind,
    Kill,
    Match,
    MatchStatus,
    PlayerTrajectory,
    Round,
)

logger = logging.getLogger(__name__)

PARSE_TIMEOUT_SECONDS = 600


def handle_parse_job(db: Session, match_id: str) -> None:
    """Run the full parse-and-persist path for one match. Raises on failure."""
    match = db.query(Match).filter(Match.match_id == match_id).first()
    if match is None:
        raise RuntimeError(f"Match {match_id} not found")
    if not match.gcs_demo_uri:
        raise RuntimeError(f"Match {match_id} has no gcs_demo_uri")

    match.status = MatchStatus.PARSING
    db.commit()

    started = time.monotonic()
    result = _call_parser(match_id, match.gcs_demo_uri)
    _persist_result(db, match, result)

    match.map_name = result.get("map_name") or "unknown"
    match.tickrate = int(result.get("tickrate") or 64)
    match.total_rounds = len(result.get("rounds") or [])
    match.parse_duration_seconds = time.monotonic() - started
    match.status = MatchStatus.COMPLETE
    db.commit()

    # Parse done → coaching can start immediately, not on the next user poll.
    enqueue_job(db, match_id, JobKind.COACH)
    logger.info(
        f"Match {match_id} parsed: {match.total_rounds} rounds, "
        f"{len(result.get('kills') or [])} kills in {match.parse_duration_seconds:.1f}s"
    )


def _call_parser(match_id: str, gcs_uri: str) -> dict:
    """POST to the Go parser service and return its ParseResult JSON."""
    parser_url = os.environ.get("PARSER_SERVICE_URL", "http://localhost:8080").rstrip("/")
    resp = httpx.post(
        f"{parser_url}/parse",
        json={"match_id": match_id, "gcs_uri": gcs_uri},
        headers=_parser_auth_headers(parser_url),
        timeout=PARSE_TIMEOUT_SECONDS,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Parser returned {resp.status_code}: {resp.text[:500]}")
    return resp.json()


def _parser_auth_headers(parser_url: str) -> dict[str, str]:
    """
    The parser runs with --no-allow-unauthenticated on Cloud Run; calls need
    an OIDC identity token with the service URL as audience. Local parsers
    (LOCAL_MODE or a non-run.app URL) take no auth.
    """
    if os.getenv("LOCAL_MODE", "false").lower() == "true" or "run.app" not in parser_url:
        return {}
    try:
        import google.auth.transport.requests  # noqa: PLC0415
        from google.oauth2 import id_token  # noqa: PLC0415

        token = id_token.fetch_id_token(google.auth.transport.requests.Request(), parser_url)
        return {"Authorization": f"Bearer {token}"}
    except Exception as e:
        logger.warning(f"Could not mint parser ID token ({e}); calling unauthenticated")
        return {}


def _persist_result(db: Session, match: Match, result: dict) -> None:
    """Batch-insert all event rows for the match in one transaction."""
    match_id = match.match_id

    # Idempotency: a retried job replaces any partial rows from the failed run.
    for model in (Kill, Grenade, Round, FirstContact, PlayerTrajectory):
        db.query(model).filter(model.match_id == match_id).delete()

    kills = result.get("kills") or []
    kill_rows = [
        {
            "match_id": match_id,
            "round_num": k.get("round", 0),
            "tick": k.get("tick", 0),
            # Names aren't in the demo events the parser emits; steam IDs
            # stand in until profile resolution fills them.
            "attacker": k.get("attacker_steam_id") or "",
            "victim": k.get("victim_steam_id") or "",
            "weapon": (k.get("weapon") or "")[:32],
            "headshot": bool(k.get("is_headshot")),
            "attacker_steamid": k.get("attacker_steam_id") or None,
            "victim_steamid": k.get("victim_steam_id") or None,
            "attacker_x": k.get("attacker_x", 0.0),
            "attacker_y": k.get("attacker_y", 0.0),
            "victim_x": k.get("victim_x", 0.0),
            "victim_y": k.get("victim_y", 0.0),
        }
        for k in kills
    ]
    if kill_rows:
        db.execute(insert(Kill), kill_rows)

    round_rows = [
        {
            "match_id": match_id,
            "round_num": r.get("round_num", 0),
            "winner_side": r.get("winner_side") or "",
            "ct_eq_val": r.get("ct_money", 0),
            "t_eq_val": r.get("t_money", 0),
        }
        for r in (result.get("rounds") or [])
    ]
    if round_rows:
        db.execute(insert(Round), round_rows)

    grenade_rows = [
        {
            "match_id": match_id,
            "round_num": g.get("round", 0),
            "tick": g.get("tick", 0),
            "thrower": g.get("thrower_steam_id") or "",
            "grenade_type": (g.get("grenade_type") or "")[:32],
            "throw_x": g.get("land_x", 0.0),
            "throw_y": g.get("land_y", 0.0),
        }
        for g in (result.get("grenades") or [])
    ]
    if grenade_rows:
        db.execute(insert(Grenade), grenade_rows)

    # First contact = first kill of each round, derived from the kill feed.
    first_by_round: dict[int, dict] = {}
    for k in kills:
        rn = k.get("round", 0)
        if rn not in first_by_round or k.get("tick", 0) < first_by_round[rn].get("tick", 0):
            first_by_round[rn] = k
    fc_rows = [
        {
            "match_id": match_id,
            "round_num": rn,
            "tick": k.get("tick", 0),
            "attacker": k.get("attacker_steam_id") or "",
            "victim": k.get("victim_steam_id") or "",
            "weapon": (k.get("weapon") or "")[:32],
            "headshot": bool(k.get("is_headshot")),
            "attacker_steamid": k.get("attacker_steam_id") or None,
            "victim_steamid": k.get("victim_steam_id") or None,
            "attacker_x": k.get("attacker_x", 0.0),
            "attacker_y": k.get("attacker_y", 0.0),
            "victim_x": k.get("victim_x", 0.0),
            "victim_y": k.get("victim_y", 0.0),
        }
        for rn, k in sorted(first_by_round.items())
    ]
    if fc_rows:
        db.execute(insert(FirstContact), fc_rows)

    # Positions → one trajectory row per (round, player) with sampled path.
    paths: dict[tuple[int, str], list[dict]] = defaultdict(list)
    for p in result.get("positions") or []:
        steam_id = p.get("steam_id") or ""
        if not steam_id:
            continue
        paths[(p.get("round", 0), steam_id)].append(
            {"tick": p.get("tick", 0), "x": p.get("x", 0.0), "y": p.get("y", 0.0), "z": p.get("z", 0.0)}
        )
    traj_rows = [
        {
            "match_id": match_id,
            "round_num": rn,
            "player": steam_id,
            "positions_json": json.dumps(points),
        }
        for (rn, steam_id), points in paths.items()
    ]
    if traj_rows:
        db.execute(insert(PlayerTrajectory), traj_rows)

    db.commit()
