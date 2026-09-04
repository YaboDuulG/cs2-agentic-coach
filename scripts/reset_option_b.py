"""
One-time data reset for the Option-B demo/match split (2026-09).

Drops the pre-split match + telemetry + queue tables and recreates the new
schema (demos as the shared artifact, matches as per-user analyses, event
tables keyed by demo_id). Teams, subscriptions, stratbook, linked accounts,
knowledge embeddings, and the pro library are untouched.

DESTRUCTIVE by design — the user requested a data reset alongside the split.
Run:  python scripts/reset_option_b.py --yes
"""

import argparse
import logging
import sys

from sqlalchemy import text

sys.path.insert(0, ".")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("reset")

# Order matters: children before parents (FKs).
TABLES_TO_DROP = [
    "jobs",
    "kills",
    "grenades",
    "rounds",
    "first_contacts",
    "trajectories",
    "damages",
    "flash_events",
    "round_features",
    "matches",
    "demos",
]


def main() -> None:
    """Docstring for main."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="actually drop and recreate")
    args = ap.parse_args()

    from db.database import engine
    from db.models import Base

    if not args.yes:
        logger.info(f"DRY RUN — would drop: {', '.join(TABLES_TO_DROP)}")
        return

    with engine.begin() as conn:
        for table in TABLES_TO_DROP:
            logger.info(f"Dropping {table}...")
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))

    logger.info("Recreating schema from models...")
    Base.metadata.create_all(engine)
    logger.info("Reset complete: demo/match split schema in place.")


if __name__ == "__main__":
    main()
