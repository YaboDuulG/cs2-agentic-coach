"""
Discord end to end, with this suite playing Discord.
=====================================================
Every request to /api/discord/interactions is signed with a real Ed25519 key
and verified by the app (LOCAL_MODE off, DISCORD_PUBLIC_KEY set), exactly as
in production. The worker's Discord REST calls go to a fake that records them.
One test walks the whole life of a strat in a server laid out as one channel
per map:

    captain mints a bind code on the web
      → /strat bind in #mirage binds the channel group
      → worker maps the group's channels to maps
      → /strat create in #de-inferno (no map typed)
      → worker opens the thread in #de-inferno and posts the embed
      → captain submits it for review on the web
      → worker posts the Approve button in the thread
      → a player presses Approve in Discord → ACTIVE
      → worker posts the status line
      → the web status route shows the binding and the map channels

If this passes, everything on our side of the wire works; what is left to
verify live is configuration (scripts/discord_doctor.py).
"""

import json
import os
import uuid

from fastapi.testclient import TestClient
import pytest

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from api.main import app
from db.database import SessionLocal, engine
from db.models import (
    Base,
    KnowledgeEmbedding,
    OutboxStatus,
    Strat,
    StratRevision,
    StratStatus,
    SyncOutbox,
    Team,
    TeamDiscordChannel,
    TeamDiscordIngestCursor,
    TeamDiscordLink,
    TeamMember,
)
from db.outbox import claim_next, complete
from services.discord_bot import sync
from tests.discord_fakes import (
    CATEGORY,
    GUILD,
    DiscordSigner,
    FakeDiscord,
    button,
    channel_obj,
    command,
)

client = TestClient(app)
URL = "/api/discord/interactions"
OWNER = "user_captain"


@pytest.fixture()
def signer(monkeypatch):
    """Production posture: signatures enforced, bind secret set."""
    signer = DiscordSigner()
    monkeypatch.setenv("LOCAL_MODE", "false")
    monkeypatch.setenv("DISCORD_PUBLIC_KEY", signer.public_key_hex)
    monkeypatch.setenv("DISCORD_WEBHOOK_SECRET", "e2e-bind-secret")
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "e2e-not-a-real-token")
    return signer


@pytest.fixture()
def discord(monkeypatch):
    """Docstring for discord."""
    fake = FakeDiscord()
    monkeypatch.setattr(sync, "_discord_request", fake)
    return fake


@pytest.fixture()
def db():
    """Docstring for db."""
    Base.metadata.create_all(engine)
    session = SessionLocal()
    session.query(KnowledgeEmbedding).delete()
    session.query(SyncOutbox).delete()
    session.commit()
    yield session
    session.rollback()
    for model in (SyncOutbox, KnowledgeEmbedding, StratRevision, Strat, TeamDiscordIngestCursor, TeamDiscordChannel, TeamDiscordLink, TeamMember, Team):
        session.query(model).delete()
    session.commit()
    session.close()


@pytest.fixture()
def team(db):
    """Docstring for team."""
    team = Team(id=str(uuid.uuid4()), name="Night Shift", owner_user_id=OWNER, invite_code=uuid.uuid4().hex[:8])
    db.add(team)
    db.add(TeamMember(team_id=team.id, user_id=OWNER, role="owner"))
    db.commit()
    return team


def send(signer: DiscordSigner, payload: dict):
    """POST one signed interaction, as Discord would."""
    body, headers = signer.request(payload)
    return client.post(URL, content=body, headers=headers)


def drain(db) -> list[str]:
    """Run the worker's outbox loop to empty; returns the kinds processed."""
    kinds = []
    while (item := claim_next(db, "e2e-worker")) is not None:
        sync.process_outbox_item(db, item)
        complete(db, item)
        kinds.append(item.kind)
    return kinds


class TestSignatureGate:
    """Docstring for TestSignatureGate."""

    def test_signed_ping_gets_pong(self, signer):
        """What Discord sends when you save the Interactions Endpoint URL."""
        r = send(signer, {"type": 1})
        assert r.status_code == 200 and r.json() == {"type": 1}

    def test_unsigned_request_is_refused(self, signer):
        """Docstring for test_unsigned_request_is_refused."""
        r = client.post(URL, json={"type": 1})
        assert r.status_code == 401 and r.json()["detail"] == "Bad request signature"

    def test_signature_from_another_key_is_refused(self, signer):
        """Docstring for test_signature_from_another_key_is_refused."""
        body, headers = DiscordSigner().request({"type": 1})
        assert client.post(URL, content=body, headers=headers).status_code == 401

    def test_body_changed_after_signing_is_refused(self, signer):
        """Docstring for test_body_changed_after_signing_is_refused."""
        _, headers = signer.request({"type": 1})
        tampered = json.dumps({"type": 2, "data": {"name": "strat"}}).encode()
        assert client.post(URL, content=tampered, headers=headers).status_code == 401

    def test_missing_public_key_fails_closed(self, signer, monkeypatch):
        """The state production is in until the secret is set."""
        monkeypatch.delenv("DISCORD_PUBLIC_KEY")
        r = send(signer, {"type": 1})
        assert r.status_code == 401 and "not configured" in r.json()["detail"]


