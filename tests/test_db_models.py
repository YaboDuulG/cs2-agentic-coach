"""
DB model schema tests — uses SQLite in-memory so no PostgreSQL needed in CI.
Validates that all ORM models can be created and basic CRUD works.
"""

import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Force SQLite for all tests in this module
os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from db.models import (
    Base,
    FirstContact,
    Grenade,
    Kill,
    Match,
    MatchStatus,
    PlayerTrajectory,
    Round,
)

TEST_MATCH_ID = "test-match-00000000"


@pytest.fixture(scope="module")
def db_session():
    """Create an in-memory SQLite DB with all tables for the test module."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def seed_match(db_session):
    """Insert a base Match record before each test and clean up after."""
    match = Match(match_id=TEST_MATCH_ID, map_name="de_mirage", tickrate=64, total_rounds=24)
    db_session.add(match)
    db_session.commit()
    yield
    db_session.query(PlayerTrajectory).filter_by(match_id=TEST_MATCH_ID).delete()
    db_session.query(FirstContact).filter_by(match_id=TEST_MATCH_ID).delete()
    db_session.query(Grenade).filter_by(match_id=TEST_MATCH_ID).delete()
    db_session.query(Round).filter_by(match_id=TEST_MATCH_ID).delete()
    db_session.query(Kill).filter_by(match_id=TEST_MATCH_ID).delete()
    db_session.query(Match).filter_by(match_id=TEST_MATCH_ID).delete()
    db_session.commit()


class TestMatchModel:
    def test_match_created(self, db_session):
        match = db_session.get(Match, TEST_MATCH_ID)
        assert match is not None
        assert match.map_name == "de_mirage"
        assert match.tickrate == 64
        assert match.total_rounds == 24
        assert match.status == MatchStatus.PENDING

    def test_match_status_update(self, db_session):
        match = db_session.get(Match, TEST_MATCH_ID)
        match.status = MatchStatus.COMPLETE
        db_session.commit()
        refreshed = db_session.get(Match, TEST_MATCH_ID)
        assert refreshed.status == MatchStatus.COMPLETE

    def test_match_repr(self, db_session):
        match = db_session.get(Match, TEST_MATCH_ID)
        assert TEST_MATCH_ID in repr(match)


class TestKillModel:
    def test_kill_insert(self, db_session):
        kill = Kill(
            match_id=TEST_MATCH_ID,
            round_num=1,
            tick=1024,
            attacker="player_a",
            attacker_team="CT",
            victim="player_b",
            victim_team="T",
            weapon="ak47",
            headshot=True,
            attacker_x=100.0,
            attacker_y=200.0,
            attacker_z=0.0,
            victim_x=150.0,
            victim_y=250.0,
            victim_z=0.0,
        )
        db_session.add(kill)
        db_session.commit()

        results = db_session.query(Kill).filter_by(match_id=TEST_MATCH_ID).all()
        assert len(results) == 1
        assert results[0].weapon == "ak47"
        assert results[0].headshot is True


class TestGrenadeModel:
    def test_grenade_insert(self, db_session):
        grenade = Grenade(
            match_id=TEST_MATCH_ID,
            round_num=2,
            tick=2048,
            thrower="player_c",
            team="T",
            grenade_type="smokeGrenade",
            throw_x=300.0,
            throw_y=400.0,
        )
        db_session.add(grenade)
        db_session.commit()

        results = db_session.query(Grenade).filter_by(match_id=TEST_MATCH_ID).all()
        assert len(results) == 1
        assert results[0].grenade_type == "smokeGrenade"


class TestRoundModel:
    def test_round_insert(self, db_session):
        round_ = Round(
            match_id=TEST_MATCH_ID,
            round_num=1,
            winner_side="CT",
            reason="ct_win",
            ct_eq_val=4750,
            t_eq_val=1000,
            ct_score=1,
            t_score=0,
        )
        db_session.add(round_)
        db_session.commit()

        results = db_session.query(Round).filter_by(match_id=TEST_MATCH_ID).all()
        assert len(results) == 1
        assert results[0].winner_side == "CT"
        assert results[0].ct_eq_val == 4750


class TestFirstContactModel:
    def test_first_contact_insert(self, db_session):
        fc = FirstContact(
            match_id=TEST_MATCH_ID,
            round_num=1,
            tick=512,
            attacker="player_a",
            attacker_team="CT",
            victim="player_b",
            weapon="m4a1",
            headshot=False,
            attacker_x=100.0,
            attacker_y=200.0,
            victim_x=150.0,
            victim_y=250.0,
        )
        db_session.add(fc)
        db_session.commit()

        results = db_session.query(FirstContact).filter_by(match_id=TEST_MATCH_ID).all()
        assert len(results) == 1
        assert results[0].weapon == "m4a1"


class TestTrajectoryModel:
    def test_trajectory_insert(self, db_session):
        import json

        traj = PlayerTrajectory(
            match_id=TEST_MATCH_ID,
            round_num=1,
            player="player_a",
            team="CT",
            positions_json=json.dumps([
                {"tick": 100, "x": 100.0, "y": 200.0, "z": 0.0},
                {"tick": 108, "x": 110.0, "y": 210.0, "z": 0.0},
            ]),
        )
        db_session.add(traj)
        db_session.commit()

        results = db_session.query(PlayerTrajectory).filter_by(match_id=TEST_MATCH_ID).all()
        assert len(results) == 1
        positions = json.loads(results[0].positions_json)
        assert len(positions) == 2
        assert positions[0]["x"] == 100.0
