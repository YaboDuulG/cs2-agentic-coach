"""
Job queue tests — SQLite in-memory, so SKIP LOCKED is exercised only as a
no-op clause; the claim/complete/fail/requeue state machine is what's under
test here.
"""

from datetime import UTC, datetime, timedelta
import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from db.jobs import claim_next_job, complete_job, enqueue_job, fail_job, requeue_stuck_jobs
from db.models import Base, Job, JobKind, JobStatus, Match

TEST_MATCH_ID = "queue-test-match-000"


@pytest.fixture()
def db_session():
    """Fresh in-memory DB per test — queue tests mutate global job state."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    session.add(Match(match_id=TEST_MATCH_ID, map_name="de_mirage", tickrate=64, total_rounds=0))
    session.commit()
    yield session
    session.close()


def test_enqueue_and_claim(db_session):
    """Docstring for test_enqueue_and_claim."""
    job = enqueue_job(db_session, TEST_MATCH_ID, JobKind.PARSE)
    assert job is not None
    assert job.status == JobStatus.PENDING

    claimed = claim_next_job(db_session, JobKind.PARSE, "worker-1")
    assert claimed is not None
    assert claimed.id == job.id
    assert claimed.status == JobStatus.RUNNING
    assert claimed.claimed_by == "worker-1"
    assert claimed.attempts == 1

    # Queue is now empty for this kind
    assert claim_next_job(db_session, JobKind.PARSE, "worker-2") is None


def test_enqueue_dedupes_pending_jobs(db_session):
    """A second enqueue of the same kind while one is pending is a no-op."""
    first = enqueue_job(db_session, TEST_MATCH_ID, JobKind.COACH)
    duplicate = enqueue_job(db_session, TEST_MATCH_ID, JobKind.COACH)
    assert first is not None
    assert duplicate is None
    assert db_session.query(Job).filter_by(kind=JobKind.COACH).count() == 1

    # A different kind is not deduped against it
    assert enqueue_job(db_session, TEST_MATCH_ID, JobKind.PARSE) is not None


def test_claim_respects_kind(db_session):
    """Docstring for test_claim_respects_kind."""
    enqueue_job(db_session, TEST_MATCH_ID, JobKind.COACH)
    assert claim_next_job(db_session, JobKind.PARSE, "worker-1") is None
    assert claim_next_job(db_session, JobKind.COACH, "worker-1") is not None


def test_fail_requeues_until_max_attempts(db_session):
    """Docstring for test_fail_requeues_until_max_attempts."""
    enqueue_job(db_session, TEST_MATCH_ID, JobKind.PARSE)

    for attempt in range(1, 4):
        job = claim_next_job(db_session, JobKind.PARSE, "worker-1")
        assert job is not None, f"attempt {attempt} should be claimable"
        fail_job(db_session, job, f"boom {attempt}")

    final = db_session.query(Job).one()
    assert final.status == JobStatus.FAILED
    assert final.attempts == 3
    assert "boom 3" in final.error_message

    assert claim_next_job(db_session, JobKind.PARSE, "worker-1") is None


def test_complete_job(db_session):
    """Docstring for test_complete_job."""
    enqueue_job(db_session, TEST_MATCH_ID, JobKind.PARSE)
    job = claim_next_job(db_session, JobKind.PARSE, "worker-1")
    complete_job(db_session, job)
    assert db_session.query(Job).one().status == JobStatus.DONE


def test_requeue_stuck_jobs(db_session):
    """A running job with an old claim timestamp goes back to pending."""
    enqueue_job(db_session, TEST_MATCH_ID, JobKind.PARSE)
    job = claim_next_job(db_session, JobKind.PARSE, "worker-dead")
    # Simulate a worker that died 20 minutes ago
    job.claimed_at = datetime.now(UTC) - timedelta(minutes=20)
    db_session.commit()

    assert requeue_stuck_jobs(db_session) == 1
    refreshed = db_session.query(Job).one()
    assert refreshed.status == JobStatus.PENDING
    assert refreshed.claimed_by is None

    # Fresh claims are not swept
    job = claim_next_job(db_session, JobKind.PARSE, "worker-2")
    assert job is not None
    assert requeue_stuck_jobs(db_session) == 0
