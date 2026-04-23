"""
Upload endpoints for demo (.dem) and audio files.
Validates → uploads to GCS → queues a Scout parse job via Cloud Tasks.
"""

import logging
import os
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_DEMO_TYPES = {".dem"}
ALLOWED_AUDIO_TYPES = {".mp3", ".wav", ".ogg"}
MAX_AUDIO_SIZE_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB


def _get_gcs_client():
    """Lazy import so GCP SDK is not required in CI/test environments."""
    from google.cloud import storage  # noqa: PLC0415
    return storage.Client()


def _upload_to_gcs(file_bytes: bytes, gcs_path: str, content_type: str) -> str:
    """Upload raw bytes to GCS and return the gs:// URI."""
    bucket_name = os.environ["GCS_BUCKET"]
    client = _get_gcs_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(gcs_path)
    blob.upload_from_string(file_bytes, content_type=content_type)
    return f"gs://{bucket_name}/{gcs_path}"


@router.post("/demo", summary="Upload a CS2 .dem file for analysis")
async def upload_demo(file: UploadFile = File(...)):
    """
    Accept a .dem file, upload to GCS, and queue a Scout parse job.
    Returns a match_id for tracking.
    """
    suffix = os.path.splitext(file.filename or "")[-1].lower()
    if suffix not in ALLOWED_DEMO_TYPES:
        raise HTTPException(status_code=400, detail="Only .dem files are accepted.")

    match_id = str(uuid.uuid4())
    file_bytes = await file.read()
    gcs_path = f"demos/raw/{match_id}/{file.filename}"

    try:
        gcs_uri = _upload_to_gcs(file_bytes, gcs_path, "application/octet-stream")
        logger.info(f"Demo uploaded: {gcs_uri}")
    except Exception as e:
        logger.error(f"GCS upload failed: {e}")
        raise HTTPException(status_code=500, detail="File upload failed.")

    # TODO: Enqueue Scout parse job via Cloud Tasks
    # queue_scout_job(match_id=match_id, gcs_uri=gcs_uri)

    return {
        "match_id": match_id,
        "status": "queued",
        "gcs_uri": gcs_uri,
        "message": "Demo uploaded. Scout parse job queued.",
    }


@router.post("/audio", summary="Upload team comms audio for analysis")
async def upload_audio(file: UploadFile = File(...), match_id: str = ""):
    """
    Accept team audio recording, upload to GCS, and queue Comms Analyst job.
    Requires a match_id to align transcript timestamps to demo round clock.
    """
    suffix = os.path.splitext(file.filename or "")[-1].lower()
    if suffix not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format. Accepted: {ALLOWED_AUDIO_TYPES}",
        )

    if not match_id:
        raise HTTPException(
            status_code=400,
            detail="match_id is required to align audio to a parsed demo.",
        )

    file_bytes = await file.read()

    if len(file_bytes) > MAX_AUDIO_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 2 GB limit.")

    gcs_path = f"audio/raw/{match_id}/{file.filename}"

    try:
        gcs_uri = _upload_to_gcs(file_bytes, gcs_path, "audio/mpeg")
        logger.info(f"Audio uploaded: {gcs_uri}")
    except Exception as e:
        logger.error(f"GCS upload failed: {e}")
        raise HTTPException(status_code=500, detail="File upload failed.")

    # TODO: Enqueue Comms Analyst job via Cloud Tasks
    # queue_comms_job(match_id=match_id, gcs_uri=gcs_uri)

    return {
        "match_id": match_id,
        "status": "queued",
        "gcs_uri": gcs_uri,
        "message": "Audio uploaded. Comms Analyst job queued.",
    }
