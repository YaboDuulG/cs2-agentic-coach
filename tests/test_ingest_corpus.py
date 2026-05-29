"""
Tests for Corpus Ingestion Script.
"""

import json
import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Force SQLite for all tests
os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from db.models import Base, KnowledgeEmbedding
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from scripts.ingest_corpus import parse_markdown_chunks, main

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

def test_parse_markdown_chunks(tmp_path):
    """Test chunk parsing and context paths from a mock markdown file."""
    mock_md = (
        "# Main Title\n"
        "## Section One\n"
        "Some details here.\n"
        "### Subsection One A\n"
        "Bullet 1\n"
        "Bullet 2\n"
        "## Section Two\n"
        "More details."
    )
    test_file = tmp_path / "test_rules.md"
    test_file.write_text(mock_md, encoding="utf-8")
    
    chunks = parse_markdown_chunks(test_file)
    
    # We should have 3 chunks:
    # 1. Heading 'Section One' content up to Subsection One A
    # 2. Heading 'Subsection One A' content up to Section Two
    # 3. Heading 'Section Two' content
    assert len(chunks) == 3
    
    c1 = chunks[0]
    assert c1["metadata"]["h2"] == "Section One"
    assert c1["metadata"]["h3"] == ""
    assert "Main Title > Section One" in c1["content"]
    assert "Some details here" in c1["content"]

    c2 = chunks[1]
    assert c2["metadata"]["h2"] == "Section One"
    assert c2["metadata"]["h3"] == "Subsection One A"
    assert "Main Title > Section One > Subsection One A" in c2["content"]
    assert "Bullet 1" in c2["content"]

    c3 = chunks[2]
    assert c3["metadata"]["h2"] == "Section Two"
    assert c3["metadata"]["h3"] == ""
    assert "Main Title > Section Two" in c3["content"]
    assert "More details" in c3["content"]

@patch("scripts.ingest_corpus.get_embedding")
@patch("scripts.ingest_corpus.SessionLocal")
@patch("scripts.ingest_corpus.parse_markdown_chunks")
def test_ingest_corpus_main(mock_parse, mock_session, mock_get_embedding, db_session):
    """Test that main() successfully runs the ingestion loop."""
    # Setup mocks
    mock_session.return_value = db_session
    mock_parse.return_value = [
        {
            "content": "Test hierarchy > H2 > H3\n\nSome content text",
            "metadata": {"h1": "Test hierarchy", "h2": "H2", "h3": "H3", "source_file": "test.md"}
        }
    ]
    mock_get_embedding.return_value = [0.123] * 768
    
    with patch.dict(os.environ, {"GEMINI_API_KEY": "fake-api-key"}):
        main()
        
    # Check that knowledge_embeddings has been populated
    embeddings = db_session.query(KnowledgeEmbedding).filter_by(source="game_rules").all()
    assert len(embeddings) == 1
    assert embeddings[0].content == "Test hierarchy > H2 > H3\n\nSome content text"
    assert embeddings[0].embedding == [0.123] * 768
    meta = json.loads(embeddings[0].metadata_json)
    assert meta["h2"] == "H2"
    assert meta["h3"] == "H3"
