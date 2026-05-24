"""
The Scout — Internal HTTP Service
===================================
Exposes the Scout parser as a FastAPI app invoked by Cloud Tasks.

Cloud Tasks sends:  POST /internal/scout/parse
                    JSON body: {"match_id": "...", "gcs_uri": "gs://..."}

The Scout:
    1. Downloads the .dem from GCS to a temp file
    2. Runs parse_demo()
    3. Writes results to PostgreSQL
    4. Uploads parsed JSON back to GCS under parsed/{match_id}/scout_output.json
    5. Returns 200 OK (Cloud Tasks retries on non-2xx)

Local mode (LOCAL_MODE=true):
    - Skips GCS download; expects dem_path in the request body instead of gcs_uri
    - Skips GCS upload of results
    - Writes to local SQLite / docker-compose postgres
"""

import json
import logging
import os
from pathlib import Path
import tempfile

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger("scout.service")

LOCAL_MODE = os.getenv("LOCAL_MODE", "false").lower() == "true"

app = FastAPI(
    title="DemoSage Scout Service",
    description="Internal CS2 demo parsing service — called by Cloud Tasks",
    version="0.1.0",
)


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class ParseRequest(BaseModel):
    match_id: str
    gcs_uri: str | None = None  # Required in cloud mode
    dem_path: str | None = None  # Required in LOCAL_MODE


class ParseResponse(BaseModel):
    match_id: str
    status: str
    map: str
    total_rounds: int
    kills: int
    grenades: int
    trajectories: int
    gcs_parsed_uri: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    return {"status": "ok", "service": "scout"}


@app.post("/internal/scout/parse-from-gcs", include_in_schema=False)
async def parse_from_pubsub(request: dict):
    """
    Pub/Sub push subscription endpoint.
    Called automatically when a .dem file lands in GCS demos/raw/.

    Pub/Sub push format:
      { "message": { "data": "<base64 JSON>", ... }, "subscription": "..." }

    GCS notification data (decoded):
      { "bucket": "cs2-demosage", "name": "demos/raw/{match_id}/{file}.dem", ... }
    """
    import base64
    import json as _json

    try:
        message = request.get("message", {})
        raw = message.get("data", "")
        gcs_event = _json.loads(base64.b64decode(raw).decode("utf-8"))
    except Exception as e:
        logger.error(f"[Scout] Failed to decode Pub/Sub message: {e}")
        # Return 200 so Pub/Sub doesn't retry a malformed message
        return {"status": "skipped", "reason": "decode_error"}

    bucket = gcs_event.get("bucket", "")
    obj_path = gcs_event.get("name", "")  # demos/raw/{match_id}/{filename}

    # Only process files in the demos/raw/ prefix
    if not obj_path.startswith("demos/raw/") or not obj_path.endswith(".dem"):
        logger.info(f"[Scout] Skipping non-demo object: {obj_path}")
        return {"status": "skipped", "reason": "not_a_demo"}

    # Extract match_id from path: demos/raw/{match_id}/{filename}.dem
    parts = obj_path.split("/")
    if len(parts) < 3:
        logger.error(f"[Scout] Unexpected GCS path format: {obj_path}")
        return {"status": "skipped", "reason": "bad_path"}

    match_id = parts[2]
    gcs_uri = f"gs://{bucket}/{obj_path}"

    logger.info(f"[Scout] GCS trigger: match={match_id} uri={gcs_uri}")

    # Reuse the existing parse logic
    return await parse_match(ParseRequest(match_id=match_id, gcs_uri=gcs_uri))


