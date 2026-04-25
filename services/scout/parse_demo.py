"""
The Scout — CS2 Demo Parser
===========================
Parses a CS2 .dem file using demoparser2 (pure Rust, Python 3.12+ compatible).
No LLM is used here — this is deterministic data extraction.

Outputs:
    - metadata       : map name, tickrate, total rounds
    - kills          : per-kill events with positions, weapon, headshot flag
    - grenades       : throw positions, grenade type
    - rounds         : economy, winner side, end reason
    - first_contacts : first kill event per round (FCR seed data for Tactician)
    - trajectories   : sampled player movement per round (heatmap-ready)

Usage:
    python parse_demo.py --demo /path/to/match.dem --match-id match-001
    python parse_demo.py --demo /path/to/match.dem --match-id match-001 --write-db
"""

import argparse
import json
import logging
import os
from pathlib import Path
from typing import Any

from demoparser2 import DemoParser
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger("scout")

# Sample every N ticks for trajectory data to keep JSON manageable.
# At 64 tick, sampling every 8 ticks ≈ 8 positions/second
TRAJECTORY_SAMPLE_TICKS = int(os.getenv("TRAJECTORY_SAMPLE_TICKS", "8"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def _safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def _safe_str(val: Any, default: str = "") -> str:
    return str(val) if val is not None else default


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse_demo(dem_path: str) -> dict[str, Any]:
    """Parse a CS2 demo file using demoparser2 and return structured event data."""
    logger.info(f"Parsing demo: {dem_path}")
    parser = DemoParser(dem_path)

    # --- Header / metadata ---
    header = parser.parse_header()
    map_name = _safe_str(header.get("map_name", "unknown"))
    playback_ticks = _safe_int(header.get("playback_ticks", 0))
    # CS2 runs at 64 tick for matchmaking, 128 tick for FACEIT
    tickrate = 128 if playback_ticks > 100000 else 64

    output: dict[str, Any] = {
        "metadata": {
            "map": map_name,
            "tickrate": tickrate,
            "total_rounds": 0,
        },
        "kills": [],
        "grenades": [],
        "rounds": [],
        "first_contacts": [],
        "trajectories": [],
    }

    # --- Kill events (player_death) ---
    try:
        kills_df = parser.parse_event(
            "player_death",
            player=["X", "Y", "Z", "team_name"],
            other=["total_rounds_played"],
        )
        if kills_df is not None and not kills_df.empty:
            for _, row in kills_df.iterrows():
                kill = {
                    "round":          _safe_int(row.get("total_rounds_played")),
                    "tick":           _safe_int(row.get("tick")),
                    "attacker":       _safe_str(row.get("attacker_name")),
                    "attacker_team":  _safe_str(row.get("attacker_team_name")),
                    "victim":         _safe_str(row.get("user_name")),
                    "victim_team":    _safe_str(row.get("user_team_name")),
                    "weapon":         _safe_str(row.get("weapon")),
                    "headshot":       bool(row.get("headshot", False)),
                    "attacker_x":     _safe_float(row.get("attacker_X")),
                    "attacker_y":     _safe_float(row.get("attacker_Y")),
                    "attacker_z":     _safe_float(row.get("attacker_Z")),
                    "victim_x":       _safe_float(row.get("user_X")),
                    "victim_y":       _safe_float(row.get("user_Y")),
                    "victim_z":       _safe_float(row.get("user_Z")),
                }
                output["kills"].append(kill)
    except Exception as e:
        logger.warning(f"Kill events skipped: {e}")

    # --- First contact per round ---
    seen_rounds: set[int] = set()
    for kill in sorted(output["kills"], key=lambda k: (k["round"], k["tick"])):
        r = kill["round"]
        if r not in seen_rounds:
            seen_rounds.add(r)
            output["first_contacts"].append({**kill, "is_first_contact": True})

    # --- Grenade events ---
    for event_name in ["hegrenade_detonate", "smokegrenade_detonate",
                       "flashbang_detonate", "molotov_detonate"]:
        try:
            g_df = parser.parse_event(
                event_name,
                player=["X", "Y", "Z", "team_name"],
                other=["total_rounds_played"],
            )
            if g_df is not None and not g_df.empty:
                grenade_type = event_name.replace("_detonate", "").replace("_extinguish", "")
                for _, row in g_df.iterrows():
                    output["grenades"].append({
                        "round":   _safe_int(row.get("total_rounds_played")),
                        "tick":    _safe_int(row.get("tick")),
                        "thrower": _safe_str(row.get("user_name")),
                        "team":    _safe_str(row.get("user_team_name")),
                        "type":    grenade_type,
                        "throw_x": _safe_float(row.get("user_X")),
                        "throw_y": _safe_float(row.get("user_Y")),
                    })
        except Exception:
            pass  # Not all demo types have all grenade events

    # --- Round events ---
    # Build economy lookup from round_freeze_end separately so it can't crash round_end parsing
    eco_lookup: dict[int, dict] = {}
    try:
        freeze_df = parser.parse_event(
            "round_freeze_end",
            player=["current_equip_value", "team_name"],
            other=["total_rounds_played"],
        )
        if freeze_df is not None and not freeze_df.empty and "team_name" in freeze_df.columns:
            for rnd_num, grp in freeze_df.groupby("total_rounds_played"):
                ct_val = grp[grp["team_name"] == "CT"]["current_equip_value"].sum()
                t_val = grp[grp["team_name"] == "TERRORIST"]["current_equip_value"].sum()
                eco_lookup[int(rnd_num)] = {"ct": int(ct_val), "t": int(t_val)}
    except Exception as e:
        logger.debug(f"Economy data unavailable (older demo format): {e}")

    try:
        round_df = parser.parse_event(
            "round_end",
            other=["winner", "reason", "total_rounds_played"],
        )
        if round_df is not None and not round_df.empty:
            ct_score = t_score = 0
            for _, row in round_df.sort_values("total_rounds_played").iterrows():
                rnd_num = _safe_int(row.get("total_rounds_played"))
                winner = _safe_int(row.get("winner"))
                # CS2: winner=3 → CT, winner=2 → T
                winner_side = "CT" if winner == 3 else "T" if winner == 2 else ""
                if winner_side == "CT":
                    ct_score += 1
                elif winner_side == "T":
                    t_score += 1

                eco = eco_lookup.get(rnd_num, {})
                output["rounds"].append({
                    "round_num":   rnd_num,
                    "winner_side": winner_side,
                    "reason":      _safe_str(row.get("reason")),
                    "ct_eq_val":   eco.get("ct", 0),
                    "t_eq_val":    eco.get("t", 0),
                    "ct_score":    ct_score,
                    "t_score":     t_score,
                })
    except Exception as e:
        logger.warning(f"Round events unavailable: {e}")
        # Fall back: infer round count from kills
        if output["kills"]:
            max_round = max(k["round"] for k in output["kills"])
            for i in range(1, max_round + 1):
                output["rounds"].append({
                    "round_num": i, "winner_side": "", "reason": "",
                    "ct_eq_val": 0, "t_eq_val": 0, "ct_score": 0, "t_score": 0,
                })


    output["metadata"]["total_rounds"] = len(output["rounds"])

    # --- Player trajectories (sampled per TRAJECTORY_SAMPLE_TICKS) ---
    try:
        tick_data = parser.parse_ticks(
            ["X", "Y", "Z", "name", "team_name"],
        )
        if tick_data is not None and not tick_data.empty:
            # Filter to every Nth tick
            sampled = tick_data[tick_data["tick"] % TRAJECTORY_SAMPLE_TICKS == 0]
            # We don't have round from ticks directly — use kill/round data to bucket
            # For now, output all positions without round grouping (Phase 3 refinement)
            for player_name, grp in sampled.groupby("name"):
                positions = [
                    {
                        "tick": int(r["tick"]),
                        "x":    round(float(r["X"]), 2),
                        "y":    round(float(r["Y"]), 2),
                        "z":    round(float(r["Z"]), 2),
                    }
                    for _, r in grp.iterrows()
                    if r.get("X") is not None
                ]
                if positions:
                    team = _safe_str(grp["team_name"].iloc[0]) if len(grp) > 0 else ""
                    output["trajectories"].append({
                        "round":     0,  # Full-match trajectory — refined in Phase 3
                        "player":    str(player_name),
                        "team":      team,
                        "positions": positions,
                    })
    except Exception as e:
        logger.warning(f"Trajectory data skipped: {e}")

    logger.info(
        f"Parsed — Rounds: {output['metadata']['total_rounds']} | "
        f"Kills: {len(output['kills'])} | "
        f"Grenades: {len(output['grenades'])} | "
        f"First Contacts: {len(output['first_contacts'])} | "
        f"Trajectories: {len(output['trajectories'])} players"
    )
    return output


# ---------------------------------------------------------------------------
# GCS upload
# ---------------------------------------------------------------------------

def upload_to_gcs(data: dict, match_id: str) -> str:
    """Upload parsed JSON output to GCS and return the gs:// URI."""
    from google.cloud import storage  # noqa: PLC0415

    bucket_name = os.environ["GCS_BUCKET"]
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob_path = f"parsed/{match_id}/scout_output.json"
    blob = bucket.blob(blob_path)
    blob.upload_from_string(json.dumps(data, indent=2), content_type="application/json")
    uri = f"gs://{bucket_name}/{blob_path}"
    logger.info(f"Uploaded: {uri}")
    return uri


# ---------------------------------------------------------------------------
# DB write
# ---------------------------------------------------------------------------

def write_to_db(data: dict, match_id: str) -> None:
    """Write parsed Scout output to PostgreSQL (or SQLite in local/test mode)."""
    import sys
    from pathlib import Path as _Path

    # Ensure repo root on path for db imports when called as module
    _repo = _Path(__file__).parent.parent.parent.resolve()
    if str(_repo) not in sys.path:
        sys.path.insert(0, str(_repo))

    from db.database import SessionLocal
    from db.models import (
        FirstContact,
        Grenade,
        Kill,
        Match,
        MatchStatus,
        PlayerTrajectory,
        Round,
    )

    db = SessionLocal()
    try:
        match = db.get(Match, match_id)
        if match is None:
            match = Match(match_id=match_id)
            db.add(match)

        meta = data.get("metadata", {})
        match.map_name = meta.get("map", "unknown")
        match.tickrate = meta.get("tickrate", 64)
        match.total_rounds = meta.get("total_rounds", 0)
        match.status = MatchStatus.COMPLETE

        db.query(Kill).filter(Kill.match_id == match_id).delete()
        db.query(Grenade).filter(Grenade.match_id == match_id).delete()
        db.query(Round).filter(Round.match_id == match_id).delete()
        db.query(FirstContact).filter(FirstContact.match_id == match_id).delete()
        db.query(PlayerTrajectory).filter(PlayerTrajectory.match_id == match_id).delete()

        for k in data.get("kills", []):
            db.add(Kill(
                match_id=match_id, round_num=k["round"], tick=k["tick"],
                attacker=k["attacker"], attacker_team=k["attacker_team"],
                victim=k["victim"], victim_team=k["victim_team"],
                weapon=k["weapon"], headshot=k["headshot"],
                attacker_x=k["attacker_x"], attacker_y=k["attacker_y"], attacker_z=k["attacker_z"],
                victim_x=k["victim_x"], victim_y=k["victim_y"], victim_z=k["victim_z"],
            ))

        for g in data.get("grenades", []):
            db.add(Grenade(
                match_id=match_id, round_num=g["round"], tick=g["tick"],
                thrower=g["thrower"], team=g["team"], grenade_type=g["type"],
                throw_x=g["throw_x"], throw_y=g["throw_y"],
            ))

        for r in data.get("rounds", []):
            db.add(Round(
                match_id=match_id, round_num=r["round_num"],
                winner_side=r["winner_side"], reason=r["reason"],
                ct_eq_val=r["ct_eq_val"], t_eq_val=r["t_eq_val"],
                ct_score=r["ct_score"], t_score=r["t_score"],
            ))

        for fc in data.get("first_contacts", []):
            db.add(FirstContact(
                match_id=match_id, round_num=fc["round"], tick=fc["tick"],
                attacker=fc["attacker"], attacker_team=fc["attacker_team"],
                victim=fc["victim"], weapon=fc["weapon"], headshot=fc["headshot"],
                attacker_x=fc["attacker_x"], attacker_y=fc["attacker_y"],
                victim_x=fc["victim_x"], victim_y=fc["victim_y"],
            ))

        for traj in data.get("trajectories", []):
            db.add(PlayerTrajectory(
                match_id=match_id, round_num=traj["round"],
                player=traj["player"], team=traj["team"],
                positions_json=json.dumps(traj["positions"]),
            ))

        db.commit()
        logger.info(f"DB write complete for match {match_id}")
    except Exception as exc:
        db.rollback()
        logger.error(f"DB write failed: {exc}")
        raise
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="DemoSage Scout — CS2 demo parser")
    ap.add_argument("--demo",     required=True, help="Absolute path to .dem file")
    ap.add_argument("--match-id", required=True, help="Unique match identifier")
    ap.add_argument("--upload",   action="store_true", help="Upload result to GCS")
    ap.add_argument("--write-db", action="store_true", help="Write parsed data to DB")
    args = ap.parse_args()

    result = parse_demo(args.demo)

    out_path = Path(f"/tmp/{args.match_id}_scout.json")
    out_path.write_text(json.dumps(result, indent=2))
    logger.info(f"Saved locally: {out_path}")

    if args.upload:
        upload_to_gcs(result, args.match_id)

    if args.write_db:
        write_to_db(result, args.match_id)
