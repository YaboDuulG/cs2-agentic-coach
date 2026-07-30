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
        """Docstring for make_vector."""
        v = [0.0] * 768
        v[0] = first_two[0]
        v[1] = first_two[1]
        return v

    c1 = KnowledgeEmbedding(
        content="Economy buy rules: always buy Kevlar on full buy.",
        embedding=make_vector([1.0, 0.0]),
        source="game_rules",
        metadata_json=json.dumps({"type": "economy"}),
    )
    c2 = KnowledgeEmbedding(
        content="Dust II B Site strategy: smoke doors and push tunnels.",
        embedding=make_vector([0.707, 0.707]),
        source="game_rules",
        metadata_json=json.dumps({"type": "tactics"}),
    )
    c3 = KnowledgeEmbedding(
        content="Pro Match: Astralis vs NaVi on de_nuke.",
        embedding=make_vector([0.0, 1.0]),
        source="hltv_pro_match",
        metadata_json=json.dumps({"match_id": "pro-123"}),
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


# retrieve_similar_chunks queries Qdrant, not the SQL session — qdrant_client
# returns [{"score": ..., **payload}] and rag.py reshapes that into
# {content, source, score, metadata}. These tests mock at that boundary.
QDRANT_HITS = [
    {
        "score": 0.95,
        "content": "Economy buy rules: always buy Kevlar on full buy.",
        "source": "game_rules",
        "type": "economy",
    },
    {
        "score": 0.71,
        "content": "Dust II B Site strategy: smoke doors and push tunnels.",
        "source": "game_rules",
        "type": "tactics",
    },
    {
        "score": 0.30,
        "content": "Pro Match: Astralis vs NaVi on de_nuke.",
        "source": "hltv_pro_match",
        "match_id": "pro-123",
    },
]


@patch("db.qdrant_client.search_pro_tactics")
@patch("db.rag.get_query_embedding")
def test_retrieve_similar_chunks_ranking_and_source_filter(
    mock_get_embedding, mock_search_pro, db_session
):
    """Results are ranked by score, truncated to limit, and filterable by source."""
    mock_get_embedding.return_value = [0.1] * 768
    mock_search_pro.return_value = QDRANT_HITS

    with patch.dict(os.environ, {"GEMINI_API_KEY": "fake-api-key"}):
        # 1. Highest scores first, truncated to limit
        results = retrieve_similar_chunks(db_session, "some query", limit=2)
        assert len(results) == 2
        assert "Economy buy rules" in results[0]["content"]
        assert results[0]["score"] > 0.9
        assert "Dust II B Site" in results[1]["content"]
        assert results[1]["score"] > 0.6

        # 2. Source filter narrows to the matching hit, and metadata survives
        results_pro = retrieve_similar_chunks(
            db_session, "some query", limit=5, source="hltv_pro_match"
        )
        assert len(results_pro) == 1
        assert "Pro Match: Astralis vs NaVi" in results_pro[0]["content"]
        assert results_pro[0]["metadata"]["match_id"] == "pro-123"

        # 3. Limit works
        results_limit = retrieve_similar_chunks(db_session, "some query", limit=1)
        assert len(results_limit) == 1


@patch("db.rag.get_query_embedding")
def test_retrieve_similar_chunks_no_api_key_returns_empty(mock_get_embedding, db_session):
    """Without an embedding API key, retrieval short-circuits instead of raising."""
    mock_get_embedding.return_value = [0.1] * 768

    with patch.dict(os.environ, {"GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}):
        assert retrieve_similar_chunks(db_session, "some query", limit=5) == []


PUBLIC_HIT = {
    "score": 0.9,
    "content": "Public pro match advice: NaVi plays default A.",
    "source": "hltv_pro_match",
    "scope": "public",
}
TEAM_HIT = {
    "score": 0.8,
    "content": "Team specific tactics: Mirage A split execute.",
    "source": "user_match_summary",
    "scope": "team",
    "team_id": "team-abc",
}
USER_HIT = {
    "score": 0.8,
    "content": "Individual training details: AWP entry positioning.",
    "source": "user_match_summary",
    "scope": "individual",
    "user_id": "user-xyz",
}


@patch("db.qdrant_client.search_player_tendencies")
@patch("db.qdrant_client.search_pro_tactics")
@patch("db.rag.get_query_embedding")
def test_retrieve_similar_chunks_isolation(
    mock_get_embedding, mock_search_pro, mock_search_tendencies, db_session
):
    """Namespace walls: tendencies are only searched for the scope that was asked for."""
    mock_get_embedding.return_value = [0.1] * 768
    mock_search_pro.return_value = [PUBLIC_HIT]

    with patch.dict(os.environ, {"GEMINI_API_KEY": "fake-api-key"}):
        # 1. No context: public tactics only, tendencies never queried.
        mock_search_tendencies.return_value = []
        res_none = retrieve_similar_chunks(db_session, "tactics", limit=5)
        assert len(res_none) == 1
        assert "Public pro match" in res_none[0]["content"]
        mock_search_tendencies.assert_not_called()

        # 2. Team context: tendencies queried scoped to that team, not a user.
        mock_search_tendencies.reset_mock()
        mock_search_tendencies.return_value = [TEAM_HIT]
        res_team = retrieve_similar_chunks(db_session, "tactics", limit=5, team_id="team-abc")
        contents = [c["content"] for c in res_team]
        assert any("Public pro match" in text for text in contents)
        assert any("Team specific tactics" in text for text in contents)
        assert not any("Individual training details" in text for text in contents)
        assert mock_search_tendencies.call_args.kwargs["team_id"] == "team-abc"
        assert "user_id" not in mock_search_tendencies.call_args.kwargs

        # 3. User context: tendencies queried scoped to that user, not a team.
        mock_search_tendencies.reset_mock()
        mock_search_tendencies.return_value = [USER_HIT]
        res_user = retrieve_similar_chunks(db_session, "tactics", limit=5, user_id="user-xyz")
        contents = [c["content"] for c in res_user]
        assert any("Public pro match" in text for text in contents)
        assert any("Individual training details" in text for text in contents)
        assert not any("Team specific tactics" in text for text in contents)
        assert mock_search_tendencies.call_args.kwargs["user_id"] == "user-xyz"
        assert "team_id" not in mock_search_tendencies.call_args.kwargs
