"""
FACEIT Webhook Receiver
========================
Receives FACEIT platform events (match.finished, match.cancelled) and
auto-triggers demo analysis via the Scout pipeline.

Setup (FACEIT Developer Portal):
    1. Create a webhook subscription on your FACEIT hub/championship
    2. Point it at: https://<your-domain>/api/faceit/webhook
    3. Set the secret and store it as FACEIT_WEBHOOK_SECRET env var

Payload reference:
    https://developers.faceit.com/docs/tools/webhooks

Environment variables:
    FACEIT_WEBHOOK_SECRET   - HMAC-SHA256 secret from FACEIT developer portal
    FACEIT_API_KEY          - FACEIT server-side API key (for fetching match details)
    FACEIT_AUTO_TEAM_ID     - Optional: auto-associate demos with this team_id
    GCS_BUCKET              - GCS bucket for uploaded demos
    SCOUT_URL               - Internal Scout service URL (for direct triggering in dev)
"""

from datetime import UTC, datetime
import hashlib
import hmac
import logging
import os
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
import requests
from sqlalchemy.orm import Session

from db.models import Match, MatchStatus

logger = logging.getLogger(__name__)

router = APIRouter()

FACEIT_WEBHOOK_SECRET = os.getenv("FACEIT_WEBHOOK_SECRET", "")
FACEIT_API_KEY = os.getenv("FACEIT_API_KEY", "")
FACEIT_API_BASE = "https://open.faceit.com/data/v4"
FACEIT_AUTO_TEAM_ID = os.getenv("FACEIT_AUTO_TEAM_ID")
GCS_BUCKET = os.getenv("GCS_BUCKET", "cs2-demosage")
SCOUT_URL = os.getenv("SCOUT_URL", "http://localhost:8001")


# ---------------------------------------------------------------------------
# HMAC signature verification
# ---------------------------------------------------------------------------


def _verify_signature(raw_body: bytes, signature_header: str) -> bool:
    """
    FACEIT signs webhook payloads using HMAC-SHA256.
    Header: X-FACEIT-Signature: <hex_digest>
    """
    if not FACEIT_WEBHOOK_SECRET:
        logger.warning("[FACEIT] FACEIT_WEBHOOK_SECRET not set — skipping signature check")
        return True  # fail-open in dev
    expected = hmac.new(
        FACEIT_WEBHOOK_SECRET.encode(),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header.lstrip("sha256="))


# ---------------------------------------------------------------------------
# Background: download demo + queue parse
# ---------------------------------------------------------------------------


