"""
The Scout — CS2 Demo Parser
===========================
Parses a CS2 .dem file using awpy + demoparser2 and outputs structured JSON.
No LLM is used here — this is deterministic data extraction.

Outputs:
    - metadata       : map name, tickrate, total rounds
    - kills          : per-kill events with positions, weapon, headshot flag
    - grenades       : throw/land positions, grenade type
    - rounds         : economy, winner side, end reason
    - first_contacts : first kill event per round (FCR seed data for Tactician)
    - trajectories   : sampled player movement per round (heatmap-ready)

Usage:
    python parse_demo.py --demo /path/to/match.dem --match-id match-001
    python parse_demo.py --demo /path/to/match.dem --match-id match-001 --upload
"""

import argparse
import json
import logging
import os
from pathlib import Path
from typing import Any

from awpy import Demo
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger("scout")

# Sample every N ticks for trajectory data to keep JSON manageable.
# At 64 tick, sampling every 8 ticks ≈ 8 positions/second — good heatmap resolution.
TRAJECTORY_SAMPLE_TICKS = int(os.getenv("TRAJECTORY_SAMPLE_TICKS", "8"))


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse_demo(dem_path: str) -> dict[str, Any]:
    """Parse a CS2 demo file and return structured event data."""
    logger.info(f"Parsing demo: {dem_path}")
    demo = Demo(dem_path)

    output: dict[str, Any] = {
        "metadata": {
            "map": demo.header.get("map_name", "unknown"),
            "tickrate": demo.header.get("tickrate", 64),
            "total_rounds": len(demo.rounds) if demo.rounds is not None else 0,
        },
        "kills": [],
        "grenades": [],
        "rounds": [],
        "first_contacts": [],
        "trajectories": [],
    }

    # --- Kill events ---
    if demo.kills is not None:
        for _, row in demo.kills.iterrows():
            output["kills"].append({
                "round":         int(row.get("round", 0)),
                "tick":          int(row.get("tick", 0)),
                "attacker":      row.get("attackerName", ""),
                "attacker_team": row.get("attackerTeam", ""),
                "victim":        row.get("victimName", ""),
                "victim_team":   row.get("victimTeam", ""),
                "weapon":        row.get("weapon", ""),
                "headshot":      bool(row.get("headshot", False)),
                "attacker_x":    float(row.get("attackerX", 0)),
                "attacker_y":    float(row.get("attackerY", 0)),
                "attacker_z":    float(row.get("attackerZ", 0)),
                "victim_x":      float(row.get("victimX", 0)),
                "victim_y":      float(row.get("victimY", 0)),
                "victim_z":      float(row.get("victimZ", 0)),
            })

    # --- First contact per round (first kill event per round) ---
    seen_rounds: set[int] = set()
    for kill in sorted(output["kills"], key=lambda k: (k["round"], k["tick"])):
        r = kill["round"]
        if r not in seen_rounds:
            seen_rounds.add(r)
            output["first_contacts"].append({**kill, "is_first_contact": True})

    # --- Grenade / utility events ---
    if demo.grenades is not None:
        for _, row in demo.grenades.iterrows():
            output["grenades"].append({
                "round":       int(row.get("round", 0)),
                "tick":        int(row.get("tick", 0)),
                "thrower":     row.get("throwerName", ""),
                "team":        row.get("throwerTeam", ""),
                "type":        row.get("grenadeType", ""),
                "throw_x":     float(row.get("throwerX", 0)),
                "throw_y":     float(row.get("throwerY", 0)),
            })

    # --- Round metadata ---
    if demo.rounds is not None:
        for _, row in demo.rounds.iterrows():
            output["rounds"].append({
                "round_num":   int(row.get("roundNum", 0)),
                "winner_side": row.get("winnerSide", ""),
                "reason":      row.get("reason", ""),
                "ct_eq_val":   int(row.get("ctEqVal", 0)),
                "t_eq_val":    int(row.get("tEqVal", 0)),
                "ct_score":    int(row.get("ctScore", 0)),
                "t_score":     int(row.get("tScore", 0)),
            })

    # --- Player trajectory streaming (sampled per TRAJECTORY_SAMPLE_TICKS) ---
    # awpy exposes per-tick player state via demo.ticks — a large DataFrame with
    # columns: tick, name, team, X, Y, Z (among others).
    # We group by (round, name) and sample every N ticks to produce heatmap-ready data.
    if hasattr(demo, "ticks") and demo.ticks is not None:
        ticks_df = demo.ticks
        required_cols = {"round", "name", "team", "X", "Y", "Z", "tick"}

        if required_cols.issubset(set(ticks_df.columns)):
            # Sample every TRAJECTORY_SAMPLE_TICKS ticks
            sampled = ticks_df[ticks_df["tick"] % TRAJECTORY_SAMPLE_TICKS == 0]

            for (round_num, player), group in sampled.groupby(["round", "name"]):
                positions = [
                    {
                        "tick": int(r["tick"]),
                        "x":    round(float(r["X"]), 2),
                        "y":    round(float(r["Y"]), 2),
                        "z":    round(float(r["Z"]), 2),
                    }
                    for _, r in group.iterrows()
                ]
                if positions:
                    team = str(group["team"].iloc[0]) if len(group) > 0 else ""
                    output["trajectories"].append({
                        "round":   int(round_num),
                        "player":  str(player),
                        "team":    team,
                        "positions": positions,
                    })
        else:
            missing = required_cols - set(ticks_df.columns)
            logger.warning(f"Trajectory skipped — missing columns in demo.ticks: {missing}")

    logger.info(
        f"Parsed — Rounds: {output['metadata']['total_rounds']} | "
        f"Kills: {len(output['kills'])} | "
        f"Grenades: {len(output['grenades'])} | "
        f"First Contacts: {len(output['first_contacts'])} | "
        f"Trajectories: {len(output['trajectories'])} player-rounds"
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
    import json as _json

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
        # Upsert match metadata
        match = db.get(Match, match_id)
        if match is None:
            match = Match(match_id=match_id)
            db.add(match)

        meta = data.get("metadata", {})
        match.map_name = meta.get("map", "unknown")
        match.tickrate = meta.get("tickrate", 64)
        match.total_rounds = meta.get("total_rounds", 0)
        match.status = MatchStatus.COMPLETE

        # Clear existing child rows (re-parse safety)
        db.query(Kill).filter(Kill.match_id == match_id).delete()
        db.query(Grenade).filter(Grenade.match_id == match_id).delete()
        db.query(Round).filter(Round.match_id == match_id).delete()
        db.query(FirstContact).filter(FirstContact.match_id == match_id).delete()
        db.query(PlayerTrajectory).filter(PlayerTrajectory.match_id == match_id).delete()

        for k in data.get("kills", []):
            db.add(Kill(
                match_id=match_id,
                round_num=k["round"],
                tick=k["tick"],
                attacker=k["attacker"],
                attacker_team=k["attacker_team"],
                victim=k["victim"],
                victim_team=k["victim_team"],
                weapon=k["weapon"],
                headshot=k["headshot"],
                attacker_x=k["attacker_x"],
                attacker_y=k["attacker_y"],
                attacker_z=k["attacker_z"],
                victim_x=k["victim_x"],
                victim_y=k["victim_y"],
                victim_z=k["victim_z"],
            ))

        for g in data.get("grenades", []):
            db.add(Grenade(
                match_id=match_id,
                round_num=g["round"],
                tick=g["tick"],
                thrower=g["thrower"],
                team=g["team"],
                grenade_type=g["type"],
                throw_x=g["throw_x"],
                throw_y=g["throw_y"],
            ))

        for r in data.get("rounds", []):
            db.add(Round(
                match_id=match_id,
                round_num=r["round_num"],
                winner_side=r["winner_side"],
                reason=r["reason"],
                ct_eq_val=r["ct_eq_val"],
                t_eq_val=r["t_eq_val"],
                ct_score=r["ct_score"],
                t_score=r["t_score"],
            ))

        for fc in data.get("first_contacts", []):
            db.add(FirstContact(
                match_id=match_id,
                round_num=fc["round"],
                tick=fc["tick"],
                attacker=fc["attacker"],
                attacker_team=fc["attacker_team"],
                victim=fc["victim"],
                weapon=fc["weapon"],
                headshot=fc["headshot"],
                attacker_x=fc["attacker_x"],
                attacker_y=fc["attacker_y"],
                victim_x=fc["victim_x"],
                victim_y=fc["victim_y"],
            ))

        for traj in data.get("trajectories", []):
            db.add(PlayerTrajectory(
                match_id=match_id,
                round_num=traj["round"],
                player=traj["player"],
                team=traj["team"],
                positions_json=_json.dumps(traj["positions"]),
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
    ap.add_argument("--demo",     required=True,  help="Absolute path to .dem file")
    ap.add_argument("--match-id", required=True,  help="Unique match identifier (UUID or slug)")
    ap.add_argument("--upload",   action="store_true", help="Upload result to GCS after parsing")
    ap.add_argument("--write-db", action="store_true", help="Write parsed data to database")
    args = ap.parse_args()

    result = parse_demo(args.demo)

    # Always persist locally
    out_path = Path(f"/tmp/{args.match_id}_scout.json")
    out_path.write_text(json.dumps(result, indent=2))
    logger.info(f"Saved locally: {out_path}")

    if args.upload:
        upload_to_gcs(result, args.match_id)

    if args.write_db:
        write_to_db(result, args.match_id)
