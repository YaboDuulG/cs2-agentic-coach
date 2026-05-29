"""
Tests for RAG Semantic Search Module.
"""

import json
import os
from unittest.mock import patch

import pytest

# Force SQLite for all tests
os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Base, KnowledgeEmbedding
from db.rag import cosine_similarity, retrieve_similar_chunks


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
def seed_embeddings(db_session):
    """Seed test embeddings with known vectors."""
    db_session.query(KnowledgeEmbedding).delete()

    # Let's seed 3 chunks:
    # 1. Exact match for a query [1.0, 0.0]
    # 2. Part match for a query [0.707, 0.707]
    # 3. Orthogonal / bad match [0.0, 1.0]
    # We'll pad these to 768 dimensions with zeros.
    def make_vector(first_two):
        v = [0.0] * 768
        v[0] = first_two[0]
        v[1] = first_two[1]
        return v

    c1 = KnowledgeEmbedding(
        content="Economy buy rules: always buy Kevlar on full buy.",
        embedding=make_vector([1.0, 0.0]),
        source="game_rules",
        metadata_json=json.dumps({"type": "economy"})
    )
    c2 = KnowledgeEmbedding(
        content="Dust II B Site strategy: smoke doors and push tunnels.",
        embedding=make_vector([0.707, 0.707]),
        source="game_rules",
        metadata_json=json.dumps({"type": "tactics"})
    )
    c3 = KnowledgeEmbedding(
        content="Pro Match: Astralis vs NaVi on de_nuke.",
        embedding=make_vector([0.0, 1.0]),
        source="hltv_pro_match",
        metadata_json=json.dumps({"match_id": "pro-123"})
    )

    db_session.add_all([c1, c2, c3])
    db_session.commit()
    yield
    db_session.query(KnowledgeEmbedding).delete()
    db_session.commit()

def test_cosine_similarity():
    """Verify raw cosine similarity math."""
    v1 = [1.0, 0.0, 0.0]
    v2 = [1.0, 0.0, 0.0]
    assert pytest.approx(cosine_similarity(v1, v2), 0.001) == 1.0

    v3 = [0.0, 1.0, 0.0]
    assert pytest.approx(cosine_similarity(v1, v3), 0.001) == 0.0

    v4 = [0.707, 0.707, 0.0]
    assert pytest.approx(cosine_similarity(v1, v4), 0.001) == 0.707

@patch("db.rag.get_query_embedding")
def test_retrieve_similar_chunks_sqlite(mock_get_embedding, db_session):
    """Test semantic retrieval sorting and source filtering in SQLite (Python-fallback)."""
    # Mock query embedding: close to c1 [1.0, 0.0]
    query_vector = [0.0] * 768
    query_vector[0] = 0.95
    query_vector[1] = 0.05
    mock_get_embedding.return_value = query_vector

    with patch.dict(os.environ, {"GEMINI_API_KEY": "fake-api-key"}):
        # 1. Retrieve without source filter (should return top 2: c1, then c2)
        results = retrieve_similar_chunks(db_session, "some query", limit=2)
        assert len(results) == 2
        assert "Economy buy rules" in results[0]["content"]
        assert results[0]["score"] > 0.9
        assert "Dust II B Site" in results[1]["content"]
        assert results[1]["score"] > 0.6

        # 2. Retrieve with source filter 'hltv_pro_match' (should only return c3)
        results_pro = retrieve_similar_chunks(db_session, "some query", limit=5, source="hltv_pro_match")
        assert len(results_pro) == 1
        assert "Pro Match: Astralis vs NaVi" in results_pro[0]["content"]
        assert results_pro[0]["metadata"]["match_id"] == "pro-123"

        # 3. Limit works
        results_limit = retrieve_similar_chunks(db_session, "some query", limit=1)
        assert len(results_limit) == 1
