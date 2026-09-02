"""
Parse handler tests — the parser HTTP call is mocked; what's under test is
persistence: batch inserts, first-contact derivation, trajectory grouping,
status transition, and the follow-on coach job.
"""

import os
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from db.models import (
    Base,
    FirstContact,
    Grenade,
    Job,
    JobKind,
    Kill,
    Match,
    MatchStatus,
    PlayerTrajectory,
    Round,
)
from services.worker.parse_handler import handle_parse_job

TEST_MATCH_ID = "parse-test-match-000"

FAKE_PARSE_RESULT = {
    "match_id": TEST_MATCH_ID,
    "map_name": "de_mirage",
    "tickrate": 64,
    "rounds": [
        {"round_num": 1, "winner_side": "T", "t_money": 4000, "ct_money": 3800, "round_type": "pistol"},
        {"round_num": 2, "winner_side": "CT", "t_money": 10500, "ct_money": 21000, "round_type": "eco"},
    ],
    "kills": [
        # Round 1: the tick-200 kill is NOT first contact; tick-100 is.
        {"round": 1, "tick": 200, "attacker_steam_id": "111", "victim_steam_id": "222",
         "weapon": "ak47", "is_headshot": True, "attacker_x": 1.0, "attacker_y": 2.0,
         "victim_x": 3.0, "victim_y": 4.0},
        {"round": 1, "tick": 100, "attacker_steam_id": "333", "victim_steam_id": "444",
         "weapon": "glock", "is_headshot": False, "attacker_x": 0.0, "attacker_y": 0.0,
         "victim_x": 0.0, "victim_y": 0.0},
        {"round": 2, "tick": 900, "attacker_steam_id": "111", "victim_steam_id": "555",
         "weapon": "awp", "is_headshot": False, "attacker_x": 0.0, "attacker_y": 0.0,
         "victim_x": 0.0, "victim_y": 0.0},
    ],
    "grenades": [
        {"round": 1, "tick": 150, "thrower_steam_id": "111", "grenade_type": "Smoke Grenade",
         "land_x": 10.0, "land_y": 20.0},
    ],
    "positions": [
        {"round": 1, "tick": 100, "steam_id": "111", "x": 1.0, "y": 2.0, "z": 3.0, "is_alive": True},
        {"round": 1, "tick": 228, "steam_id": "111", "x": 5.0, "y": 6.0, "z": 7.0, "is_alive": True},
        {"round": 1, "tick": 100, "steam_id": "222", "x": 9.0, "y": 9.0, "z": 9.0, "is_alive": True},
    ],
    "damages": [
        {"round": 1, "tick": 190, "attacker_steam_id": "111", "victim_steam_id": "222",
         "weapon": "ak47", "hp_damage": 27, "armor_damage": 8, "hitgroup": "head",
         "is_utility": False},
        {"round": 1, "tick": 160, "attacker_steam_id": "111", "victim_steam_id": "444",
         "weapon": "HE Grenade", "hp_damage": 42, "armor_damage": 12, "hitgroup": "generic",
         "is_utility": True},
    ],
    "flashes": [
        {"round": 1, "tick": 150, "thrower_steam_id": "111", "blinded_steam_id": "222",
         "blind_duration": 2.4, "is_teammate": False},
        {"round": 1, "tick": 150, "thrower_steam_id": "111", "blinded_steam_id": "333",
         "blind_duration": 1.1, "is_teammate": True},
    ],
    # GameStateGate strip report (warmup kills, one tech pause, knife restart)
    "phase_summary": {
        "warmup_events_stripped": 12,
        "paused_events_stripped": 1,
        "postgame_events_stripped": 3,
        "pregame_events_stripped": 0,
        "restarts_discarded": 1,
        "pauses": [{"start_tick": 10000, "end_tick": 21520, "kind": "pause"}],
    },
}


