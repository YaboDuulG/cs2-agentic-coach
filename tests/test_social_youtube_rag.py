"""
Tests for Social Media & YouTube Tactical Sentiment RAG.
"""

import datetime
import json
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Force SQLite for testing
import os
os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from db.models import Base, KnowledgeEmbedding
from scripts.social_sentiment_scraper import ingest_sentiment, clean_expired_chunks


@pytest.fixture(scope="module")
def db_session():
    """Create in-memory SQLite database for testing social RAG ingestion."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def clean_db(db_session):
    """Ensure database is clean before each test case."""
    db_session.query(KnowledgeEmbedding).delete()
    db_session.commit()
    yield
    db_session.query(KnowledgeEmbedding).delete()
    db_session.commit()


@patch("scripts.social_sentiment_scraper.get_embedding")
def test_ingest_sentiment_saves_embeddings(mock_get_embedding, db_session):
    """Verify that ingest_sentiment successfully calls embedding API and inserts records."""
    mock_get_embedding.return_value = [0.1] * 768
    
    ingest_sentiment(
        db=db_session,
        team_a="The MongolZ",
        team_b="Team Spirit",
        map_name="de_mirage",
        api_key="fake-gemini-key"
    )
    
    # Verify records exist in database
    reddit_records = db_session.query(KnowledgeEmbedding).filter_by(source="social_sentiment").all()
    # 1 mock reddit post + 2 mock tweets = 3 records
    assert len(reddit_records) == 3
    
    youtube_records = db_session.query(KnowledgeEmbedding).filter_by(source="youtube_breakdown").all()
    assert len(youtube_records) == 1
    
    assert "YOUTUBE STRATEGY BREAKDOWN" in youtube_records[0].content
    meta = json.loads(youtube_records[0].metadata_json)
    assert meta["team_a"] == "The MongolZ"
    assert meta["map"] == "de_mirage"
    assert "video_url" in meta


def test_clean_expired_chunks_purges_old_records(db_session):
    """Verify that chunks older than 90 days are deleted during cleanup."""
    # Active chunk (1 day ago)
    recent_date = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)).isoformat()
    recent_chunk = KnowledgeEmbedding(
        content="Recent Reddit analysis",
        embedding=[0.1] * 768,
        source="social_sentiment",
        metadata_json=json.dumps({"ingested_at": recent_date})
    )
    db_session.add(recent_chunk)
    
    # Stale chunk (95 days ago)
    old_date = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=95)).isoformat()
    old_chunk = KnowledgeEmbedding(
        content="Outdated Reddit post",
        embedding=[0.2] * 768,
        source="social_sentiment",
        metadata_json=json.dumps({"ingested_at": old_date})
    )
    db_session.add(old_chunk)
    db_session.commit()
    
    # Run cleanup
    clean_expired_chunks(db_session)
    
    # Verify only recent chunk remains
    remaining = db_session.query(KnowledgeEmbedding).all()
    assert len(remaining) == 1
    assert remaining[0].content == "Recent Reddit analysis"
