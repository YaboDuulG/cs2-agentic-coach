"""
Presigned GCS upload URL endpoint.
Browser uploads .dem files directly to GCS — bypasses Vercel's 4.5MB body limit.
"""

from datetime import timedelta
import logging
import os
import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_DEMO_SIZE_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB hard cap


class PresignRequest(BaseModel):
    filename: str
    size_bytes: int = 0
    team_id: str | None = None
    chunk_count: int = 1


@router.post("/presign", summary="Get a presigned GCS URL for direct browser upload")
async def presign_demo_upload(body: PresignRequest, request: Request):
    """
    Returns a short-lived presigned PUT URL (or list of URLs for chunked upload)
    so the browser can upload directly to GCS.
    """
    if not body.filename.endswith(".dem") and not body.filename.endswith(".dem.gz"):
        raise HTTPException(status_code=400, detail="Only .dem or .dem.gz files are accepted.")

    if body.size_bytes > MAX_DEMO_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 2GB limit.")

    match_id = str(uuid.uuid4())
    bucket_name = os.environ.get("GCS_BUCKET", "").strip()
    local_mode = os.getenv("LOCAL_MODE", "false").lower() == "true"
    user_id = request.headers.get("x-clerk-user-id")

    # Verify team membership if uploading to a team
    if body.team_id:
        if not user_id:
            raise HTTPException(status_code=403, detail="Upload to a team requires user authentication.")
        from sqlalchemy import text  # noqa: PLC0415

        from db.database import SessionLocal  # noqa: PLC0415
        db = SessionLocal()
        try:
            member_check = db.execute(
                text("SELECT 1 FROM team_members WHERE team_id = :team_id AND user_id = :user_id"),
                {"team_id": body.team_id, "user_id": user_id},
            ).fetchone()
            if not member_check:
                raise HTTPException(status_code=403, detail="You are not a member of this team.")
        finally:
            db.close()

    # Create match record in DB immediately so jobs endpoint returns 'queued'
    _create_match_record(match_id, body.filename, user_id, body.team_id)

    if local_mode or not bucket_name:
        # Local dev: return a fake presigned URL(s)
        if body.chunk_count > 1:
            urls = [f"http://localhost:8000/api/upload/stub/{match_id}/part_{i}" for i in range(body.chunk_count)]
            return {
                "match_id": match_id,
                "upload_urls": urls,
                "gcs_path": f"uploads/temp/{match_id}/{body.filename}",
                "local_mode": True,
            }
        return {
            "match_id": match_id,
            "upload_url": f"http://localhost:8000/api/upload/stub/{match_id}",
            "gcs_path": f"demos/raw/{match_id}/{body.filename}",
            "local_mode": True,
        }

    try:
        import json

        from google.cloud import storage  # noqa: PLC0415
        from google.oauth2 import service_account

        # If GCP_SA_KEY is mounted, use it to initialize client and sign
        sa_key_json = os.environ.get("GCP_SA_KEY")
        if sa_key_json:
            creds = service_account.Credentials.from_service_account_info(json.loads(sa_key_json))
            client = storage.Client(credentials=creds)
        else:
            client = storage.Client()

        bucket = client.bucket(bucket_name)

        if body.chunk_count > 1:
            upload_urls = []
            for i in range(body.chunk_count):
                # Save chunk files outside the demos/raw/ path so they don't trigger Pub/Sub prematurely
                gcs_path = f"uploads/temp/{match_id}/part_{i}"
                blob = bucket.blob(gcs_path)
                url = blob.generate_signed_url(
                    version="v4",
                    expiration=timedelta(minutes=30),
                    method="PUT",
                    content_type="application/octet-stream",
                )
                upload_urls.append(url)

            logger.info(f"Presigned URLs generated for {body.chunk_count} chunks of {body.filename}")
            return {
                "match_id": match_id,
                "upload_urls": upload_urls,
                "gcs_path": f"gs://{bucket_name}/uploads/temp/{match_id}",
                "local_mode": False,
            }

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


class ComposeRequest(BaseModel):
    match_id: str
    filename: str
    chunk_count: int
    team_id: str | None = None