def test_a_strat_lives_its_whole_life_across_web_and_discord(signer, discord, db, team):
    """Docstring for test_a_strat_lives_its_whole_life_across_web_and_discord."""
    web = {"x-clerk-user-id": OWNER}

    # 1. The captain mints the bind code on the web.
    code = client.post(f"/api/teams/{team.id}/discord/bind-code", params={"user_id": OWNER}).json()["code"]

    # 2. Commands do nothing before the server is bound.
    r = send(signer, command("create", {"title": "Too early"}, channel=channel_obj("c-mirage")))
    assert "isn't linked to a team" in r.json()["data"]["content"]

    # 3. /strat bind inside the Maps group binds the whole group.
    r = send(signer, command("bind", {"code": code}, channel=channel_obj("c-mirage")))
    assert "Night Shift" in r.json()["data"]["content"]
    assert db.get(TeamDiscordLink, team.id).category_id == CATEGORY

    # 4. The worker maps the group's channels. The interaction never called Discord.
    assert discord.calls == []
    assert drain(db) == ["channels_sync"]
    assert {c.channel_id: c.map_name for c in db.query(TeamDiscordChannel).all()} == {
        "c-mirage": "de_mirage", "c-inferno": "de_inferno", "c-dust2": "de_dust2",
    }

    # 5. /strat create in #de-inferno with no map typed.
    r = send(signer, command("create", {"title": "Banana control", "side": "CT"}, channel=channel_obj("c-inferno")))
    assert "<#c-inferno>" in r.json()["data"]["content"]
    strat = db.query(Strat).one()
    assert (strat.map_name, strat.side, StratStatus(strat.status)) == ("de_inferno", "CT", StratStatus.DRAFT)
    assert strat.created_by == "discord:discord-user-1"

    # 6. The worker opens the thread in the inferno channel and posts the embed.
    assert drain(db) == ["strat_upsert"]
    db.refresh(strat)
    assert discord.threads == {strat.discord_thread_id: "c-inferno"}
    thread = strat.discord_thread_id
    embed = discord.messages[-1][1]["embeds"][0]
    assert discord.messages[-1][0] == thread and embed["title"] == "Banana control"
    assert "components" not in discord.messages[-1][1]  # a DRAFT has no Approve button

    # 7. The captain submits it for review on the web.
    r = client.post(f"/api/strats/{strat.id}/transition", json={"status": "IN_REVIEW"}, headers=web)
    assert r.status_code == 200 and r.json()["status"] == "IN_REVIEW"

    # 8. The worker posts the status line, then the embed with the Approve button.
    assert drain(db) == ["strat_status"]
    assert "IN_REVIEW" in discord.messages[-2][1]["content"]
    approve = discord.messages[-1][1]["components"][0]["components"][0]
    assert discord.messages[-1][0] == thread and approve["label"] == "Approve"

    # 9. A press from another server is refused; from this one it approves.
    r = send(signer, button(approve["custom_id"], guild_id="some-other-guild"))
    assert "doesn't belong" in r.json()["data"]["content"]
    r = send(signer, button(approve["custom_id"]))
    assert r.json()["type"] == 7 and r.json()["data"]["components"] == []
    db.refresh(strat)
    assert StratStatus(strat.status) == StratStatus.ACTIVE

    # 10. The worker announces it; a second press is refused by the state machine.
    assert drain(db) == ["strat_status"]
    assert "ACTIVE" in discord.messages[-1][1]["content"] and "discord:discord-user-2" in discord.messages[-1][1]["content"]
    assert "not allowed" in send(signer, button(approve["custom_id"])).json()["data"]["content"]

    # 11. The web sees the binding, the channels, and the strat's thread.
    status = client.get(f"/api/teams/{team.id}/discord", params={"user_id": OWNER}).json()
    assert status["configured"] and status["bound"] and status["guild_id"] == GUILD
    assert len(status["channels"]) == 3
    assert client.get(f"/api/strats/{strat.id}", headers=web).json()["discord_thread_id"] == thread

    # 12. Nothing is left pending or failed, and Discord was only ever called by the worker.
    assert db.query(SyncOutbox).filter(SyncOutbox.status != OutboxStatus.DONE).count() == 0
    assert discord.paths("GET") == [f"/guilds/{GUILD}/channels"]
    assert len(discord.paths("POST")) == 5  # thread, embed, review line, review embed, active line


