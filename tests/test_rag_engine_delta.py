"""
Delta monitor + HLTV client tests — dedupe idempotency, tier filtering,
backoff behavior on 429 with Retry-After. All HTTP is mocked; the fixture
client covers the LOCAL_MODE path.
"""

import json
import os

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from db.models import Base, ProMatch, ProStratArchetype, ProTournament
from services.rag_engine.delta_monitor import run_delta
from services.rag_engine.hltv_client import (
    FixtureClient,
    HLTVClient,
    RetryableHTTPError,
    get_client,
)
from services.rag_engine.worker import run_ingestion_cycle


@pytest.fixture()
def db_session():
    """Fresh in-memory DB per test."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_run_delta_queues_new_matches(db_session):
    """Docstring for test_run_delta_queues_new_matches."""
    queued = run_delta(db_session, client=FixtureClient())
    assert queued == ["2371001", "2371002", "2371003"]
    assert db_session.query(ProMatch).count() == 3
    assert db_session.query(ProTournament).count() == 2  # two distinct events

    match = db_session.get(ProMatch, "2371001")
    assert match.ingested_at is None  # pending
    assert match.demo_gcs_uri is None  # no bytes, no premature URI
    assert match.tournament.tier == "S"


def test_run_delta_is_idempotent(db_session):
    """Second run over the same results queues nothing."""
    first = run_delta(db_session, client=FixtureClient())
    assert len(first) == 3
    second = run_delta(db_session, client=FixtureClient())
    assert second == []
    assert db_session.query(ProMatch).count() == 3
    assert db_session.query(ProTournament).count() == 2


def test_fixture_client_filters_to_s_and_a_tier():
    """Docstring for test_fixture_client_filters_to_s_and_a_tier."""
    client = FixtureClient(
        results=[
            {"hltv_match_id": "1", "event": {"hltv_event_id": 1, "tier": "S", "name": "s"}},
            {"hltv_match_id": "2", "event": {"hltv_event_id": 2, "tier": "B", "name": "b"}},
            {"hltv_match_id": "3", "event": {"hltv_event_id": 3, "tier": "A", "name": "a"}},
        ]
    )
    assert [r["hltv_match_id"] for r in client.recent_results()] == ["1", "3"]


def test_get_client_falls_back_to_fixtures(monkeypatch):
    """LOCAL_MODE or a missing base URL must never build a live client."""
    monkeypatch.setenv("LOCAL_MODE", "true")
    monkeypatch.setenv("HLTV_API_BASE", "https://hltv.test/api")
    assert isinstance(get_client(), FixtureClient)

    monkeypatch.setenv("LOCAL_MODE", "false")
    monkeypatch.delenv("HLTV_API_BASE")
    assert isinstance(get_client(), FixtureClient)

    monkeypatch.setenv("HLTV_API_BASE", "https://hltv.test/api")
    assert isinstance(get_client(), HLTVClient)


def _response(status: int, url: str, headers: dict | None = None, payload=None) -> httpx.Response:
    """Docstring for _response."""
    return httpx.Response(
        status,
        headers=headers or {},
        json=payload,
        request=httpx.Request("GET", url),
    )


def test_client_retries_on_429_honoring_retry_after(monkeypatch):
    """A 429 with Retry-After is retried, then the 200 result is returned."""
    url = "https://hltv.test/api/results"
    payload = [
        {
            "hltv_match_id": "9001",
            "event": {"hltv_event_id": 42, "name": "Blast", "tier": "S"},
            "team_a": "G2",
            "team_b": "Falcons",
            "map_name": "de_anubis",
        },
        {
            "hltv_match_id": "9002",
            "event": {"hltv_event_id": 43, "name": "Open Qual", "tier": "C"},
        },
    ]
    responses = [
        _response(429, url, headers={"Retry-After": "0"}),
        _response(200, url, payload=payload),
    ]
    calls: list[str] = []

    def fake_get(request_url, **kwargs):
        calls.append(request_url)
        return responses[len(calls) - 1]

    monkeypatch.setattr(httpx, "get", fake_get)

    results = HLTVClient(base_url="https://hltv.test/api").recent_results(limit=5)
    assert len(calls) == 2  # one 429, one success
    # C-tier result filtered out on the way through.
    assert [r["hltv_match_id"] for r in results] == ["9001"]


def test_client_gives_up_after_max_attempts(monkeypatch):
    """Persistent 5xx exhausts the retry budget and reraises."""
    url = "https://hltv.test/api/results"
    calls: list[str] = []

    def fake_get(request_url, **kwargs):
        calls.append(request_url)
        return _response(503, url, headers={"Retry-After": "0"})

    monkeypatch.setattr(httpx, "get", fake_get)

    with pytest.raises(RetryableHTTPError):
        HLTVClient(base_url="https://hltv.test/api").recent_results()
    assert len(calls) == 5


def test_ingestion_cycle_local_mode(db_session, tmp_path, monkeypatch):
    """
    Full LOCAL_MODE cycle: delta queues fixtures, the one match with parsed
    telemetry gets extracted + persisted (embedding skipped), and is not
    re-ingested on the next cycle.
    """
    monkeypatch.setenv("LOCAL_MODE", "true")

    from tests.test_rag_engine_extractor import make_parse_result

    telemetry_path = tmp_path / "parsed_2371001.json"
    telemetry_path.write_text(json.dumps(make_parse_result()), encoding="utf-8")

    summary = run_ingestion_cycle(db_session, client=FixtureClient())
    assert summary["queued"] == ["2371001", "2371002", "2371003"]
    assert summary["ingested"] == []  # nothing has parsed telemetry yet

    match = db_session.get(ProMatch, "2371001")
    match.parsed_gcs_uri = str(telemetry_path)
    db_session.commit()

    summary = run_ingestion_cycle(db_session, client=FixtureClient())
    assert summary["queued"] == []
    assert summary["ingested"] == ["2371001"]
    assert db_session.get(ProMatch, "2371001").ingested_at is not None

    archetypes = db_session.query(ProStratArchetype).all()
    assert {a.label for a in archetypes} == {
        "Mirage A-Execute with 2 Smokes",
        "Mirage A Hold vs Full Push",
        "Mirage Default into Mid",
        "Mirage Mid Hold vs Eco Push",
    }
    # LOCAL_MODE: rows persisted without touching Qdrant.
    assert all(a.qdrant_point_id is None for a in archetypes)

    # Third cycle: nothing left to do.
    summary = run_ingestion_cycle(db_session, client=FixtureClient())
    assert summary["ingested"] == []


def test_ingestion_cycle_parses_pending_demos(db_session, tmp_path, monkeypatch):
    """A queued match with a demo but no telemetry is parsed via the Go parser
    (mocked), telemetry stored, and ingested in the SAME cycle."""
    from unittest.mock import patch

    monkeypatch.setenv("LOCAL_MODE", "true")
    monkeypatch.setenv("PRO_PARSED_DIR", str(tmp_path))

    from tests.test_rag_engine_extractor import make_parse_result

    run_ingestion_cycle(db_session, client=FixtureClient())  # queue fixtures
    match = db_session.get(ProMatch, "2371002")
    match.demo_gcs_uri = "gs://demos/pro/2371002.dem"
    db_session.commit()

    with patch(
        "services.worker.parse_handler._call_parser", return_value=make_parse_result()
    ) as mock_parser:
        summary = run_ingestion_cycle(db_session, client=FixtureClient())

    mock_parser.assert_called_once_with("2371002", "gs://demos/pro/2371002.dem")
    assert summary["parsed"] == ["2371002"]
    assert summary["ingested"] == ["2371002"]
    refreshed = db_session.get(ProMatch, "2371002")
    assert refreshed.parsed_gcs_uri is not None
    assert refreshed.ingested_at is not None


def test_ingestion_cycle_rejects_gated_out_demo(db_session, tmp_path, monkeypatch):
    """A pro demo that is all warmup (zero live rounds after GameStateGate)
    fails parse-stage loudly instead of ingesting empty archetypes."""
    from unittest.mock import patch

    monkeypatch.setenv("LOCAL_MODE", "true")
    monkeypatch.setenv("PRO_PARSED_DIR", str(tmp_path))

    run_ingestion_cycle(db_session, client=FixtureClient())
    match = db_session.get(ProMatch, "2371003")
    match.demo_gcs_uri = "gs://demos/pro/2371003.dem"
    db_session.commit()

    empty = {"rounds": [], "kills": [], "grenades": [], "positions": [],
             "phase_summary": {"warmup_events_stripped": 99}}
    with patch("services.worker.parse_handler._call_parser", return_value=empty):
        summary = run_ingestion_cycle(db_session, client=FixtureClient())

    assert "2371003" in summary["failed"]
    assert db_session.get(ProMatch, "2371003").parsed_gcs_uri is None