@pytest.fixture()
def db_session():
    """Docstring for db_session."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    session.add(
        Match(
            match_id=TEST_MATCH_ID,
            map_name="unknown",
            tickrate=64,
            total_rounds=0,
            status=MatchStatus.PENDING,
            gcs_demo_uri="gs://test-bucket/demos/raw/x/demo.dem.gz",
        )
    )
    session.commit()
    yield session
    session.close()


@pytest.fixture()
def parsed(db_session):
    """Run the handler once with the parser call mocked."""
    with patch("services.worker.parse_handler._call_parser", return_value=FAKE_PARSE_RESULT):
        handle_parse_job(db_session, TEST_MATCH_ID)
    return db_session


def test_match_completed_and_metadata_set(parsed):
    """Docstring for test_match_completed_and_metadata_set."""
    match = parsed.query(Match).one()
    assert match.status == MatchStatus.COMPLETE
    assert match.map_name == "de_mirage"
    assert match.total_rounds == 2
    assert match.parse_duration_seconds is not None


def test_events_persisted(parsed):
    """Docstring for test_events_persisted."""
    assert parsed.query(Kill).count() == 3
    assert parsed.query(Round).count() == 2
    assert parsed.query(Grenade).count() == 1

    kill = parsed.query(Kill).filter_by(tick=200).one()
    assert kill.attacker_steamid == "111"
    assert kill.headshot is True

    rnd = parsed.query(Round).filter_by(round_num=2).one()
    assert rnd.ct_eq_val == 21000
    assert rnd.winner_side == "CT"


def test_first_contact_is_earliest_kill_per_round(parsed):
    """Docstring for test_first_contact_is_earliest_kill_per_round."""
    fcs = parsed.query(FirstContact).order_by(FirstContact.round_num).all()
    assert len(fcs) == 2
    assert fcs[0].round_num == 1
    assert fcs[0].tick == 100
    assert fcs[0].attacker_steamid == "333"
    assert fcs[1].round_num == 2


def test_trajectories_grouped_by_round_and_player(parsed):
    """Docstring for test_trajectories_grouped_by_round_and_player."""
    trajs = parsed.query(PlayerTrajectory).all()
    assert len(trajs) == 2  # players 111 and 222 in round 1
    p111 = next(t for t in trajs if t.player == "111")
    assert '"tick": 100' in p111.positions_json
    assert '"tick": 228' in p111.positions_json


def test_coach_job_enqueued(parsed):
    """Docstring for test_coach_job_enqueued."""
    jobs = parsed.query(Job).filter_by(kind=JobKind.COACH).all()
    assert len(jobs) == 1
    assert jobs[0].match_id == TEST_MATCH_ID


def test_retry_replaces_partial_rows(db_session):
    """Running the handler twice doesn't duplicate event rows."""
    with patch("services.worker.parse_handler._call_parser", return_value=FAKE_PARSE_RESULT):
        handle_parse_job(db_session, TEST_MATCH_ID)
        handle_parse_job(db_session, TEST_MATCH_ID)
    assert db_session.query(Kill).count() == 3
    assert db_session.query(Round).count() == 2


def test_missing_gcs_uri_raises(db_session):
    """Docstring for test_missing_gcs_uri_raises."""
    match = db_session.query(Match).one()
    match.gcs_demo_uri = None
    db_session.commit()
    with pytest.raises(RuntimeError, match="gcs_demo_uri"):
        handle_parse_job(db_session, TEST_MATCH_ID)


def test_phase_summary_persisted(parsed):
    """The gate's strip report lands on the match row for observability."""
    import json

    match = parsed.query(Match).one()
    assert match.phase_summary_json is not None
    summary = json.loads(match.phase_summary_json)
    assert summary["warmup_events_stripped"] == 12
    assert summary["restarts_discarded"] == 1
    assert summary["pauses"][0]["end_tick"] == 21520


def test_all_warmup_demo_fails_loudly(db_session):
    """A demo with zero live rounds after gating must fail, not produce an
    empty-but-plausible report."""
    empty_result = {
        "match_id": TEST_MATCH_ID,
        "map_name": "de_mirage",
        "tickrate": 64,
        "rounds": [],
        "kills": [],
        "grenades": [],
        "positions": [],
        "phase_summary": {"warmup_events_stripped": 55, "restarts_discarded": 0, "pauses": []},
    }
    with patch("services.worker.parse_handler._call_parser", return_value=empty_result):
        with pytest.raises(RuntimeError, match="no live rounds"):
            handle_parse_job(db_session, TEST_MATCH_ID)
    assert db_session.query(Match).one().status != MatchStatus.COMPLETE


def test_damage_and_flash_events_persisted(parsed):
    """Telemetry v2 rows land with utility and team-flash flags intact."""
    from db.models import Damage, FlashEventRow

    damages = parsed.query(Damage).order_by(Damage.tick).all()
    assert len(damages) == 2
    assert damages[0].is_utility is True and damages[0].hp_damage == 42
    assert damages[1].hitgroup == "head"

    flashes = parsed.query(FlashEventRow).all()
    assert len(flashes) == 2
    assert any(f.is_teammate for f in flashes)
    assert max(f.blind_duration for f in flashes) == 2.4


def test_round_features_written(db_session):
    """features_v2 rows land per (round, side) with plausible aggregates."""
    from db.models import RoundFeature
    from services.tactician.zones import seed_default_zones

    seed_default_zones(db_session)  # the worker runner does this at startup
    with patch("services.worker.parse_handler._call_parser", return_value=FAKE_PARSE_RESULT):
        handle_parse_job(db_session, TEST_MATCH_ID)

    rows = db_session.query(RoundFeature).all()
    assert {(r.round_num, r.side_focus) for r in rows} == {
        (1, "T"), (1, "CT"), (2, "T"), (2, "CT"),
    }
    round1 = [r for r in rows if r.round_num == 1]
    # Sides are derived from the kill graph, so assert per-round sums and the
    # won/lost split rather than which steamid landed on which side.
    assert sum(r.util_damage for r in round1) == 42  # the HE damage event
    assert sum(r.enemy_blind_seconds for r in round1) == pytest.approx(2.4)
    assert sum(r.team_blind_seconds for r in round1) == pytest.approx(1.1)
    assert sorted(r.opening_duel_won for r in round1) == [False, True]
    # Round 1's first-contact victim died at (0, 0) → inside Mirage_Mid.
    assert all(r.opening_zone == "Mirage_Mid" for r in round1)

    # Re-running the handler replaces, not duplicates (delete-then-insert).
    with patch("services.worker.parse_handler._call_parser", return_value=FAKE_PARSE_RESULT):
        handle_parse_job(db_session, TEST_MATCH_ID)
    assert db_session.query(RoundFeature).count() == 4
