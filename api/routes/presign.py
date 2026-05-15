"""
Presigned GCS upload URL endpoint.
Browser uploads .dem files directly to GCS — bypasses Vercel's 4.5MB body limit.
"""

import logging
import os
import uuid
from datetime import timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_DEMO_SIZE_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB hard cap


class PresignRequest(BaseModel):
    filename: str
    size_bytes: int = 0


@router.post("/presign", summary="Get a presigned GCS URL for direct browser upload")
async def presign_demo_upload(body: PresignRequest):
    """
    Returns a short-lived presigned PUT URL so the browser can upload
    directly to GCS without proxying through the API server.

    Flow:
      1. Browser POST /api/upload/presign → gets { match_id, upload_url }
      2. Browser PUT upload_url (with file bytes) → file lands in GCS
      3. Browser POST /api/jobs/{match_id}/start → triggers Scout parse job
    """
    if not body.filename.endswith(".dem"):
        raise HTTPException(status_code=400, detail="Only .dem files are accepted.")

    if body.size_bytes > MAX_DEMO_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 2GB limit.")

    match_id = str(uuid.uuid4())
    bucket_name = os.environ.get("GCS_BUCKET", "")
    local_mode = os.getenv("LOCAL_MODE", "false").lower() == "true"

    # Create match record in DB immediately so jobs endpoint returns 'queued'
    _create_match_record(match_id, body.filename)

    if local_mode or not bucket_name:
        # Local dev: return a fake presigned URL
        return {
            "match_id": match_id,
            "upload_url": f"http://localhost:8000/api/upload/stub/{match_id}",
            "gcs_path": f"demos/raw/{match_id}/{body.filename}",
            "local_mode": True,
        }

    try:
        from google.cloud import storage  # noqa: PLC0415

        client = storage.Client()
        bucket = client.bucket(bucket_name)
        gcs_path = f"demos/raw/{match_id}/{body.filename}"
        blob = bucket.blob(gcs_path)

        upload_url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=30),
            method="PUT",
            content_type="application/octet-stream",
        )

        logger.info(f"Presigned URL generated: {gcs_path}")
        return {
            "match_id": match_id,
            "upload_url": upload_url,
            "gcs_path": f"gs://{bucket_name}/{gcs_path}",
            "local_mode": False,
        }
    except Exception as e:
        logger.error(f"Presign failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate upload URL.")


@router.post("/stub/{match_id}", include_in_schema=False)
async def stub_upload(match_id: str):
    """Local dev stub — accepts the PUT from the browser in LOCAL_MODE."""
    return {"ok": True, "match_id": match_id}


def _create_match_record(match_id: str, filename: str) -> None:
    """Insert a queued match row so /api/jobs/{id} returns 'queued' immediately."""
    try:
        from db.database import SessionLocal  # noqa: PLC0415
        from sqlalchemy import text  # noqa: PLC0415

        db = SessionLocal()
        try:
            db.execute(
                text("""
                    INSERT INTO matches (id, demo_filename, status, created_at)
                    VALUES (:id, :filename, 'queued', NOW())
                    ON CONFLICT (id) DO NOTHING
                """),
                {"id": match_id, "filename": filename},
            )
            db.commit()
        finally:
            db.close()
    except Exception as e:
        # Non-fatal — DB might not have tables yet (first deploy)
        logger.warning(f"Could not create match record for {match_id}: {e}")
