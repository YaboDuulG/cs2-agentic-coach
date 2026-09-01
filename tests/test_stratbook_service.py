"""
Stratbook state machine, canvas validation, and outbox enqueue tests.
"""

import json
import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from db.models import Base, OutboxStatus, StratStatus, SyncOutbox, Team
from db.outbox import claim_next, complete, fail
from services.stratbook.service import (
    InvalidCanvas,
    InvalidTransition,
    add_revision,
    create_strat,
    transition,
    validate_canvas,
)

TEAM_ID = "team-strat-test-0000"

CANVAS = {
    "steps": [
        {
            "t": 15,
            "label": "Default spread",
            "positions": {"alice": {"x": 100, "y": 200}},
            "utility": [
                {"type": "smoke", "from": {"x": 1, "y": 2}, "to": {"x": 3, "y": 4},
                 "callout": "CT smoke"}
            ],
        }
    ],
    "callouts": [{"name": "A ramp", "x": 50, "y": 60}],
}


@pytest.fixture()
def db_session():
    """Docstring for db_session."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    session.add(Team(id=TEAM_ID, name="Test Horde", owner_user_id="u1", invite_code="ABCD1234"))
    session.commit()
    yield session
    session.close()


def _make(db, **overrides):
    """Docstring for _make."""
    kwargs = dict(
        team_id=TEAM_ID, title="A Exec", map_name="de_mirage", side="T",
        buy_type="full_buy", canvas=CANVAS, description="Deep stairs + jungle smoke",
        utility=[{"type": "smoke", "callout": "Jungle"}], author_id="u1",
    )
    kwargs.update(overrides)
    strat = create_strat(db, **kwargs)
    db.commit()
    return strat


class TestStateMachine:
    """Docstring for TestStateMachine."""

    def test_create_starts_draft_with_revision_1(self, db_session):
        """Docstring for test_create_starts_draft_with_revision_1."""
        strat = _make(db_session)
        assert strat.status == StratStatus.DRAFT
        assert strat.current_revision_id is not None
        assert strat.revisions[0].revision_no == 1

    def test_happy_path_draft_review_active_archived(self, db_session):
        """Docstring for test_happy_path_draft_review_active_archived."""
        strat = _make(db_session)
        for status in (StratStatus.IN_REVIEW, StratStatus.ACTIVE, StratStatus.ARCHIVED):
            transition(db_session, strat, status, actor="u1")
        db_session.commit()
        assert strat.status == StratStatus.ARCHIVED

    def test_illegal_transitions_raise(self, db_session):
        """Docstring for test_illegal_transitions_raise."""
        strat = _make(db_session)
        with pytest.raises(InvalidTransition):
            transition(db_session, strat, StratStatus.ACTIVE, actor="u1")  # DRAFT → ACTIVE
        transition(db_session, strat, StratStatus.IN_REVIEW, actor="u1")
        transition(db_session, strat, StratStatus.ACTIVE, actor="u1")
        with pytest.raises(InvalidTransition):
            transition(db_session, strat, StratStatus.DRAFT, actor="u1")  # ACTIVE → DRAFT

    def test_revision_on_active_reenters_review(self, db_session):
        """Docstring for test_revision_on_active_reenters_review."""
        strat = _make(db_session)
        transition(db_session, strat, StratStatus.IN_REVIEW, actor="u1")
        transition(db_session, strat, StratStatus.ACTIVE, actor="u1")
        rev = add_revision(
            db_session, strat, canvas=CANVAS, description="v2", utility=None,
            author_id="u2", source="discord",
        )
        db_session.commit()
        assert strat.status == StratStatus.IN_REVIEW
        assert rev.revision_no == 2
        assert strat.current_revision_id == rev.id

    def test_archived_rejects_revisions(self, db_session):
        """Docstring for test_archived_rejects_revisions."""
        strat = _make(db_session)
        transition(db_session, strat, StratStatus.ARCHIVED, actor="u1")
        with pytest.raises(InvalidTransition):
            add_revision(db_session, strat, canvas=CANVAS, description="x",
                         utility=None, author_id="u1")


class TestCanvasValidation:
    """Docstring for TestCanvasValidation."""

    def test_valid_canvas_passes(self):
        """Docstring for test_valid_canvas_passes."""
        validate_canvas(CANVAS)

    def test_bad_utility_type_rejected(self):
        """Docstring for test_bad_utility_type_rejected."""
        bad = json.loads(json.dumps(CANVAS))
        bad["steps"][0]["utility"][0]["type"] = "nuke"
        with pytest.raises(InvalidCanvas):
            validate_canvas(bad)

    def test_missing_position_coords_rejected(self):
        """Docstring for test_missing_position_coords_rejected."""
        bad = json.loads(json.dumps(CANVAS))
        bad["steps"][0]["positions"]["alice"] = {"x": 1}
        with pytest.raises(InvalidCanvas):
            validate_canvas(bad)


class TestOutbox:
    """Docstring for TestOutbox."""

    def test_mutations_enqueue_sync_events(self, db_session):
        """Docstring for test_mutations_enqueue_sync_events."""
        strat = _make(db_session)
        transition(db_session, strat, StratStatus.IN_REVIEW, actor="u1")
        db_session.commit()
        kinds = [o.kind for o in db_session.query(SyncOutbox).order_by(SyncOutbox.id).all()]
        assert kinds == ["strat_upsert", "strat_status"]

    def test_claim_complete_and_retry(self, db_session):
        """Docstring for test_claim_complete_and_retry."""
        _make(db_session)
        item = claim_next(db_session, "w1")
        assert item is not None and item.status == OutboxStatus.RUNNING
        fail(db_session, item, "discord 500")
        assert item.status == OutboxStatus.PENDING  # retries remain
        item = claim_next(db_session, "w1")
        complete(db_session, item)
        assert item.status == OutboxStatus.DONE
        assert claim_next(db_session, "w1") is None
