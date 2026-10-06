"""POST /api/webhooks/faceit: the one FACEIT receiver. Signature required
outside local development; duplicates are free; the demo lookup never blocks
the event loop (it runs in a thread)."""

import hashlib
import hmac
import json
import os
from unittest.mock import patch

from fastapi.testclient import TestClient
import pytest

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from api.main import app
from db.database import SessionLocal, engine
from db.models import Base, Match

client = TestClient(app)
URL = "/api/webhooks/faceit"
SECRET = "faceit-test-secret"


def signed(payload: dict, secret: str = SECRET) -> tuple[bytes, dict]:
    """Docstring for signed."""
    body = json.dumps(payload).encode()
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return body, {"Content-Type": "application/json", "X-FACEIT-Signature": sig}


FINISHED = {"event": "match_status_finished", "payload": {"id": "fm-1"}}


@pytest.fixture(autouse=True)
def env(monkeypatch):
    """Production posture by default."""
    monkeypatch.setenv("FACEIT_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("LOCAL_MODE", "true")  # Cloud Tasks enqueue is skipped
    monkeypatch.delenv("APP_ENV", raising=False)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        db.query(Match).filter(Match.demo_filename.like("faceit_%")).delete(synchronize_session=False)
        db.commit()


class TestSignature:
    """Docstring for TestSignature."""

    def test_unsigned_is_401(self):
        """Docstring for test_unsigned_is_401."""
        r = client.post(URL, json=FINISHED)
        assert r.status_code == 401

    def test_wrong_signature_is_401(self):
        """Docstring for test_wrong_signature_is_401."""
        body, headers = signed(FINISHED, secret="someone-elses")
        assert client.post(URL, content=body, headers=headers).status_code == 401

    def test_missing_secret_fails_closed_outside_dev(self, monkeypatch):
        """The review's finding: an unset secret used to accept everything."""
        monkeypatch.delenv("FACEIT_WEBHOOK_SECRET")
        monkeypatch.setenv("LOCAL_MODE", "false")
        assert client.post(URL, json=FINISHED).status_code == 401

    def test_missing_secret_is_tolerated_in_local_dev(self, monkeypatch):
        """Docstring for test_missing_secret_is_tolerated_in_local_dev."""
        monkeypatch.delenv("FACEIT_WEBHOOK_SECRET")
        monkeypatch.setenv("LOCAL_MODE", "true")
        r = client.post(URL, json={"event": "match_status_cancelled", "payload": {"id": "x"}})
        assert r.status_code == 200 and r.text == "ignored"

    def test_sha256_prefix_is_accepted(self):
        """Docstring for test_sha256_prefix_is_accepted."""
        body, headers = signed({"event": "other", "payload": {}})
        headers["X-FACEIT-Signature"] = "sha256=" + headers["X-FACEIT-Signature"]
        assert client.post(URL, content=body, headers=headers).status_code == 200


class TestProcessing:
    """Docstring for TestProcessing."""

    def test_finished_match_is_queued_once(self):
        """Docstring for test_finished_match_is_queued_once."""
        body, headers = signed(FINISHED)
        with patch("api.routes.webhooks._fetch_demo_url", return_value="https://demos.example/fm-1.dem") as fetch:
            first = client.post(URL, content=body, headers=headers)
            second = client.post(URL, content=body, headers=headers)
        assert (first.text, second.text) == ("queued", "already_exists")
        fetch.assert_called_once()  # the retry never hits FACEIT
        with SessionLocal() as db:
            assert db.query(Match).filter(Match.demo_filename == "faceit_fm-1.dem").count() == 1

    def test_no_demo_url_is_acknowledged_not_errored(self):
        """Docstring for test_no_demo_url_is_acknowledged_not_errored."""
        body, headers = signed(FINISHED)
        with patch("api.routes.webhooks._fetch_demo_url", return_value=None):
            r = client.post(URL, content=body, headers=headers)
        assert r.status_code == 200 and r.text == "no_demo"

    def test_other_events_are_ignored(self):
        """Docstring for test_other_events_are_ignored."""
        body, headers = signed({"event": "match_status_ready", "payload": {"id": "fm-2"}})
        assert client.post(URL, content=body, headers=headers).text == "ignored"

    def test_the_old_receiver_is_gone(self):
        """/api/faceit/webhook sat behind the user auth dependency, so FACEIT
        could never reach it; keeping two receivers invites double-processing."""
        r = client.post("/api/faceit/webhook", json=FINISHED)
        assert r.status_code in (401, 403, 404, 405)
        assert client.get("/api/faceit/status").json()["webhook_url_path"] == URL


def test_crawler_creates_demo_and_match_rows():
    """Both FACEIT paths used to set map/status/URL on Match, whose columns
    moved to Demo; the helper writes both rows the way presign does."""
    from db.models import Demo, MatchStatus
    from services.ingestion.faceit_crawler import create_faceit_match

    with SessionLocal() as db:
        match_id = create_faceit_match(db, "fm-9", "https://demos.example/fm-9.dem", team_id=None, user_id="u1")
        db.commit()
        match = db.get(Match, match_id)
        demo = db.get(Demo, match.demo_id)
        assert (match.demo_filename, match.user_id) == ("faceit_fm-9.dem", "u1")
        assert (demo.gcs_demo_uri, demo.map_name, demo.status) == ("https://demos.example/fm-9.dem", "unknown", MatchStatus.PENDING)
        assert match.status == MatchStatus.PENDING and match.gcs_demo_uri == demo.gcs_demo_uri