@app.post("/internal/scout/parse", response_model=ParseResponse)
async def parse_match(req: ParseRequest):
    """
    Main parse endpoint — called by Cloud Tasks or directly in local mode.
    Downloads demo, parses it, writes to DB, uploads results to GCS.
    """
    from parse_demo import parse_demo, upload_to_gcs, write_to_db

    logger.info(f"[Scout] Starting parse for match {req.match_id}")

    # --- Resolve demo file ---
    if LOCAL_MODE:
        if not req.dem_path:
            raise HTTPException(
                status_code=400,
                detail="LOCAL_MODE=true requires dem_path in request body",
            )
        dem_file = req.dem_path
        tmp_file = None
    else:
        if not req.gcs_uri:
            raise HTTPException(
                status_code=400,
                detail="gcs_uri is required in cloud mode",
            )
        # Download demo from GCS to a temp file
        tmp_file = _download_from_gcs(req.gcs_uri, req.match_id)
        dem_file = tmp_file

    try:
        # --- Parse ---
        result = parse_demo(dem_file)

        # --- Write to DB ---
        write_to_db(result, req.match_id)

        # --- Upload parsed JSON to GCS (cloud mode only) ---
        gcs_parsed_uri = None
        if not LOCAL_MODE:
            gcs_parsed_uri = upload_to_gcs(result, req.match_id)
        else:
            # Save locally for inspection
            out = Path(f"/tmp/{req.match_id}_scout.json")
            out.write_text(json.dumps(result, indent=2))
            logger.info(f"Local output: {out}")

        meta = result.get("metadata", {})
        response = ParseResponse(
            match_id=req.match_id,
            status="complete",
            map=meta.get("map", "unknown"),
            total_rounds=meta.get("total_rounds", 0),
            kills=len(result.get("kills", [])),
            grenades=len(result.get("grenades", [])),
            trajectories=len(result.get("trajectories", [])),
            gcs_parsed_uri=gcs_parsed_uri,
        )

        # Trigger AI coaching asynchronously (fire-and-forget)
        _trigger_coaching(req.match_id)

        return response

    except Exception as exc:
        logger.error(f"[Scout] Parse failed for {req.match_id}: {exc}")
        # Mark match as failed in DB
        _mark_failed(req.match_id, str(exc))
        raise HTTPException(status_code=500, detail=f"Parse failed: {exc}") from exc

    finally:
        if tmp_file and Path(tmp_file).exists():
            Path(tmp_file).unlink()
            logger.info(f"Cleaned up temp file: {tmp_file}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _download_from_gcs(gcs_uri: str, match_id: str) -> str:
    """Download a GCS object to a temp file and return the local path."""
    from google.cloud import storage  # noqa: PLC0415

    # Parse gs://bucket/path
    without_scheme = gcs_uri.replace("gs://", "")
    bucket_name, blob_path = without_scheme.split("/", 1)

    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_path)

    suffix = Path(blob_path).suffix or ".dem"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix=f"{match_id}_")
    blob.download_to_filename(tmp.name)
    logger.info(f"Downloaded {gcs_uri} → {tmp.name}")
    return tmp.name


def _trigger_coaching(match_id: str) -> None:
    """Fire-and-forget: ask the API to run Great Khan coaching for this match."""
    import threading  # noqa: PLC0415

    def _call():
        try:
            import httpx  # noqa: PLC0415

            api_url = os.getenv("API_INTERNAL_URL", "http://localhost:8000")
            httpx.post(f"{api_url}/api/coaching/{match_id}", timeout=5)
            logger.info(f"[Scout] Coaching triggered for {match_id}")
        except Exception as e:
            logger.warning(f"[Scout] Coaching trigger failed (non-fatal): {e}")

    threading.Thread(target=_call, daemon=True).start()


def _mark_failed(match_id: str, error: str) -> None:
    """Update match status to FAILED in the database."""
    try:
        from db.database import SessionLocal
        from db.models import Match, MatchStatus

        db = SessionLocal()
        match = db.get(Match, match_id)
        if match:
            match.status = MatchStatus.FAILED
            match.error_message = error[:500]
            db.commit()
        db.close()
    except Exception as db_err:
        logger.error(f"Could not mark match failed in DB: {db_err}")


# ---------------------------------------------------------------------------
# Dev server entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8001")))
