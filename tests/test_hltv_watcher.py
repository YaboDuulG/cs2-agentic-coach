"""
Tests for HLTV Watcher, Jobs Queue, and Meta Snapshot scripts.
"""

import json
import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Force SQLite for all tests
os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from db.models import Base, Match, MatchStatus, Round, Kill
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from services.hltv_watcher.main import main as watcher_main
from scripts.queue_demo_jobs import main as queue_main
from scripts.generate_meta_snapshot import main as snapshot_main, generate_report

@pytest.fixture(scope="module")
def db_session():
    """Create in-memory SQLite database for testing."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(engine)

@pytest.fixture(autouse=True)
def clean_db(db_session):
    """Clean the tables before and after each test."""
    db_session.query(Round).delete()
    db_session.query(Kill).delete()
    db_session.query(Match).delete()
    db_session.commit()
    yield
    db_session.query(Round).delete()
    db_session.query(Kill).delete()
    db_session.query(Match).delete()
    db_session.commit()

@patch("services.hltv_watcher.main.SessionLocal")
def test_hltv_watcher_mock_mode(mock_session, db_session):
    """Verify HLTV watcher runs and registers mock matches when no API keys are present."""
    mock_session.return_value = db_session
    
    # Run main under mock mode
    with patch.dict(os.environ, {}, clear=True):
        watcher_main(["--mode", "scheduled"])
        
    # Check match was created
    matches = db_session.query(Match).all()
    assert len(matches) == 1
    assert matches[0].match_id == "hltv-mock-match-999"
    assert matches[0].status == MatchStatus.PENDING
    assert matches[0].map_name == "de_dust2"
    assert "de_dust2_test.dem" in matches[0].gcs_demo_uri

@patch("scripts.queue_demo_jobs.SessionLocal")
@patch("scripts.queue_demo_jobs.enqueue_scout_job")
def test_queue_demo_jobs(mock_enqueue, mock_session, db_session):
    """Verify queue_demo_jobs finds pending matches, enqueues them, and transitions their status."""
    mock_session.return_value = db_session
    
    # Seed pending match
    m = Match(
        match_id="pending-test-match-1",
        map_name="de_mirage",
        status=MatchStatus.PENDING,
        gcs_demo_uri="gs://bucket/test.dem"
    )
    db_session.add(m)
    db_session.commit()
    
    # Run queue script
    queue_main()
    
    # Verify enqueue_scout_job called
    mock_enqueue.assert_called_once_with("pending-test-match-1", "gs://bucket/test.dem")
    
    # Verify status changed to PARSING
    db_session.expire_all()
    m_updated = db_session.query(Match).filter_by(match_id="pending-test-match-1").first()
    assert m_updated.status == MatchStatus.PARSING

@patch("scripts.generate_meta_snapshot.SessionLocal")
def test_generate_meta_snapshot(mock_session, db_session, tmp_path):
    """Verify generate_meta_snapshot executes successfully and generates correct stats."""
    mock_session.return_value = db_session
    
    # Seed match, round, and kill
    m = Match(match_id="snap-match-1", map_name="de_dust2", status=MatchStatus.COMPLETE)
    r = Round(match_id="snap-match-1", round_num=1, winner_side="CT")
    k = Kill(match_id="snap-match-1", round_num=1, tick=100, attacker="P1", victim="P2", weapon="weapon_ak47")
    db_session.add_all([m, r, k])
    db_session.commit()
    
    # Verify generate_report output
    report = generate_report(db_session)
    assert "Total Pro Matches Processed:** 1" in report
    assert "AK47" in report
    assert "de_dust2" in report
    
    # Run main script and ensure file gets written
    out_dir = tmp_path / "data" / "processed"
    out_dir.mkdir(parents=True, exist_ok=True)
    
    with patch("scripts.generate_meta_snapshot.REPO_ROOT", tmp_path):
        snapshot_main()
        
    local_path = out_dir / "meta_snapshot.md"
    assert local_path.exists()
    file_content = local_path.read_text(encoding="utf-8")
    assert "Total Pro Matches Processed" in file_content
