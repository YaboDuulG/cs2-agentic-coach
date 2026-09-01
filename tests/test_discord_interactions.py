"""
Discord interactions endpoint tests — FastAPI TestClient against api.main.app
with LOCAL_MODE on and DISCORD_PUBLIC_KEY unset (signature check skipped),
plus one signed-mode 401 check.
"""

import os
import uuid

from fastapi.testclient import TestClient
import pytest

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from api.main import app
from db.database import SessionLocal, engine
from db.models import (
    Base,
    Strat,
    StratRevision,
    StratStatus,
    SyncOutbox,
    Team,
    TeamDiscordLink,
)
from services.discord_bot.security import make_bind_code
from services.stratbook.service import create_strat, transition

client = TestClient(app)

URL = "/api/discord/interactions"


@pytest.fixture(autouse=True)
def env(monkeypatch):
    """LOCAL_MODE + unset public key → signature verification is skipped."""
    monkeypatch.setenv("LOCAL_MODE", "true")
    monkeypatch.delenv("DISCORD_PUBLIC_KEY", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_SECRET", "test-bind-secret")


@pytest.fixture()
def db():
    """Session on the app's shared in-memory engine; wipes module tables after."""
    Base.metadata.create_all(engine)
    session = SessionLocal()
    yield session
    session.rollback()
    for model in (SyncOutbox, StratRevision, Strat, TeamDiscordLink, Team):
        session.query(model).delete()
    session.commit()
    session.close()


@pytest.fixture()
def team(db):
    """Docstring for team."""
    team = Team(
        id=str(uuid.uuid4()), name="Test Horde", owner_user_id="owner-1",
        invite_code=uuid.uuid4().hex[:8],
    )
    db.add(team)
    db.commit()
    return team


@pytest.fixture()
def bound_team(db, team):
    """Team already bound to guild g-1 / channel c-1."""
    db.add(
        TeamDiscordLink(team_id=team.id, guild_id="g-1", channel_id="c-1", bound_by="du-1")
    )
    db.commit()
    return team


def _command(sub: str, options: dict, guild_id="g-1", channel_id="c-1", user_id="du-1") -> dict:
    """Build an APPLICATION_COMMAND payload for /strat <sub>."""
    return {
        "type": 2,
        "guild_id": guild_id,
        "channel_id": channel_id,
        "member": {"user": {"id": user_id}},
        "data": {
            "name": "strat",
            "options": [
                {
                    "type": 1,
                    "name": sub,
                    "options": [{"name": k, "value": v} for k, v in options.items()],
                }
            ],
        },
    }


def test_ping_pong():
    """Docstring for test_ping_pong."""
    response = client.post(URL, json={"type": 1})
    assert response.status_code == 200
    assert response.json() == {"type": 1}


def test_bad_signature_rejected_when_key_configured(monkeypatch):
    """With DISCORD_PUBLIC_KEY set, an unsigned request is a 401."""
    monkeypatch.setenv("DISCORD_PUBLIC_KEY", "aa" * 32)
    response = client.post(URL, json={"type": 1})
    assert response.status_code == 401


class TestBind:
    """Docstring for TestBind."""

    def test_bind_happy_path(self, db, team):
        """Docstring for test_bind_happy_path."""
        code = make_bind_code(team.id)
        response = client.post(URL, json=_command("bind", {"code": code}))
        assert response.status_code == 200
        assert team.name in response.json()["data"]["content"]

        db.expire_all()
        link = db.get(TeamDiscordLink, team.id)
        assert link is not None
        assert link.guild_id == "g-1"
        assert link.channel_id == "c-1"
        assert link.bound_by == "du-1"

    def test_bind_wrong_code_rejected(self, db, team):
        """Docstring for test_bind_wrong_code_rejected."""
        response = client.post(URL, json=_command("bind", {"code": f"{team.id}.deadbeef0000"}))
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["flags"] == 64  # ephemeral
        assert "invalid" in data["content"].lower()
        db.expire_all()
        assert db.get(TeamDiscordLink, team.id) is None

    def test_bind_already_bound_guild_rejected(self, db, bound_team):
        """Docstring for test_bind_already_bound_guild_rejected."""
        other = Team(
            id=str(uuid.uuid4()), name="Second Team", owner_user_id="owner-2",
            invite_code=uuid.uuid4().hex[:8],
        )
        db.add(other)
        db.commit()
        code = make_bind_code(other.id)
        response = client.post(URL, json=_command("bind", {"code": code}))
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["flags"] == 64
        assert "already bound" in data["content"].lower()
        db.expire_all()
        assert db.get(TeamDiscordLink, other.id) is None


class TestCreate:
    """Docstring for TestCreate."""

    def test_create_makes_draft_strat_and_outbox_row(self, db, bound_team):
        """Docstring for test_create_makes_draft_strat_and_outbox_row."""
        response = client.post(
            URL,
            json=_command(
                "create",
                {"title": "A Exec", "map": "de_mirage", "side": "T", "buy": "full_buy"},
            ),
        )
        assert response.status_code == 200
        assert "A Exec" in response.json()["data"]["content"]

        db.expire_all()
        strat = db.query(Strat).filter(Strat.team_id == bound_team.id).one()
        assert strat.status == StratStatus.DRAFT
        assert strat.title == "A Exec"
        assert strat.created_by == "discord:du-1"
        outbox = db.query(SyncOutbox).all()
        assert [o.kind for o in outbox] == ["strat_upsert"]

    def test_create_in_unbound_guild_gets_ephemeral_error(self, db, team):
        """Docstring for test_create_in_unbound_guild_gets_ephemeral_error."""
        response = client.post(
            URL,
            json=_command(
                "create",
                {"title": "A Exec", "map": "de_mirage", "side": "T", "buy": "full_buy"},
                guild_id="g-unbound",
            ),
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["flags"] == 64
        assert "isn't linked" in data["content"]
        db.expire_all()
        assert db.query(Strat).count() == 0


class TestAdapt:
    """Docstring for TestAdapt."""

    def test_adapt_inside_thread_enqueues_ai_adapt(self, db, bound_team):
        """Docstring for test_adapt_inside_thread_enqueues_ai_adapt."""
        strat = create_strat(
            db, team_id=bound_team.id, title="B Rush", map_name="de_inferno", side="T",
            buy_type="full_buy", canvas={}, description="", utility=None, author_id="u1",
        )
        strat.discord_thread_id = "thread-9"
        db.commit()
        db.query(SyncOutbox).delete()  # drop the create's own upsert row
        db.commit()

        response = client.post(
            URL,
            json=_command("adapt", {"prompt": "add a banana molly"}, channel_id="thread-9"),
        )
        assert response.status_code == 200
        assert "Working on it" in response.json()["data"]["content"]

        db.expire_all()
        item = db.query(SyncOutbox).one()
        assert item.kind == "ai_adapt"
        import json

        payload = json.loads(item.payload_json)
        assert payload["strat_id"] == strat.id
        assert payload["prompt"] == "add a banana molly"
        assert payload["thread_id"] == "thread-9"

    def test_adapt_outside_thread_rejected(self, db, bound_team):
        """Docstring for test_adapt_outside_thread_rejected."""
        response = client.post(
            URL, json=_command("adapt", {"prompt": "x"}, channel_id="c-1")
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["flags"] == 64
        db.expire_all()
        assert db.query(SyncOutbox).count() == 0


class TestApproveButton:
    """Docstring for TestApproveButton."""

    def test_approve_transitions_in_review_to_active(self, db, bound_team):
        """Docstring for test_approve_transitions_in_review_to_active."""
        strat = create_strat(
            db, team_id=bound_team.id, title="Split A", map_name="de_mirage", side="T",
            buy_type="full_buy", canvas={}, description="", utility=None, author_id="u1",
        )
        transition(db, strat, StratStatus.IN_REVIEW, actor="u1")
        db.commit()

        response = client.post(
            URL,
            json={
                "type": 3,
                "guild_id": "g-1",
                "member": {"user": {"id": "du-2"}},
                "data": {"custom_id": f"strat_approve:{strat.id}"},
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["type"] == 7  # UPDATE_MESSAGE strips the button
        assert body["data"]["components"] == []

        db.expire_all()
        assert db.get(Strat, strat.id).status == StratStatus.ACTIVE
        kinds = [o.kind for o in db.query(SyncOutbox).order_by(SyncOutbox.id).all()]
        assert kinds[-1] == "strat_status"

    def test_approve_from_wrong_guild_rejected(self, db, bound_team):
        """Docstring for test_approve_from_wrong_guild_rejected."""
        strat = create_strat(
            db, team_id=bound_team.id, title="Split A", map_name="de_mirage", side="T",
            buy_type="full_buy", canvas={}, description="", utility=None, author_id="u1",
        )
        transition(db, strat, StratStatus.IN_REVIEW, actor="u1")
        db.commit()

        response = client.post(
            URL,
            json={
                "type": 3,
                "guild_id": "g-other",
                "member": {"user": {"id": "du-2"}},
                "data": {"custom_id": f"strat_approve:{strat.id}"},
            },
        )
        assert response.status_code == 200
        assert response.json()["data"]["flags"] == 64
        db.expire_all()
        assert db.get(Strat, strat.id).status == StratStatus.IN_REVIEW
