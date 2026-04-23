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

Usage:
    python parse_demo.py --demo /path/to/match.dem --match-id match-001
    python parse_demo.py --demo /path/to/match.dem --match-id match-001 --upload
"""

import os
import json
import argparse
import logging
from pathlib import Path
from typing import Any

from awpy import Demo
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger("scout")


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
    }

    # --- Kill events ---
    if demo.kills is not None:
        for _, row in demo.kills.iterrows():
            output["kills"].append({
                "round":        int(row.get("round", 0)),
                "tick":         int(row.get("tick", 0)),
                "attacker":     row.get("attackerName", ""),
                "attacker_team": row.get("attackerTeam", ""),
                "victim":       row.get("victimName", ""),
                "victim_team":  row.get("victimTeam", ""),
                "weapon":       row.get("weapon", ""),
                "headshot":     bool(row.get("headshot", False)),
                "attacker_x":   float(row.get("attackerX", 0)),
                "attacker_y":   float(row.get("attackerY", 0)),
                "attacker_z":   float(row.get("attackerZ", 0)),
                "victim_x":     float(row.get("victimX", 0)),
                "victim_y":     float(row.get("victimY", 0)),
                "victim_z":     float(row.get("victimZ", 0)),
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
                "round":    int(row.get("round", 0)),
                "tick":     int(row.get("tick", 0)),
                "thrower":  row.get("throwerName", ""),
                "team":     row.get("throwerTeam", ""),
                "type":     row.get("grenadeType", ""),
                "throw_x":  float(row.get("throwerX", 0)),
                "throw_y":  float(row.get("throwerY", 0)),
            })

    # --- Round metadata ---
    if demo.rounds is not None:
        for _, row in demo.rounds.iterrows():
            output["rounds"].append({
                "round_num":    int(row.get("roundNum", 0)),
                "winner_side":  row.get("winnerSide", ""),
                "reason":       row.get("reason", ""),
                "ct_eq_val":    int(row.get("ctEqVal", 0)),
                "t_eq_val":     int(row.get("tEqVal", 0)),
                "ct_score":     int(row.get("ctScore", 0)),
                "t_score":      int(row.get("tScore", 0)),
            })

    logger.info(
        f"Parsed — Rounds: {output['metadata']['total_rounds']} | "
        f"Kills: {len(output['kills'])} | "
        f"Grenades: {len(output['grenades'])} | "
        f"First Contacts: {len(output['first_contacts'])}"
    )
    return output


# ---------------------------------------------------------------------------
# GCS upload
# ---------------------------------------------------------------------------

def upload_to_gcs(data: dict, match_id: str) -> str:
    """Upload parsed JSON output to GCS and return the gs:// URI."""
    from google.cloud import storage  # type: ignore

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
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Chinghis Scout — CS2 demo parser")
    ap.add_argument("--demo",     required=True,  help="Absolute path to .dem file")
    ap.add_argument("--match-id", required=True,  help="Unique match identifier (UUID or slug)")
    ap.add_argument("--upload",   action="store_true", help="Upload result to GCS after parsing")
    args = ap.parse_args()

    result = parse_demo(args.demo)

    # Always persist locally (useful for local dev / CI validation)
    out_path = Path(f"/tmp/{args.match_id}_scout.json")
    out_path.write_text(json.dumps(result, indent=2))
    logger.info(f"Saved locally: {out_path}")

    if args.upload:
        upload_to_gcs(result, args.match_id)
