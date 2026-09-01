"""
Sync outbox claim helpers — same SKIP LOCKED discipline as db/jobs.py.
The worker drains this between job claims; HTTP handlers only insert.
"""

from datetime import UTC, datetime, timedelta
import logging

from sqlalchemy.orm import Session

from db.models import OutboxStatus, SyncOutbox

logger = logging.getLogger(__name__)

STUCK_OUTBOX_TIMEOUT = timedelta(minutes=10)


def claim_next(db: Session, worker_id: str) -> SyncOutbox | None:
    """Claim the oldest pending outbox item; short claim transaction."""
    item = (
        db.query(SyncOutbox)
        .filter(SyncOutbox.status == OutboxStatus.PENDING)
        .order_by(SyncOutbox.created_at)
        .with_for_update(skip_locked=True)
        .first()
    )
    if item is None:
        db.rollback()
        return None
    item.status = OutboxStatus.RUNNING
    item.claimed_at = datetime.now(UTC)
    item.attempts += 1
    db.commit()
    logger.info(f"Worker {worker_id} claimed outbox {item.id} ({item.kind})")
    return item


def complete(db: Session, item: SyncOutbox) -> None:
    """Docstring for complete."""
    item.status = OutboxStatus.DONE
    db.commit()


def fail(db: Session, item: SyncOutbox, error: str) -> None:
    """Requeue with attempts left, else mark failed; keep the last error."""
    item.error_message = error[:2000]
    if item.attempts < item.max_attempts:
        item.status = OutboxStatus.PENDING
        item.claimed_at = None
        logger.warning(f"Outbox {item.id} failed (attempt {item.attempts}), requeued: {error}")
    else:
        item.status = OutboxStatus.FAILED
        logger.error(f"Outbox {item.id} failed permanently: {error}")
    db.commit()


def requeue_stuck(db: Session) -> int:
    """Docstring for requeue_stuck."""
    cutoff = datetime.now(UTC) - STUCK_OUTBOX_TIMEOUT
    stuck = (
        db.query(SyncOutbox)
        .filter(SyncOutbox.status == OutboxStatus.RUNNING, SyncOutbox.claimed_at < cutoff)
        .with_for_update(skip_locked=True)
        .all()
    )
    for item in stuck:
        item.status = OutboxStatus.PENDING
        item.claimed_at = None
    db.commit()
    return len(stuck)
