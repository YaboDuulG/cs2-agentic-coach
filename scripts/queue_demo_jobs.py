"""
DemoSage — Queue Demo Jobs Script
==================================
Scans the database for match records with status = PENDING,
enqueues them to Cloud Tasks for parsing by the Scout service,
and updates their status to PARSING.

Usage:
    python scripts/queue_demo_jobs.py
"""

import logging
from pathlib import Path
import sys

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("queue_demo_jobs")

# Ensure project root is in path
REPO_ROOT = Path(__file__).parent.parent.resolve()
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv

load_dotenv(REPO_ROOT / ".env")

from api.queue import enqueue_scout_job
from db.database import SessionLocal
from db.models import Match, MatchStatus


def main():
    db = SessionLocal()
    try:
        # Find matches with status PENDING
        pending_matches = db.query(Match).filter(Match.status == MatchStatus.PENDING).all()

        if not pending_matches:
            logger.info("No pending matches found in the queue.")
            return

        logger.info(f"Found {len(pending_matches)} pending match(es) to queue.")

        queued_count = 0
        for match in pending_matches:
            if not match.gcs_demo_uri:
                logger.warning(f"Match {match.match_id} has no gcs_demo_uri. Skipping.")
                continue

            try:
                # Call api.queue to create Cloud Task
                logger.info(f"Queueing parse job for match {match.match_id} | URI: {match.gcs_demo_uri}")
                enqueue_scout_job(match.match_id, match.gcs_demo_uri)

                # Update status
                match.status = MatchStatus.PARSING
                queued_count += 1
            except Exception as e:
                logger.error(f"Failed to queue job for match {match.match_id}: {e}")

        db.commit()
        logger.info(f"Successfully queued {queued_count} match parse job(s).")

    finally:
        db.close()

if __name__ == "__main__":
    main()