def _queue_demo_analysis(
    demo_url: str,
    match_id: str,
    faceit_match_id: str,
    team_id: str | None,
) -> None:
    """
    Downloads demo URL metadata and triggers the Scout parse pipeline.
    In production this would upload the demo to GCS and push a Cloud Task.
    In local/staging mode, it calls the Scout service directly.
    """
    local_mode = os.getenv("LOCAL_MODE", "false").lower() == "true"

    try:
        # Import lazily to avoid GCP deps in CI
        from db.database import engine
        from db.models import Base

        Base.metadata.create_all(engine)

        from sqlalchemy.orm import sessionmaker

        SessionLocal = sessionmaker(bind=engine)
        db: Session = SessionLocal()

        try:
            match = Match(
                match_id=match_id,
                team_id=team_id,
                demo_filename=f"faceit_{faceit_match_id}.dem",
                map_name="unknown",  # will be updated after parse
                status=MatchStatus.PENDING,
                gcs_demo_uri=demo_url,  # Store FACEIT URL temporarily
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
            db.add(match)
            db.commit()
            logger.info(f"[FACEIT] Match record created: {match_id}")
        finally:
            db.close()

        if local_mode:
            # Direct Scout call (dev only)
            try:
                resp = requests.post(
                    f"{SCOUT_URL}/parse-from-url",
                    json={"match_id": match_id, "demo_url": demo_url},
                    timeout=10,
                )
                logger.info(f"[FACEIT] Scout triggered: {resp.status_code}")
            except Exception as e:
                logger.warning(f"[FACEIT] Scout not reachable in dev: {e}")
        else:
            # Production: push to Cloud Tasks (GCS upload would happen here)
            logger.info(f"[FACEIT] Would push Cloud Task for match_id={match_id} demo_url={demo_url}")

    except Exception as exc:
        logger.error(f"[FACEIT] Error queuing demo analysis: {exc}", exc_info=True)


# ---------------------------------------------------------------------------
# Webhook endpoint
# ---------------------------------------------------------------------------


@router.post("/webhook")
async def faceit_webhook(request: Request, background_tasks: BackgroundTasks) -> Response:
    """
    Receives FACEIT webhook events.
    Currently handled events:
        match.finished  - Auto-download demo and queue parse
        match.cancelled - No-op (log only)
    """
    raw_body = await request.body()

    # Verify signature
    sig_header = request.headers.get("X-FACEIT-Signature", "")
    if FACEIT_WEBHOOK_SECRET and not _verify_signature(raw_body, sig_header):
        logger.warning("[FACEIT] Invalid webhook signature")
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event = payload.get("event", "")
    faceit_match_id = payload.get("payload", {}).get("id", "")

    logger.info(f"[FACEIT] Received event={event} match_id={faceit_match_id}")

    if event == "match.finished":
        # Fetch match details from FACEIT API to get demo URL
        demo_url = _fetch_demo_url(faceit_match_id)
        if not demo_url:
            logger.warning(f"[FACEIT] No demo URL found for match {faceit_match_id}")
            return Response(content="no_demo", status_code=200)

        internal_match_id = str(uuid.uuid4())
        background_tasks.add_task(
            _queue_demo_analysis,
            demo_url=demo_url,
            match_id=internal_match_id,
            faceit_match_id=faceit_match_id,
            team_id=FACEIT_AUTO_TEAM_ID,
        )
        logger.info(f"[FACEIT] Queued demo analysis: internal={internal_match_id} faceit={faceit_match_id}")
        return Response(content="queued", status_code=200)

    elif event == "match.cancelled":
        logger.info(f"[FACEIT] Match cancelled: {faceit_match_id} — no action taken")
        return Response(content="ok", status_code=200)

    else:
        logger.debug(f"[FACEIT] Unhandled event type: {event}")
        return Response(content="ignored", status_code=200)


# ---------------------------------------------------------------------------
# FACEIT API helper
# ---------------------------------------------------------------------------


def _fetch_demo_url(faceit_match_id: str) -> str | None:
    """
    Fetches match details from FACEIT Data API and extracts demo download URL.
    Requires FACEIT_API_KEY (server-side key, not OAuth).
    """
    if not FACEIT_API_KEY:
        logger.warning("[FACEIT] FACEIT_API_KEY not set — cannot fetch demo URL")
        return None

    try:
        resp = requests.get(
            f"{FACEIT_API_BASE}/matches/{faceit_match_id}",
            headers={"Authorization": f"Bearer {FACEIT_API_KEY}"},
            timeout=10,
        )
        if resp.status_code != 200:
            logger.warning(f"[FACEIT] Match API returned {resp.status_code} for {faceit_match_id}")
            return None

        data = resp.json()
        # FACEIT puts demo URLs in demo_url array
        demo_urls: list[str] = data.get("demo_url", [])
        if demo_urls:
            return demo_urls[0]

        logger.warning(f"[FACEIT] No demo_url in match payload for {faceit_match_id}")
        return None

    except Exception as exc:
        logger.error(f"[FACEIT] Error fetching match details: {exc}")
        return None


# ---------------------------------------------------------------------------
# Connection status endpoint (for frontend settings page)
# ---------------------------------------------------------------------------


@router.get("/status")
def faceit_connection_status() -> dict:
    """Returns FACEIT integration config status (for the Settings UI)."""
    return {
        "webhook_configured": bool(FACEIT_WEBHOOK_SECRET),
        "api_key_configured": bool(FACEIT_API_KEY),
        "auto_team_id": FACEIT_AUTO_TEAM_ID,
        "webhook_url_path": "/api/faceit/webhook",
    }
