"""Module docstring."""
from fastapi import Depends
from sqlalchemy.orm import Session

from db.database import get_session

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
    """Docstring for PresignRequest."""
    filename: str
    size_bytes: int = 0
    team_id: str | None = None
    chunk_count: int = 1
    is_recon: bool = False
    # Cheap content identity computed in the browser:
    # "<size>:<sha256 of first 1MB>:<sha256 of last 1MB>". Optional — without
    # it the upload proceeds, it just can't dedupe.
    fingerprint: str | None = None


@router.post("/presign", summary="Get a presigned GCS URL for direct browser upload")
async def presign_demo_upload(body: PresignRequest, request: Request, db: Session = Depends(get_session)):
    """
    Returns a short-lived presigned PUT URL (or list of URLs for chunked upload)
    so the browser can upload directly to GCS.
    """
    secure_filename = os.path.basename(body.filename or "")
    if not secure_filename.endswith(".dem") and not secure_filename.endswith(".dem.gz"):
        raise HTTPException(status_code=400, detail="Only .dem or .dem.gz files are accepted.")

    if body.size_bytes > MAX_DEMO_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 2GB limit.")

    match_id = str(uuid.uuid4())
    demo_id = str(uuid.uuid4())
    bucket_name = os.environ.get("GCS_BUCKET", "").strip()
    local_mode = os.getenv("LOCAL_MODE", "false").lower() == "true"
    user_id = request.headers.get("x-clerk-user-id")
    uploader_steam_id = request.headers.get("x-clerk-user-steam-id")

    # Verify team membership if uploading to a team
    if body.team_id:
        if not user_id:
            raise HTTPException(
                status_code=403, detail="Upload to a team requires user authentication."
            )
        from sqlalchemy import text  # noqa: PLC0415

        member_check = db.execute(
            text("SELECT 1 FROM team_members WHERE team_id = :team_id AND user_id = :user_id"),
            {"team_id": body.team_id, "user_id": user_id},
        ).fetchone()
        if not member_check:
            raise HTTPException(status_code=403, detail="You are not a member of this team.")

    # Dedupe: if a non-failed demo with this content fingerprint exists, the
    # file is already (being) stored and parsed — attach a new match to it and
    # skip the upload entirely. Ten teammates, one upload, one parse.
    if body.fingerprint:
        from db.models import Demo, MatchStatus  # noqa: PLC0415

        existing = (
            db.query(Demo)
            .filter(
                Demo.demo_fingerprint == body.fingerprint,
                Demo.status != MatchStatus.FAILED,
            )
            .order_by(Demo.created_at)
            .first()
        )
        if existing is not None:
            _create_records(
                existing.demo_id,
                match_id,
                secure_filename,
                user_id,
                body.team_id,
                uploader_steam_id,
                body.is_recon,
                fingerprint=None,  # demo row already exists
                gcs_demo_uri=None,
                demo_exists=True,
            )
            if existing.status == MatchStatus.COMPLETE:
                _enqueue_coach_safe(match_id)
            logger.info(
                f"Duplicate demo {existing.demo_id} (fingerprint match) — "
                f"match {match_id} attached, upload skipped"
            )
            return {
                "match_id": match_id,
                "duplicate": True,
                "demo_status": str(existing.status.value if hasattr(existing.status, "value") else existing.status),
            }

    # The final object location is known up front for both upload shapes —
    # store it on the demo so parse jobs only ever need a demo_id.
    final_path = f"demos/raw/{demo_id}/{secure_filename}"
    gcs_demo_uri = f"gs://{bucket_name}/{final_path}" if bucket_name else final_path

    # Create demo + match records immediately so jobs endpoint returns 'queued'
    _create_records(
        demo_id,
        match_id,
        secure_filename,
        user_id,
        body.team_id,
        uploader_steam_id,
        body.is_recon,
        fingerprint=body.fingerprint,
        gcs_demo_uri=gcs_demo_uri,
    )

    if local_mode or not bucket_name:
        # Local dev: return a fake presigned URL(s)
        if body.chunk_count > 1:
            urls = [
                f"http://localhost:8000/api/upload/stub/{match_id}/part_{i}"
                for i in range(body.chunk_count)
            ]
            return {
                "match_id": match_id,
                "upload_urls": urls,
                "gcs_path": f"uploads/temp/{match_id}/{secure_filename}",
                "local_mode": True,
            }
        return {
            "match_id": match_id,
            "upload_url": f"http://localhost:8000/api/upload/stub/{match_id}",
            "gcs_path": f"demos/raw/{match_id}/{secure_filename}",
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
                gcs_path = f"uploads/temp/{demo_id}/part_{i}"
                blob = bucket.blob(gcs_path)
                url = blob.generate_signed_url(
                    version="v4",
                    expiration=timedelta(minutes=30),
                    method="PUT",
                    content_type="application/octet-stream",
                )
                upload_urls.append(url)

            logger.info(
                f"Presigned URLs generated for {body.chunk_count} chunks of {body.filename}"
            )
            return {
                "match_id": match_id,
                "upload_urls": upload_urls,
                "gcs_path": f"gs://{bucket_name}/uploads/temp/{demo_id}",
                "local_mode": False,
            }

        gcs_path = final_path
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
    """Docstring for ComposeRequest."""
    match_id: str
    filename: str
    chunk_count: int
    team_id: str | None = None


@router.post("/compose", summary="Compose uploaded GCS chunks into a single demo file")
async def compose_chunks(body: ComposeRequest, request: Request, db: Session = Depends(get_session)):
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
            raise HTTPException(
                status_code=403, detail="Composition for a team requires user authentication."
            )
        from sqlalchemy import text  # noqa: PLC0415

        member_check = db.execute(
            text("SELECT 1 FROM team_members WHERE team_id = :team_id AND user_id = :user_id"),
            {"team_id": body.team_id, "user_id": user_id},
        ).fetchone()
        if not member_check:
            raise HTTPException(status_code=403, detail="You are not a member of this team.")

    if local_mode or not bucket_name:
        logger.info(f"LOCAL_MODE mock composition for match_id: {body.match_id}")
        _enqueue_parse(body.match_id)
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
        secure_filename = os.path.basename(body.filename or "")
        demo_id = _demo_id_for_match(body.match_id)
        if not demo_id:
            raise HTTPException(status_code=404, detail="Match has no demo record.")
        final_gcs_path = f"demos/raw/{demo_id}/{secure_filename}"

        # Fetch and verify parts
        source_blobs = []
        for i in range(body.chunk_count):
            part_path = f"uploads/temp/{demo_id}/part_{i}"
            part_blob = bucket.blob(part_path)
            if not part_blob.exists():
                raise HTTPException(
                    status_code=400, detail=f"Chunk part {i} does not exist in GCS."
                )
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
                batch = source_blobs[i : i + 32]
                intermediate_blob = bucket.blob(
                    f"uploads/temp/{demo_id}/intermediate_{i // 32}"
                )
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

        # The composed object is final — hand the match to the parse queue.
        _enqueue_parse(body.match_id)
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


class CompleteRequest(BaseModel):
    """Docstring for CompleteRequest."""
    match_id: str


@router.post("/complete", summary="Confirm a single-chunk upload finished; queue parsing")
async def complete_upload(body: CompleteRequest, db: Session = Depends(get_session)):
    """
    Called by the browser after a single-chunk PUT succeeds (chunked uploads
    go through /compose instead). Enqueues the parse job.
    """
    _enqueue_parse(body.match_id)
    return {"ok": True, "match_id": body.match_id}


def _enqueue_parse(match_id: str) -> None:
    """Queue a parse job for the match's demo — deduped, non-fatal on queue
    errors. If the demo already finished (duplicate-upload race), queue the
    coach instead."""
    try:
        from db.database import SessionLocal  # noqa: PLC0415
        from db.jobs import enqueue_coach, enqueue_parse  # noqa: PLC0415
        from db.models import Match, MatchStatus  # noqa: PLC0415

        with SessionLocal() as job_db:
            match = job_db.query(Match).filter(Match.match_id == match_id).first()
            if match is None:
                logger.error(f"Cannot enqueue parse: match {match_id} not found")
                return
            demo = match.demo
            if demo is not None and demo.status == MatchStatus.COMPLETE:
                enqueue_coach(job_db, match_id)
            else:
                enqueue_parse(job_db, match.demo_id)
    except Exception as e:
        logger.error(f"Failed to enqueue parse job for {match_id}: {e}")


def _enqueue_coach_safe(match_id: str) -> None:
    """Docstring for _enqueue_coach_safe."""
    try:
        from db.database import SessionLocal  # noqa: PLC0415
        from db.jobs import enqueue_coach  # noqa: PLC0415

        with SessionLocal() as job_db:
            enqueue_coach(job_db, match_id)
    except Exception as e:
        logger.error(f"Failed to enqueue coach job for {match_id}: {e}")


def _demo_id_for_match(match_id: str) -> str | None:
    """Docstring for _demo_id_for_match."""
    from db.database import SessionLocal  # noqa: PLC0415
    from db.models import Match  # noqa: PLC0415

    with SessionLocal() as db:
        match = db.query(Match).filter(Match.match_id == match_id).first()
        return match.demo_id if match else None


@router.put("/stub/{match_id}", include_in_schema=False)
@router.put("/stub/{match_id}/{part_name}", include_in_schema=False)
async def stub_upload(match_id: str, part_name: str | None = None, db: Session = Depends(get_session)):
    """Local dev stub — accepts the PUT from the browser in LOCAL_MODE."""
    return {"ok": True, "match_id": match_id, "part_name": part_name}


def _create_records(
    demo_id: str,
    match_id: str,
    filename: str,
    user_id: str | None = None,
    team_id: str | None = None,
    uploader_steam_id: str | None = None,
    is_recon: bool = False,
    *,
    fingerprint: str | None = None,
    gcs_demo_uri: str | None = None,
    demo_exists: bool = False,
) -> None:
    """Insert the demo (unless attaching to an existing one) and the match
    row, so /api/jobs/{id} returns 'queued' immediately."""
    try:
        from db.database import SessionLocal  # noqa: PLC0415
        from db.models import Demo, Match  # noqa: PLC0415

        with SessionLocal() as db:
            if not demo_exists:
                db.add(
                    Demo(
                        demo_id=demo_id,
                        demo_fingerprint=fingerprint,
                        gcs_demo_uri=gcs_demo_uri,
                    )
                )
            db.add(
                Match(
                    match_id=match_id,
                    demo_id=demo_id,
                    demo_filename=filename,
                    user_id=user_id,
                    team_id=team_id,
                    uploader_steam_id=uploader_steam_id,
                    is_recon=is_recon,
                )
            )
            db.commit()
    except Exception as e:
        # Non-fatal — DB might not have tables yet (first deploy)
        logger.warning(f"Could not create records for match {match_id}: {e}")
