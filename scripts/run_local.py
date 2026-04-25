"""
DemoSage — Local End-to-End Pipeline Runner
=============================================
Runs the full demo analysis pipeline locally without GCP.

What it does:
    1. Starts local PostgreSQL via docker-compose (if not already running)
    2. Creates all DB tables (or confirms they exist)
    3. Calls the Scout parser directly on a .dem file
    4. Writes results to local DB
    5. Prints a summary of what was parsed

Usage:
    python scripts/run_local.py --demo /path/to/match.dem
    python scripts/run_local.py --demo /path/to/match.dem --match-id my-match-001
    python scripts/run_local.py --demo /path/to/match.dem --skip-docker

Requirements:
    - Docker Desktop running (unless --skip-docker)
    - .env file with DATABASE_URL_LOCAL set
    - The demo file must be a valid CS2 .dem file
"""

import argparse
import json
import logging
from pathlib import Path
import subprocess
import sys
import uuid

from dotenv import load_dotenv

# Load .env from repo root (two levels up from scripts/)
load_dotenv(Path(__file__).parent.parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger("run_local")

COMPOSE_FILE = Path(__file__).parent.parent / "infra" / "docker-compose.local.yml"


def start_docker_compose() -> None:
    """Start the local postgres container if it's not already running."""
    logger.info("Starting local postgres via docker-compose...")
    result = subprocess.run(
        ["docker", "compose", "-f", str(COMPOSE_FILE), "up", "-d", "postgres"],
        capture_output=False,
    )
    if result.returncode != 0:
        logger.error("docker-compose failed. Is Docker Desktop running?")
        sys.exit(1)

    # Wait for postgres to be healthy
    import time
    for attempt in range(15):
        check = subprocess.run(
            ["docker", "compose", "-f", str(COMPOSE_FILE), "exec", "-T", "postgres",
             "pg_isready", "-U", "demosage_user", "-d", "demosage"],
            capture_output=True,
        )
        if check.returncode == 0:
            logger.info("Postgres is ready.")
            return
        logger.info(f"Waiting for postgres... ({attempt + 1}/15)")
        time.sleep(2)

    logger.error("Postgres did not become healthy in time.")
    sys.exit(1)


def create_tables() -> None:
    """Create all DB tables if they don't exist."""
    from db.database import engine
    from db.models import Base

    Base.metadata.create_all(engine)
    logger.info("DB tables created / verified.")


def print_summary(match_id: str) -> None:
    """Print a summary of what was parsed from the DB."""
    from db.database import SessionLocal
    from db.models import FirstContact, Grenade, Kill, Match, Round

    db = SessionLocal()
    match = db.get(Match, match_id)
    if not match:
        logger.error(f"Match {match_id} not found in DB after parse.")
        db.close()
        return

    kills = db.query(Kill).filter(Kill.match_id == match_id).count()
    grenades = db.query(Grenade).filter(Grenade.match_id == match_id).count()
    rounds = db.query(Round).filter(Round.match_id == match_id).count()
    fcs = db.query(FirstContact).filter(FirstContact.match_id == match_id).count()
    db.close()

    print("\n" + "=" * 55)
    print("✅ DemoSage Scout — Parse Complete")
    print("=" * 55)
    print(f"  Match ID    : {match_id}")
    print(f"  Map         : {match.map_name}")
    print(f"  Tickrate    : {match.tickrate}")
    print(f"  Rounds      : {rounds}")
    print(f"  Kills       : {kills}")
    print(f"  Grenades    : {grenades}")
    print(f"  1st Contacts: {fcs}")
    print(f"  Status      : {match.status}")
    print("=" * 55)
    print("\nNext steps:")
    print("  - Start the API:   uvicorn api.main:app --reload")
    print("  - View DB:         docker exec -it chinghis-postgres psql -U demosage_user -d demosage")
    print("  - Run full tests:  pytest tests/ -v\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="DemoSage local pipeline runner")
    parser.add_argument("--demo",        required=True, help="Path to a CS2 .dem file")
    parser.add_argument("--match-id",    default=None,  help="Match ID (auto-generated if omitted)")
    parser.add_argument("--skip-docker", action="store_true", help="Skip docker-compose startup")
    args = parser.parse_args()

    dem_path = Path(args.demo)
    if not dem_path.exists():
        logger.error(f"Demo file not found: {dem_path}")
        sys.exit(1)

    match_id = args.match_id or str(uuid.uuid4())
    logger.info(f"Match ID: {match_id}")

    # 1. Start docker-compose
    if not args.skip_docker:
        start_docker_compose()

    # 2. Create DB tables
    create_tables()

    # 3. Parse the demo
    logger.info(f"Parsing: {dem_path}")
    # Import here so awpy errors surface cleanly
    from services.scout.parse_demo import parse_demo, write_to_db

    result = parse_demo(str(dem_path))

    # Save JSON locally for inspection
    out = Path(f"data/processed/{match_id}_scout.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    logger.info(f"JSON saved: {out}")

    # 4. Write to DB
    write_to_db(result, match_id)

    # 5. Summary
    print_summary(match_id)


if __name__ == "__main__":
    main()
