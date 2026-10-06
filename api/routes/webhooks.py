"""FACEIT webhook receiver: match finished → fetch the demo URL → queue a parse.

This is the one FACEIT entry point. It is mounted without the Clerk/shared-
secret dependency because FACEIT is the caller; the HMAC signature is the
authentication, and it fails closed: without FACEIT_WEBHOOK_SECRET nothing is
accepted outside local development.
"""
import asyncio
import hashlib
import hmac
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from api.queue import enqueue_task
from db.database import get_session
from db.models import Match
from services.ingestion.faceit_crawler import (
    _fetch_demo_url,
    create_faceit_match,
    faceit_demo_filename,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _dev_mode() -> bool:
    """Docstring for _dev_mode."""
    return (
        os.getenv("LOCAL_MODE", "false").lower() == "true"
        or os.getenv("APP_ENV", "").lower() == "development"
    )


def verify_faceit_signature(raw_body: bytes, signature: str) -> bool:
    """HMAC-SHA256 of the raw body under FACEIT_WEBHOOK_SECRET. Read at call
    time so tests and rotations do not need a restart. No secret: refuse,
    except in local development where there is nothing to protect."""
    secret = os.getenv("FACEIT_WEBHOOK_SECRET", "")
    if not secret:
        if _dev_mode():
            logger.warning("[FACEIT] FACEIT_WEBHOOK_SECRET not set; accepting unsigned webhook in dev")
            return True
        logger.error("[FACEIT] FACEIT_WEBHOOK_SECRET not set; refusing webhook")
        return False
    if not signature:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.removeprefix("sha256="))

@router.post("/faceit", summary="FACEIT Webhook Receiver")
async def faceit_webhook(request: Request, db: Session = Depends(get_session)):
    """Docstring for faceit_webhook."""
    raw_body = await request.body()
    sig_header = request.headers.get("X-FACEIT-Signature", "")

    if not verify_faceit_signature(raw_body, sig_header):
        raise HTTPException(status_code=401, detail="Invalid or missing signature")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event = payload.get("event", "")
    if event not in ("match_status_finished", "match.finished"):
        return Response(content="ignored", status_code=200)

    faceit_match_id = payload.get("payload", {}).get("id", "")
    if not faceit_match_id:
        return Response(content="no match id", status_code=200)

    headers = {}
    faceit_api_key = os.getenv("FACEIT_API_KEY")
    if faceit_api_key:
        headers["Authorization"] = f"Bearer {faceit_api_key}"

    # Dedupe before any network call: FACEIT retries, and a retry must be free.
    existing = db.query(Match).filter(Match.demo_filename == faceit_demo_filename(faceit_match_id)).first()
    if existing:
        return Response(content="already_exists", status_code=200)

    # The crawler's fetch is synchronous (requests); keep it off the event loop.
    demo_url = await asyncio.to_thread(_fetch_demo_url, faceit_match_id, headers)

    if not demo_url:
        logger.warning(f"No demo URL for match {faceit_match_id}")
        return Response(content="no_demo", status_code=200)

    internal_match_id = create_faceit_match(db, faceit_match_id, demo_url)
    db.commit()

    parser_url = os.environ.get("PARSER_SERVICE_URL", "http://localhost:8082")
    queue = os.environ.get("CLOUD_TASKS_QUEUE", "demo-parse-queue")
    try:
        enqueue_task(queue, f"{parser_url}/parse", {"match_id": internal_match_id, "demo_url": demo_url})
    except Exception as e:
        logger.error(f"Failed to enqueue task: {e}")

    return Response(content="queued", status_code=200)
