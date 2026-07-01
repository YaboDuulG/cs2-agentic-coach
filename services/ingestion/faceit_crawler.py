from datetime import UTC, datetime
import logging
import os
import uuid

import requests
from sqlalchemy.orm import Session

from api.queue import enqueue_task
from db.models import Match, MatchStatus

logger = logging.getLogger(__name__)

FACEIT_API_BASE = "https://open.faceit.com/data/v4"
FACEIT_API_KEY = os.getenv("FACEIT_API_KEY", "")
GCS_BUCKET = os.getenv("GCS_BUCKET", "cs2-demosage")

def _fetch_demo_url(faceit_match_id: str, headers: dict) -> str | None:
    try:
        resp = requests.get(
            f"{FACEIT_API_BASE}/matches/{faceit_match_id}",
            headers=headers,
            timeout=10,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        demo_urls = data.get("demo_url", [])
        if demo_urls:
            return demo_urls[0]
    except Exception as exc:
        logger.error(f"Error fetching match details: {exc}")
    return None

def fetch_recent_matches(faceit_id: str, access_token: str | None, db: Session, limit: int = 5) -> list[str]:
    """
    Fetches recent CS2 match IDs for a FACEIT user, deduplicates against DB,
    and returns newly enqueued match IDs.
    """
    headers = {}
    if FACEIT_API_KEY:
        headers["Authorization"] = f"Bearer {FACEIT_API_KEY}"
    elif access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    else:
        logger.warning("No FACEIT credentials for crawler.")
        return []

    try:
        url = f"{FACEIT_API_BASE}/players/{faceit_id}/history"
        params = {"game": "cs2", "limit": limit, "offset": 0}
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        items = data.get("items", [])

        new_matches = []
        for item in items:
            faceit_match_id = item.get("match_id")
            if not faceit_match_id:
                continue

            # Deduplication
            existing = db.query(Match).filter(Match.demo_filename == f"faceit_{faceit_match_id}.dem").first()
            if existing:
                continue

            demo_url = _fetch_demo_url(faceit_match_id, headers)
            if not demo_url:
                continue

            internal_match_id = str(uuid.uuid4())
            match = Match(
                match_id=internal_match_id,
                team_id=None,
                demo_filename=f"faceit_{faceit_match_id}.dem",
                map_name="unknown",
                status=MatchStatus.PENDING,
                gcs_demo_uri=demo_url,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
            db.add(match)
            db.commit()

            scout_url = os.environ.get("SCOUT_SERVICE_URL", "http://localhost:8001")
            queue = os.environ.get("CLOUD_TASKS_QUEUE", "demo-parse-queue")
            payload = {"match_id": internal_match_id, "demo_url": demo_url}
            try:
                enqueue_task(queue, f"{scout_url}/parse-from-url", payload)
            except Exception as e:
                logger.error(f"Failed to enqueue task for {faceit_match_id}: {e}")

            new_matches.append(internal_match_id)

        return new_matches
    except Exception as e:
        logger.error(f"Error fetching FACEIT history for {faceit_id}: {e}")
        return []