@router.post("/compose", summary="Compose uploaded GCS chunks into a single demo file")
async def compose_chunks(body: ComposeRequest, request: Request):
    """
    Stitches multiple temporary parts of a chunked upload into a single GCS object
    using GCS compose operation, then deletes the temporary parts.
    """
    bucket_name = os.environ.get("GCS_BUCKET", "").strip()
    local_mode = os.getenv("LOCAL_MODE", "false").lower() == "true"
    user_id = request.headers.get("x-clerk-user-id")

    # Verify team membership if uploading to a team
    if body.team_id:
        if not user_id:
            raise HTTPException(status_code=403, detail="Composition for a team requires user authentication.")
        from sqlalchemy import text  # noqa: PLC0415

        from db.database import SessionLocal  # noqa: PLC0415
        db = SessionLocal()
        try:
            member_check = db.execute(
                text("SELECT 1 FROM team_members WHERE team_id = :team_id AND user_id = :user_id"),
                {"team_id": body.team_id, "user_id": user_id},
            ).fetchone()
            if not member_check:
                raise HTTPException(status_code=403, detail="You are not a member of this team.")
        finally:
            db.close()

    if local_mode or not bucket_name:
        logger.info(f"LOCAL_MODE mock composition for match_id: {body.match_id}")
        return {"ok": True, "match_id": body.match_id, "local_mode": True}

    try:
        import json

        from google.cloud import storage  # noqa: PLC0415
        from google.oauth2 import service_account

        sa_key_json = os.environ.get("GCP_SA_KEY")
        if sa_key_json:
            creds = service_account.Credentials.from_service_account_info(json.loads(sa_key_json))
            client = storage.Client(credentials=creds)
        else:
            client = storage.Client()

        bucket = client.bucket(bucket_name)
        final_gcs_path = f"demos/raw/{body.match_id}/{body.filename}"

        # Fetch and verify parts
        source_blobs = []
        for i in range(body.chunk_count):
            part_path = f"uploads/temp/{body.match_id}/part_{i}"
            part_blob = bucket.blob(part_path)
            if not part_blob.exists():
                raise HTTPException(status_code=400, detail=f"Chunk part {i} does not exist in GCS.")
            source_blobs.append(part_blob)

        # Compose them into the final file
        final_blob = bucket.blob(final_gcs_path)
        final_blob.content_type = "application/octet-stream"
        logger.info(f"Composing {body.chunk_count} blobs into {final_gcs_path}...")

        if len(source_blobs) <= 32:
            final_blob.compose(source_blobs)
        else:
            # Batch composition due to GCS 32 object limit
            intermediate_blobs = []
            for i in range(0, len(source_blobs), 32):
                batch = source_blobs[i:i + 32]
                intermediate_blob = bucket.blob(f"uploads/temp/{body.match_id}/intermediate_{i//32}")
                intermediate_blob.content_type = "application/octet-stream"
                intermediate_blob.compose(batch)
                intermediate_blobs.append(intermediate_blob)

            # Compose intermediates to final
            final_blob.compose(intermediate_blobs)

            # Add intermediate blobs to source_blobs so they get deleted below
            source_blobs.extend(intermediate_blobs)

        # Delete chunk parts
        logger.info(f"Deleting {body.chunk_count} temporary source chunks...")
        for part_blob in source_blobs:
            try:
                part_blob.delete()
            except Exception as del_err:
                logger.warning(f"Failed to delete temporary chunk {part_blob.name}: {del_err}")

        # In case the Pub/Sub trigger doesn't execute (e.g. locally or trigger issue),
        # return the URI details. The finalized file in demos/raw/ will trigger GCS Eventarc.
        return {
            "ok": True,
            "match_id": body.match_id,
            "gcs_uri": f"gs://{bucket_name}/{final_gcs_path}",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Composition failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to compose demo file: {e}")


@router.put("/stub/{match_id}", include_in_schema=False)
@router.put("/stub/{match_id}/{part_name}", include_in_schema=False)
async def stub_upload(match_id: str, part_name: str | None = None):
    """Local dev stub — accepts the PUT from the browser in LOCAL_MODE."""
    return {"ok": True, "match_id": match_id, "part_name": part_name}


def _create_match_record(
    match_id: str, filename: str, user_id: str | None = None, team_id: str | None = None
) -> None:
    """Insert a queued match row so /api/jobs/{id} returns 'queued' immediately."""
    try:
        from sqlalchemy import text  # noqa: PLC0415

        from db.database import SessionLocal  # noqa: PLC0415

        db = SessionLocal()
        try:
            db.execute(
                text("""
                    INSERT INTO matches (
                        match_id, map_name, tickrate, total_rounds,
                        demo_filename, status, user_id, team_id, created_at, updated_at
                    )
                    VALUES (:id, 'unknown', 64, 0, :filename, 'PENDING', :user_id, :team_id, NOW(), NOW())
                    ON CONFLICT (match_id) DO NOTHING
                """),
                {"id": match_id, "filename": filename, "user_id": user_id, "team_id": team_id},
            )
            db.commit()
        finally:
            db.close()
    except Exception as e:
        # Non-fatal — DB might not have tables yet (first deploy)
        logger.warning(f"Could not create match record for {match_id}: {e}")
