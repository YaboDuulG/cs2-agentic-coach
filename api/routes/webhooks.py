import logging
import os
import hmac
import hashlib
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, Response, Depends
from sqlalchemy.orm import Session

from db.database import get_session
from db.models import Match, MatchStatus
from services.ingestion.faceit_crawler import _fetch_demo_url
from api.queue import enqueue_task

logger = logging.getLogger(__name__)
router = APIRouter()

FACEIT_WEBHOOK_SECRET = os.getenv("FACEIT_WEBHOOK_SECRET", "")

def verify_faceit_signature(raw_body: bytes, signature: str) -> bool:
    if not FACEIT_WEBHOOK_SECRET:
        return True
    expected = hmac.new(
        FACEIT_WEBHOOK_SECRET.encode(),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature.lstrip("sha256="))

@router.post("/faceit", summary="FACEIT Webhook Receiver")
async def faceit_webhook(request: Request, db: Session = Depends(get_session)):
    raw_body = await request.body()
    sig_header = request.headers.get("X-FACEIT-Signature", "")
    
    if not verify_faceit_signature(raw_body, sig_header):
        raise HTTPException(status_code=401, detail="Invalid signature")

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

    demo_url = _fetch_demo_url(faceit_match_id, headers=headers)
    
    if not demo_url:
        logger.warning(f"No demo URL for match {faceit_match_id}")
        return Response(content="no_demo", status_code=200)

    # Check for existing match
    existing = db.query(Match).filter(Match.demo_filename == f"faceit_{faceit_match_id}.dem").first()
    if existing:
        return Response(content="already_exists", status_code=200)

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

    parser_url = os.environ.get("PARSER_SERVICE_URL", "http://localhost:8082")
    queue = os.environ.get("CLOUD_TASKS_QUEUE", "demo-parse-queue")
    try:
        enqueue_task(queue, f"{parser_url}/parse", {"match_id": internal_match_id, "demo_url": demo_url})
    except Exception as e:
        logger.error(f"Failed to enqueue task: {e}")

    return Response(content="queued", status_code=200)
