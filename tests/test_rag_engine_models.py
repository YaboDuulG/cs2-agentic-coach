"""
Pro meta registry model tests — SQLite in-memory, same style as test_db_models.
Validates the four rag_engine tables: CRUD, defaults, relationships, dedupe keys.
"""

from datetime import UTC, datetime
import json
import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from db.models import Base, ProMatch, ProRound, ProStratArchetype, ProTournament

TEST_MATCH_ID = "2371001"


@pytest.fixture()
def db_session():
    """Fresh in-memory DB per test."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture()
def tournament(db_session):
    """Docstring for tournament."""
    row = ProTournament(
        hltv_event_id=7801,
        name="IEM Katowice 2026",
        tier="S",
        ends_at=datetime(2026, 2, 15, tzinfo=UTC),
    )
    db_session.add(row)
    db_session.commit()
    return row


def test_tournament_created(db_session, tournament):
    """Docstring for test_tournament_created."""
    row = db_session.query(ProTournament).filter_by(hltv_event_id=7801).first()
    assert row is not None
    assert row.tier == "S"
    assert "IEM Katowice" in repr(row)


def test_pro_match_defaults_to_pending(db_session, tournament):
    """A freshly queued match has ingested_at NULL and URI columns only."""
    match = ProMatch(
        hltv_match_id=TEST_MATCH_ID,
        tournament_id=tournament.id,
        team_a="Natus Vincere",
        team_b="FaZe",
        map_name="de_mirage",
    )
    db_session.add(match)
    db_session.commit()

    refreshed = db_session.get(ProMatch, TEST_MATCH_ID)
    assert refreshed.ingested_at is None
    assert refreshed.demo_gcs_uri is None
    assert refreshed.parsed_gcs_uri is None
    assert refreshed.tournament.hltv_event_id == 7801


def test_pro_round_links_to_match(db_session, tournament):
    """Docstring for test_pro_round_links_to_match."""
    match = ProMatch(hltv_match_id=TEST_MATCH_ID, tournament_id=tournament.id)
    db_session.add(match)
    db_session.commit()

    db_session.add(
        ProRound(
            pro_match_id=TEST_MATCH_ID,
            round_num=5,
            side="T",
            buy_type="full",
            round_type="execute",
            winner="T",
            archetype_label="Mirage A-Execute with 2 Smokes",
            metrics_json=json.dumps({"deaths": 1, "traded_deaths": 1}),
        )
    )
    db_session.commit()

    refreshed = db_session.get(ProMatch, TEST_MATCH_ID)
    assert len(refreshed.rounds) == 1
    assert refreshed.rounds[0].archetype_label.startswith("Mirage A-Execute")
    assert json.loads(refreshed.rounds[0].metrics_json)["traded_deaths"] == 1


def test_strat_archetype_row(db_session):
    """Docstring for test_strat_archetype_row."""
    row = ProStratArchetype(
        label="Nuke Ramp Hold vs Eco Push",
        map_name="de_nuke",
        side="CT",
        buy_type="full",
        round_type="hold",
        team_name="Vitality vs Spirit",
        patch_version="1.41.2",
        summary_text="de_nuke CT ramp hold against eco pushes.",
        metrics_json=json.dumps({"round_win_rate": 0.8}),
    )
    db_session.add(row)
    db_session.commit()

    fetched = db_session.query(ProStratArchetype).filter_by(map_name="de_nuke").first()
    assert fetched is not None
    assert fetched.qdrant_point_id is None  # not yet vectorized
    assert fetched.updated_at is not None
    assert "Nuke Ramp Hold" in repr(fetched)


def test_tournament_event_id_unique(db_session, tournament):
    """Docstring for test_tournament_event_id_unique."""
    import sqlalchemy.exc

    db_session.add(ProTournament(hltv_event_id=7801, name="Duplicate", tier="A"))
    with pytest.raises(sqlalchemy.exc.IntegrityError):
        db_session.commit()
    db_session.rollback()