def test_a_web_strat_lands_in_its_map_channel_without_any_command(signer, discord, db, team):
    """The other direction: drawn on the web, discussed in Discord."""
    web = {"x-clerk-user-id": OWNER}
    code = client.post(f"/api/teams/{team.id}/discord/bind-code", params={"user_id": OWNER}).json()["code"]
    send(signer, command("bind", {"code": code}, channel=channel_obj("c-general")))
    drain(db)

    r = client.post("/api/strats/", json={"team_id": team.id, "title": "Long doors", "map_name": "de_dust2"}, headers=web)
    assert r.status_code == 200
    assert drain(db) == ["strat_upsert"]
    assert list(discord.threads.values()) == ["c-dust2"]

    # A map with no channel in the group goes to the channel bind ran in.
    client.post("/api/strats/", json={"team_id": team.id, "title": "Ramp rush", "map_name": "de_nuke"}, headers=web)
    drain(db)
    assert list(discord.threads.values()) == ["c-dust2", "c-general"]


def test_a_discord_outage_requeues_and_recovers(signer, db, team, monkeypatch):
    """The outbox is what makes Discord failures invisible to users."""
    from db.outbox import fail

    code = client.post(f"/api/teams/{team.id}/discord/bind-code", params={"user_id": OWNER}).json()["code"]
    send(signer, command("bind", {"code": code}, channel=channel_obj("c-mirage")))

    def down(method, path, json_body=None):
        raise RuntimeError("Discord API 503 on " + path)

    monkeypatch.setattr(sync, "_discord_request", down)
    item = claim_next(db, "e2e-worker")
    with pytest.raises(RuntimeError):
        sync.process_outbox_item(db, item)
    fail(db, item, "Discord API 503")
    assert item.status == OutboxStatus.PENDING and item.attempts == 1

    monkeypatch.setattr(sync, "_discord_request", FakeDiscord())
    assert drain(db) == ["channels_sync"]
    assert db.query(TeamDiscordChannel).count() == 3


def test_ingest_reads_the_map_channel_since_last_time(signer, discord, db, team, monkeypatch):
    """/strat ingest, signed, through the worker: the channel's history is read
    from the beginning, then only what is new. Gemini is a stand-in."""
    from services.discord_bot import ingest

    monkeypatch.setenv("GEMINI_API_KEY", "fake-key-so-ingest-runs")
    monkeypatch.setattr(ingest, "embed", lambda text: [0.0] * 768)
    monkeypatch.setattr(
        ingest, "extract_strategies",
        lambda conversation, map_name, team_id: [
            {"title": line.split(": ", 1)[1][:40], "map_name": map_name or "", "side": "T", "summary": "", "steps": [line]}
            for line in conversation.splitlines() if "smoke" in line
        ],
    )
    code = client.post(f"/api/teams/{team.id}/discord/bind-code", params={"user_id": OWNER}).json()["code"]
    send(signer, command("bind", {"code": code}, channel=channel_obj("c-mirage")))
    drain(db)

    discord.seed_history("c-mirage", ["anyone on tonight?", "A exec: smoke jungle + stairs, flash over top", "nice"])
    r = send(signer, command("ingest", channel=channel_obj("c-mirage")))
    assert r.json()["data"]["content"].startswith("Reading <#c-mirage> from the beginning as de_mirage strategies")
    assert drain(db) == ["channel_ingest", "discord_reply"]
    rows = db.query(KnowledgeEmbedding).all()
    assert len(rows) == 1 and json.loads(rows[0].metadata_json)["map_name"] == "de_mirage"
    assert "saved 1 strategy" in discord.messages[-1][1]["content"]

    discord.seed_history("c-mirage", ["B retake: smoke short, flash from window"])
    send(signer, command("ingest", channel=channel_obj("c-mirage")))
    drain(db)
    assert db.query(KnowledgeEmbedding).count() == 2
    assert client.get(f"/api/teams/{team.id}/strategies").json()[0]["title"].startswith("B retake")
