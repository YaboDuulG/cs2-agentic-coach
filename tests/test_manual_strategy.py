import os

# Force SQLite for tests
os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

import json
from unittest.mock import patch

from fastapi.testclient import TestClient
import pytest

from api.main import app
from db.database import SessionLocal, engine
from db.models import Base, KnowledgeEmbedding

client = TestClient(app)


@pytest.fixture(autouse=True, scope="module")
def setup_database():
    """Create all tables in the SQLite test database."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@patch("db.rag.get_query_embedding")
def test_create_manual_strategy(mock_get_embedding):
    """Verify that manual strategy endpoint saves record in DB with metadata and vector."""
    mock_get_embedding.return_value = [0.5] * 768

    team_id = "test-team-xyz-789"
    payload = {
        "title": "Fast B Execution",
        "map_name": "de_mirage",
        "side": "T",
        "summary": "Smoke B market door and window, flash out window.",
        "steps": [
            "Smoke market door from B apartments corridor",
            "Smoke market window from B apartments balcony",
            "Flash through window and push site together",
        ],
        "author": "Coach Gana",
    }

    # Use the test auth token
    headers = {"Authorization": "Bearer test-secret"}

    response = client.post(f"/api/teams/{team_id}/strategies", json=payload, headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Fast B Execution"
    assert data["map_name"] == "de_mirage"
    assert data["author"] == "Coach Gana"
    assert len(data["steps"]) == 3

    # Verify that the record was correctly saved in the DB
    db = SessionLocal()
    try:
        row = db.query(KnowledgeEmbedding).filter(KnowledgeEmbedding.id == data["id"]).first()
        assert row is not None
        assert row.source == "team_strategy"

        meta = json.loads(row.metadata_json)
        assert meta["team_id"] == team_id
        assert meta["title"] == "Fast B Execution"
        assert meta["author"] == "Coach Gana"
        assert meta["steps"][0] == "Smoke market door from B apartments corridor"

        # Verify embedding exists
        assert len(row.embedding) == 768
        assert row.embedding[0] == 0.5
    finally:
        if row:
            db.delete(row)
            db.commit()
        db.close()


def test_create_manual_strategy_empty_title():
    """Verify endpoint rejects requests with empty title."""
    team_id = "test-team-xyz-789"
    payload = {
        "title": "   ",
        "map_name": "de_mirage",
        "side": "T",
        "summary": "Empty title strat",
        "steps": ["Step 1"],
    }
    headers = {"Authorization": "Bearer test-secret"}

    response = client.post(f"/api/teams/{team_id}/strategies", json=payload, headers=headers)
    assert response.status_code == 400
    assert "title" in response.json()["detail"].lower()
