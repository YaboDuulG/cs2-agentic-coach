"""
Hybrid retrieval tests — BM25 ranking, RRF fusion math, and the payload
filters handed to Qdrant. All external calls (Gemini, Qdrant) are mocked.
"""

import json
import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from db.models import Base, ProStratArchetype
from services.rag_engine import retrieval
from services.rag_engine.retrieval import retrieve_pro_comps


@pytest.fixture()
def db_session():
    """Fresh in-memory DB per test."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture()
def archetype_rows(db_session):
    """Two obviously distinguishable archetype summaries."""
    nuke = ProStratArchetype(
        label="Nuke Ramp Hold vs Eco Push",
        map_name="de_nuke",
        side="CT",
        buy_type="full",
        round_type="hold",
        team_name="Vitality vs Spirit",
        patch_version="1.41.2",
        summary_text=(
            "de_nuke CT Nuke Ramp Hold vs Eco Push: full buy, hold round vs eco buy. "
            "Ramp control held against eco pushes with crossfire on ramp."
        ),
        metrics_json=json.dumps({"pro_match_id": "2371002"}),
    )
    mirage = ProStratArchetype(
        label="Mirage A-Execute with 2 Smokes",
        map_name="de_mirage",
        side="T",
        buy_type="full",
        round_type="execute",
        team_name="Natus Vincere vs FaZe",
        patch_version="1.41.2",
        summary_text=(
            "de_mirage T Mirage A-Execute with 2 Smokes: full buy, execute round vs full buy. "
            "Stairs and jungle smoked before the entry onto A site."
        ),
        metrics_json=json.dumps({"pro_match_id": "2371001"}),
    )
    db_session.add_all([nuke, mirage])
    db_session.commit()
    return nuke, mirage


def test_bm25_ranks_relevant_summary_first(db_session, archetype_rows, monkeypatch):
    """With the dense leg empty, BM25 alone puts the nuke ramp doc on top."""
    monkeypatch.setattr(retrieval, "_dense_leg", lambda *a, **k: [])

    chunks = retrieve_pro_comps(db_session, "successful nuke ramp holds vs eco push")
    assert chunks, "BM25 leg should still return results with no dense leg"
    assert "Ramp Hold" in chunks[0]["text"]
    assert chunks[0]["source"] == "hltv_pro_match"
    assert chunks[0]["pro_match_id"] == "2371002"
    assert chunks[0]["metadata"]["map_name"] == "de_nuke"


def test_bm25_respects_metadata_filters(db_session, archetype_rows, monkeypatch):
    """A map filter that excludes the best lexical match must actually exclude it."""
    monkeypatch.setattr(retrieval, "_dense_leg", lambda *a, **k: [])

    chunks = retrieve_pro_comps(
        db_session, "nuke ramp hold eco push smokes execute", map_name="de_mirage"
    )
    assert all(c["metadata"]["map_name"] == "de_mirage" for c in chunks)


def test_rrf_fusion_merges_both_legs(db_session, monkeypatch):
    """RRF (k=60): shared doc gets 1/61 + 1/62 and outranks each leg's top."""
    dense = [
        {"key": "dense-only", "leg_score": 0.95,
         "payload": {"content": "dense only doc", "pro_match_id": "m1", "map_name": "de_nuke"}},
        {"key": "shared", "leg_score": 0.90,
         "payload": {"content": "shared doc", "pro_match_id": "m2", "map_name": "de_nuke"}},
    ]
    sparse_row = ProStratArchetype(
        label="Sparse Only", map_name="de_nuke", side="CT", buy_type="full",
        round_type="hold", team_name="", summary_text="sparse only doc",
        metrics_json=json.dumps({"pro_match_id": "m3"}),
    )
    sparse = [
        {"key": "shared", "leg_score": 7.0, "row": None},
        {"key": "sparse-only", "leg_score": 3.0, "row": sparse_row},
    ]
    monkeypatch.setattr(retrieval, "_dense_leg", lambda *a, **k: dense)
    monkeypatch.setattr(retrieval, "_sparse_leg", lambda *a, **k: sparse)

    chunks = retrieve_pro_comps(db_session, "anything")
    assert [c["id"] for c in chunks] == ["shared", "dense-only", "sparse-only"]
    assert chunks[0]["score"] == pytest.approx(1 / 61 + 1 / 62, abs=1e-6)
    assert chunks[1]["score"] == pytest.approx(1 / 61, abs=1e-6)
    assert chunks[2]["score"] == pytest.approx(1 / 62, abs=1e-6)
    # The shared doc keeps its dense payload; the sparse-only doc uses its row.
    assert chunks[0]["text"] == "shared doc"
    assert chunks[2]["text"] == "sparse only doc"
    assert chunks[2]["pro_match_id"] == "m3"


def test_dense_leg_passes_strict_filters_to_qdrant(db_session, monkeypatch):
    """Every provided metadata filter must land in the Qdrant query_filter."""
    # The dense leg short-circuits in LOCAL_MODE; this test mocks the network
    # pieces itself, so run it in "production" mode.
    monkeypatch.setenv("LOCAL_MODE", "false")
    captured: dict = {}

    class FakeQdrant:
        def search(self, **kwargs):
            captured.update(kwargs)
            return []

    monkeypatch.setenv("GEMINI_API_KEY", "fake-key-for-tests")
    monkeypatch.setattr("db.rag.get_query_embedding", lambda text, key: [0.0] * 768)
    monkeypatch.setattr("db.qdrant_client.get_qdrant_client", lambda: FakeQdrant())

    retrieve_pro_comps(
        db_session,
        "nuke ramp holds",
        map_name="de_nuke",
        side="CT",
        buy_type="eco",
        round_type="hold",
        patch_version="1.41.2",
    )

    assert captured["collection_name"] == "pro_playbook"
    must = captured["query_filter"]["must"]
    conditions = {c["key"]: c["match"]["value"] for c in must}
    assert conditions == {
        "scope": "public",
        "map_name": "de_nuke",
        "side": "CT",
        "buy_type": "eco",
        "round_type": "hold",
        "patch_version": "1.41.2",
    }


def test_both_legs_failing_degrades_to_empty(db_session, monkeypatch):
    """Neither leg may raise out of retrieve_pro_comps."""

    def boom(*args, **kwargs):
        raise RuntimeError("leg down")

    monkeypatch.setattr(retrieval, "_dense_leg", boom)
    monkeypatch.setattr(retrieval, "_sparse_leg", boom)
    assert retrieve_pro_comps(db_session, "anything") == []
