"""
Tests for RAG Knowledge Base Ingestion Script.
"""

import json
import os
from unittest.mock import patch

import pytest

# Force SQLite for all tests
os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Base, FirstContact, Kill, KnowledgeEmbedding, Match, Round
from scripts.update_knowledge_base import ingest_match

TEST_MATCH_ID = "test-rag-match-id-123"

@pytest.fixture(scope="module")
def db_session():
    """Create in-memory SQLite database for testing RAG ingestion."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(engine)

@pytest.fixture(autouse=True)
def seed_match_data(db_session):
    """Seed a basic match with rounds, kills, and first contacts."""
    # Seed Match
    match = Match(
        match_id=TEST_MATCH_ID,
        map_name="de_dust2",
        tickrate=64,
        total_rounds=2,
        status="complete",
        coaching_notes=json.dumps({"summary": "Great match with solid defense."})
    )
    db_session.add(match)

    # Seed Rounds
    r1 = Round(match_id=TEST_MATCH_ID, round_num=1, winner_side="CT", ct_eq_val=5000, t_eq_val=2000)
    r2 = Round(match_id=TEST_MATCH_ID, round_num=2, winner_side="T", ct_eq_val=2500, t_eq_val=6000)
    db_session.add_all([r1, r2])

    # Seed Kills
    k1 = Kill(match_id=TEST_MATCH_ID, round_num=1, tick=100, attacker="player_a", attacker_team="CT", victim="player_b", victim_team="T", weapon="m4a1", attacker_x=1.0, victim_x=2.0)
    k2 = Kill(match_id=TEST_MATCH_ID, round_num=2, tick=200, attacker="player_c", attacker_team="T", victim="player_d", victim_team="CT", weapon="ak47", attacker_x=3.0, victim_x=4.0)
    db_session.add_all([k1, k2])

    # Seed First Contact
    fc1 = FirstContact(match_id=TEST_MATCH_ID, round_num=1, tick=100, attacker="player_a", attacker_team="CT", victim="player_b", weapon="m4a1")
    fc2 = FirstContact(match_id=TEST_MATCH_ID, round_num=2, tick=200, attacker="player_c", attacker_team="T", victim="player_d", weapon="ak47")
    db_session.add_all([fc1, fc2])

    db_session.commit()
    yield
    db_session.query(KnowledgeEmbedding).delete()
    db_session.query(FirstContact).filter_by(match_id=TEST_MATCH_ID).delete()
    db_session.query(Kill).filter_by(match_id=TEST_MATCH_ID).delete()
    db_session.query(Round).filter_by(match_id=TEST_MATCH_ID).delete()
    db_session.query(Match).filter_by(match_id=TEST_MATCH_ID).delete()
    db_session.commit()

@patch("scripts.update_knowledge_base.get_embedding")
def test_ingest_match(mock_get_embedding, db_session):
    """Test that ingest_match correctly chunks data and stores embeddings."""
    # Mock get_embedding to return a fake embedding vector of size 768
    mock_get_embedding.return_value = [0.42] * 768

    # Run ingestion
    ingest_match(db_session, TEST_MATCH_ID, api_key="fake-gemini-key")

    # Verify embeddings were inserted
    embeddings = db_session.query(KnowledgeEmbedding).all()
    # 1 match summary chunk + 2 round chunks = 3 chunks total
    assert len(embeddings) == 3

    # Verify summary chunk content and metadata
    summary_chunk = [e for e in embeddings if json.loads(e.metadata_json).get("type") == "summary"][0]
    assert "de_dust2" in summary_chunk.content
    assert "Great match with solid defense" in summary_chunk.content
    meta = json.loads(summary_chunk.metadata_json)
    assert meta["match_id"] == TEST_MATCH_ID
    assert meta["map_name"] == "de_dust2"

    # Verify round chunks content
    round_chunks = [e for e in embeddings if json.loads(e.metadata_json).get("type") == "round_details"]
    assert len(round_chunks) == 2

    r1_chunk = [rc for rc in round_chunks if json.loads(rc.metadata_json).get("round_num") == 1][0]
    assert "Round 1" in r1_chunk.content
    assert "Round winner: Team CT" in r1_chunk.content
    assert "player_a (CT) opened with a kill" in r1_chunk.content
