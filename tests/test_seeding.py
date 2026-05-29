"""
Tests for Pro Match Seeding & Clearing Scripts.
"""

import json
import os
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Force SQLite for tests
os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from db.models import Base, KnowledgeEmbedding, Match
from scripts.clear_seeding import main as run_clear_seeding


@pytest.fixture(scope="module")
def db_session():
    """Create an in-memory SQLite DB with all tables for testing seeding."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


def test_clear_seeding_script(db_session):
    """Verify that clear_seeding script deletes target match records and RAG embeddings."""
    # Seed a pro match and embedding
    pro_match_id = "hltv-test-match-123"
    pro_match = Match(
        match_id=pro_match_id,
        match_name="Team A vs Team B (Tournament - 2026)",
        map_name="de_nuke",
        status="complete"
    )
    db_session.add(pro_match)

    pro_embedding = KnowledgeEmbedding(
        content="Match Summary for Team A vs Team B",
        embedding=[0.1] * 768,
        source="hltv_pro_match",
        metadata_json=json.dumps({"match_id": pro_match_id})
    )
    db_session.add(pro_embedding)

    # Seed a non-pro match that should NOT be deleted
    user_match_id = "user-match-456"
    user_match = Match(
        match_id=user_match_id,
        match_name="My Uploaded Match",
        map_name="de_mirage",
        status="complete",
        user_id="user_clerk_123"
    )
    db_session.add(user_match)

    user_embedding = KnowledgeEmbedding(
        content="User match summary",
        embedding=[0.2] * 768,
        source="team_strategy",
        metadata_json=json.dumps({"match_id": user_match_id})
    )
    db_session.add(user_embedding)
    db_session.commit()

    # Mock SessionLocal to return our test db_session
    with patch("scripts.clear_seeding.SessionLocal", return_value=db_session):
        run_clear_seeding()

    # Verify that the pro match and embedding were deleted
    remaining_pro_matches = db_session.query(Match).filter_by(match_id=pro_match_id).all()
    assert len(remaining_pro_matches) == 0

    remaining_pro_embs = db_session.query(KnowledgeEmbedding).filter_by(source="hltv_pro_match").all()
    assert len(remaining_pro_embs) == 0

    # Verify that the user match and team strategy embedding were preserved
    remaining_user_matches = db_session.query(Match).filter_by(match_id=user_match_id).all()
    assert len(remaining_user_matches) == 1
    assert remaining_user_matches[0].match_name == "My Uploaded Match"

    remaining_user_embs = db_session.query(KnowledgeEmbedding).filter_by(source="team_strategy").all()
    assert len(remaining_user_embs) == 1
