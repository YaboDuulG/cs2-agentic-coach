"""DatHost: out of credits fails loudly (no mock server), and mock/local
servers never count as billable hours in the metering table."""

from datetime import datetime, timedelta
import os
from unittest.mock import patch

import pytest
import requests

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"
os.environ.setdefault("LOCAL_MODE", "true")

from db.database import SessionLocal, engine
from db.models import Base, LlmUsage, PracticeServer, Subscription, Team, TrainingSession
from services.billing.metering import team_metering
from services.warlord import dathost_client
from services.warlord.dathost_client import DatHostCreditsError, provision_practice_server


def _http_error(text: str) -> requests.exceptions.HTTPError:
    """Docstring for _http_error."""
    resp = requests.Response()
    resp.status_code = 402
    resp._content = text.encode()
    return requests.exceptions.HTTPError(response=resp)


class TestProvisioning:
    """Docstring for TestProvisioning."""

    def test_out_of_credits_raises_instead_of_mocking(self, monkeypatch):
        """Docstring for test_out_of_credits_raises_instead_of_mocking."""
        monkeypatch.setenv("DATHOST_EMAIL", "e2e@example.com")
        monkeypatch.setenv("DATHOST_PASSWORD", "x")
        monkeypatch.setattr(dathost_client, "is_valve_update_window", lambda: False)
        with patch.object(dathost_client.requests, "post", side_effect=_http_error('{"error": "Insufficient credits"}')):
            with pytest.raises(DatHostCreditsError) as e:
                provision_practice_server("match123", "https://x/webhook", region="na", mode="practice")
        assert "out of credits" in str(e.value)

    def test_other_failures_still_raise_value_error(self, monkeypatch):
        """Docstring for test_other_failures_still_raise_value_error."""
        monkeypatch.setenv("DATHOST_EMAIL", "e2e@example.com")
        monkeypatch.setenv("DATHOST_PASSWORD", "x")
        monkeypatch.setattr(dathost_client, "is_valve_update_window", lambda: False)
        with patch.object(dathost_client.requests, "post", side_effect=_http_error("boom")):
            with pytest.raises(ValueError) as e:
                provision_practice_server("match123", "https://x/webhook")
        assert not isinstance(e.value, DatHostCreditsError)


@pytest.fixture()
def db():
    """Docstring for db."""
    Base.metadata.create_all(engine)
    session = SessionLocal()
    for model in (LlmUsage, TrainingSession, PracticeServer, Subscription, Team):
        session.query(model).delete()
    session.commit()
    yield session
    session.close()


def test_mock_and_local_servers_are_not_billable(db):
    """Docstring for test_mock_and_local_servers_are_not_billable."""
    now = datetime(2026, 11, 1)
    db.add(Team(id="t1", name="Alpha", owner_user_id="a", invite_code="ALPHA002"))
    exp = now + timedelta(hours=2)
    db.add_all(
        [
            PracticeServer(id="real", team_id="t1", vultr_instance_id="dh_abc", rcon_password="r", server_password="s", expires_at=exp),
            PracticeServer(id="mock", team_id="t1", vultr_instance_id="mock-1234", rcon_password="r", server_password="s", expires_at=exp),
            PracticeServer(id="local", team_id="t1", vultr_instance_id="local-5678", rcon_password="r", server_password="s", expires_at=exp),
        ]
    )
    db.add_all(
        [
            TrainingSession(id="s1", team_id="t1", user_id="a", server_id="real", started_at=datetime(2026, 10, 10), duration_seconds=3600),
            TrainingSession(id="s2", team_id="t1", user_id="a", server_id="mock", started_at=datetime(2026, 10, 11), duration_seconds=36000),
            TrainingSession(id="s3", team_id="t1", user_id="a", server_id="local", started_at=datetime(2026, 10, 12), duration_seconds=36000),
            TrainingSession(id="s4", team_id="t1", user_id="a", server_id=None, started_at=datetime(2026, 10, 13), duration_seconds=1800),
        ]
    )
    db.commit()

    row = team_metering(db, "season", now=now)["teams"][0]
    assert row["server_sessions"] == 2  # real + the one whose server row is gone
    assert row["server_hours"] == pytest.approx(1.5)
