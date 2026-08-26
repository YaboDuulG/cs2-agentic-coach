"""
DemoSage — Job Queue
=====================
Postgres-backed work queue for the parse → coach pipeline.

Workers claim jobs with SELECT ... FOR UPDATE SKIP LOCKED so concurrent
workers never block each other or double-claim (10x queue throughput vs a
plain FOR UPDATE — see supabase-postgres-best-practices lock-skip-locked).
On SQLite (CI / tests) SQLAlchemy omits the locking clause, which is safe for
the single-threaded test path.

The claim transaction is kept short: claim, commit, then do the actual work
outside the transaction (lock-short-transactions).
"""

from datetime import UTC, datetime, timedelta
import logging

from sqlalchemy.orm import Session

from db.models import Job, JobKind, JobStatus

logger = logging.getLogger(__name__)

# A running job with no heartbeat for this long is assumed dead and requeued.
STUCK_JOB_TIMEOUT = timedelta(minutes=10)


def enqueue_job(db: Session, match_id: str, kind: JobKind, *, dedupe: bool = True) -> Job | None:
    """
    Add a job to the queue. With dedupe (default), skips insertion when a
    pending or running job of the same kind already exists for the match —
    the coaching self-heal path can fire repeatedly and must not fan out.
    """
    if dedupe:
        existing = (
            db.query(Job)
            .filter(
                Job.match_id == match_id,
                Job.kind == kind,
                Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
            )
            .first()
        )
        if existing:
            logger.info(f"Job {kind.value} for match {match_id} already queued (id={existing.id})")
            return None

    job = Job(match_id=match_id, kind=kind, status=JobStatus.PENDING)
    db.add(job)
    db.commit()
    logger.info(f"Enqueued {kind.value} job {job.id} for match {match_id}")
    return job


def claim_next_job(db: Session, kind: JobKind, worker_id: str) -> Job | None:
    """
    Claim the oldest pending job of the given kind, or None if the queue is
    empty. The row lock is held only for the claim transaction itself.
    """
    job = (
        db.query(Job)
        .filter(Job.kind == kind, Job.status == JobStatus.PENDING)
        .order_by(Job.created_at)
        .with_for_update(skip_locked=True)
        .first()
    )
    if job is None:
        db.rollback()
        return None

    job.status = JobStatus.RUNNING
    job.claimed_by = worker_id
    job.claimed_at = datetime.now(UTC)
    job.attempts += 1
    db.commit()
    logger.info(f"Worker {worker_id} claimed {kind.value} job {job.id} (match {job.match_id})")
    return job


def complete_job(db: Session, job: Job) -> None:
    """Docstring for complete_job."""
    job.status = JobStatus.DONE
    db.commit()


def fail_job(db: Session, job: Job, error: str) -> None:
    """
    Mark a job failed, or requeue it when attempts remain. The error message
    is kept either way so the last failure is always visible.
    """
    job.error_message = error[:2000]
    if job.attempts < job.max_attempts:
        job.status = JobStatus.PENDING
        job.claimed_by = None
        job.claimed_at = None
        logger.warning(f"Job {job.id} failed (attempt {job.attempts}/{job.max_attempts}), requeued: {error}")
    else:
        job.status = JobStatus.FAILED
        logger.error(f"Job {job.id} failed permanently after {job.attempts} attempts: {error}")
    db.commit()


def requeue_stuck_jobs(db: Session) -> int:
    """
    Return running jobs whose worker died back to the queue. Called
    opportunistically by workers between claims.
    """
    cutoff = datetime.now(UTC) - STUCK_JOB_TIMEOUT
    stuck = (
        db.query(Job)
        .filter(Job.status == JobStatus.RUNNING, Job.claimed_at < cutoff)
        .with_for_update(skip_locked=True)
        .all()
    )
    for job in stuck:
        logger.warning(f"Requeueing stuck job {job.id} (claimed by {job.claimed_by} at {job.claimed_at})")
        job.status = JobStatus.PENDING
        job.claimed_by = None
        job.claimed_at = None
    db.commit()
    return len(stuck)
