"""
Channel groups: a team binds a Discord category holding one channel per map.
Covers the name matching, the interaction commands that read the channel, the
worker jobs that pick a strat's home channel, the team-level web routes, and
the ingestion webhook failing closed.
"""

import hashlib
import hmac
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
from services.discord_bot import sync
from services.discord_bot.channels import map_from_name
from services.discord_bot.security import make_bind_code
from services.stratbook.service import create_strat, transition
from tests.discord_fakes import (
    CATEGORY,
    GUILD,
    GUILD_CHANNELS,
    FakeDiscord,
    channel_obj,
    command,
    thread_obj,
)

client = TestClient(app)
URL = "/api/discord/interactions"
OWNER = "owner-1"


@pytest.fixture(autouse=True)
def env(monkeypatch):
    """LOCAL_MODE with no public key: the signature check is skipped (the
    signed path has its own suite in test_discord_e2e.py)."""
    monkeypatch.setenv("LOCAL_MODE", "true")
    monkeypatch.delenv("DISCORD_PUBLIC_KEY", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_SECRET", "test-bind-secret")


@pytest.fixture()
def db():
    """Docstring for db."""
    Base.metadata.create_all(engine)
    session = SessionLocal()
    yield session
    session.rollback()
    for model in (SyncOutbox, StratRevision, Strat, TeamDiscordIngestCursor, TeamDiscordChannel, TeamDiscordLink, TeamMember, Team):
        session.query(model).delete()
    session.commit()
    session.close()


@pytest.fixture()
def team(db):
    """Docstring for team."""
    team = Team(id=str(uuid.uuid4()), name="Night Shift", owner_user_id=OWNER, invite_code=uuid.uuid4().hex[:8])
    db.add(team)
    db.add(TeamMember(team_id=team.id, user_id=OWNER, role="owner"))
    db.add(TeamMember(team_id=team.id, user_id="member-1", role="member"))
    db.commit()
    return team


@pytest.fixture()
def group_team(db, team):
    """Team bound to the Maps channel group, with the worker's sync applied."""
    link = TeamDiscordLink(team_id=team.id, guild_id=GUILD, channel_id="c-general", category_id=CATEGORY, bound_by="d1")
    db.add(link)
    db.flush()
    from services.discord_bot.channels import store_category_channels

    store_category_channels(db, link, GUILD_CHANNELS)
    db.commit()
    return team


@pytest.fixture()
def discord(monkeypatch):
    """Docstring for discord."""
    fake = FakeDiscord()
    monkeypatch.setattr(sync, "_discord_request", fake)
    return fake


def _run(db, kind: str, payload: dict) -> None:
    """Process one outbox item of this kind, as the worker would."""
    item = SyncOutbox(kind=kind, payload_json=json.dumps(payload))
    db.add(item)
    db.commit()
    sync.process_outbox_item(db, item)


def _content(resp) -> str:
    """Docstring for _content."""
    return resp.json()["data"]["content"]


class TestMapFromName:
    """Docstring for TestMapFromName."""

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("mirage", "de_mirage"),
            ("de_mirage", "de_mirage"),
            ("de-mirage", "de_mirage"),
            ("demirage", "de_mirage"),
            ("Mirage", "de_mirage"),
            ("🟧│mirage-strats", "de_mirage"),
            ("inferno", "de_inferno"),
            ("dust2", "de_dust2"),
            ("dust-2", "de_dust2"),
            ("Dust 2", "de_dust2"),
            ("d2", "de_dust2"),
            ("ancient", "de_ancient"),
            ("anubis", "de_anubis"),
            ("nuke", "de_nuke"),
            ("vertigo", "de_vertigo"),
            ("overpass", "de_overpass"),
            ("train", "de_train"),
            ("cs_office", "cs_office"),
        ],
    )
    def test_map_channels_resolve(self, name, expected):
        """Docstring for test_map_channels_resolve."""
        assert map_from_name(name) == expected

    @pytest.mark.parametrize("name", ["training", "general", "strat-general", "lobby", "", None, "demos", "cs2-news"])
    def test_other_channels_do_not(self, name):
        """Docstring for test_other_channels_do_not."""
        assert map_from_name(name) is None


class TestBindAGroup:
    """Docstring for TestBindAGroup."""

    def test_bind_inside_a_group_binds_the_category(self, db, team):
        """Docstring for test_bind_inside_a_group_binds_the_category."""
        r = client.post(URL, json=command("bind", {"code": make_bind_code(team.id)}, channel=channel_obj("c-mirage")))
        assert r.status_code == 200
        assert "channel group" in _content(r)
        link = db.get(TeamDiscordLink, team.id)
        assert (link.guild_id, link.category_id, link.channel_id) == (GUILD, CATEGORY, "c-mirage")
        # The channel bind ran in is known at once; the rest waits for the worker.
        assert db.get(TeamDiscordChannel, "c-mirage").map_name == "de_mirage"
        kinds = [o.kind for o in db.query(SyncOutbox).all()]
        assert kinds == ["channels_sync"]

    def test_bind_outside_any_group_is_single_channel_mode(self, db, team):
        """Docstring for test_bind_outside_any_group_is_single_channel_mode."""
        r = client.post(URL, json=command("bind", {"code": make_bind_code(team.id)}, channel=channel_obj("c-lobby")))
        assert "not in a channel group" in _content(r)
        link = db.get(TeamDiscordLink, team.id)
        assert link.category_id is None and link.channel_id == "c-lobby"
        assert db.query(TeamDiscordChannel).count() == 0

    def test_payload_without_a_channel_object_still_binds(self, db, team):
        """Older interaction shapes carry only channel_id."""
        payload = command("bind", {"code": make_bind_code(team.id)})
        del payload["channel"]
        r = client.post(URL, json=payload)
        assert r.status_code == 200
        assert db.get(TeamDiscordLink, team.id).category_id is None


class TestChannelsSync:
    """Docstring for TestChannelsSync."""

    def test_maps_only_text_channels_of_the_bound_group(self, db, team, discord):
        """Docstring for test_maps_only_text_channels_of_the_bound_group."""
        db.add(TeamDiscordLink(team_id=team.id, guild_id=GUILD, channel_id="c-mirage", category_id=CATEGORY, bound_by="d1"))
        db.commit()
        _run(db, "channels_sync", {"team_id": team.id})
        rows = {r.channel_id: r.map_name for r in db.query(TeamDiscordChannel).all()}
        # Not the voice channel named nuke, not #training, not the other group's #mirage.
        assert rows == {"c-mirage": "de_mirage", "c-inferno": "de_inferno", "c-dust2": "de_dust2"}
        assert discord.paths("GET") == [f"/guilds/{GUILD}/channels"]

    def test_resolves_the_group_when_bind_did_not_carry_it(self, db, team, discord):
        """Docstring for test_resolves_the_group_when_bind_did_not_carry_it."""
        db.add(TeamDiscordLink(team_id=team.id, guild_id=GUILD, channel_id="c-inferno", category_id=None, bound_by="d1"))
        db.commit()
        _run(db, "channels_sync", {"team_id": team.id})
        db.expire_all()
        assert db.get(TeamDiscordLink, team.id).category_id == CATEGORY
        assert db.query(TeamDiscordChannel).count() == 3

    def test_renamed_or_removed_channels_are_dropped(self, db, group_team, monkeypatch):
        """Docstring for test_renamed_or_removed_channels_are_dropped."""
        renamed = [dict(c, name="old-inferno-archive-x") if c["id"] == "c-inferno" else c for c in GUILD_CHANNELS]
        renamed = [c for c in renamed if c["id"] != "c-dust2"]
        renamed[2] = dict(renamed[2], name="general-chat")
        monkeypatch.setattr(sync, "_discord_request", FakeDiscord(renamed))
        _run(db, "channels_sync", {"team_id": group_team.id})
        assert {r.channel_id for r in db.query(TeamDiscordChannel).all()} == {"c-mirage"}

    def test_unbound_team_is_a_no_op(self, db, team, discord):
        """Docstring for test_unbound_team_is_a_no_op."""
        _run(db, "channels_sync", {"team_id": team.id})
        assert discord.calls == []


class TestCommandsReadTheChannel:
    """Docstring for TestCommandsReadTheChannel."""

    def test_create_in_a_map_channel_needs_no_map(self, db, group_team):
        """Docstring for test_create_in_a_map_channel_needs_no_map."""
        r = client.post(URL, json=command("create", {"title": "A split"}, channel=channel_obj("c-inferno")))
        strat = db.query(Strat).one()
        assert strat.map_name == "de_inferno"
        assert "<#c-inferno>" in _content(r)

    def test_typed_map_wins_and_is_normalised(self, db, group_team):
        """Docstring for test_typed_map_wins_and_is_normalised."""
        r = client.post(URL, json=command("create", {"title": "B rush", "map": "Dust 2"}, channel=channel_obj("c-mirage")))
        assert db.query(Strat).one().map_name == "de_dust2"
        assert "<#c-dust2>" in _content(r)

    def test_create_outside_a_map_channel_asks_for_the_map(self, db, group_team):
        """Docstring for test_create_outside_a_map_channel_asks_for_the_map."""
        r = client.post(URL, json=command("create", {"title": "No map"}, channel=channel_obj("c-general")))
        assert r.json()["data"]["flags"] == 64
        assert "Which map" in _content(r)
        assert db.query(Strat).count() == 0

    def test_create_inside_a_strat_thread_uses_the_parent_channel(self, db, group_team):
        """Docstring for test_create_inside_a_strat_thread_uses_the_parent_channel."""
        client.post(URL, json=command("create", {"title": "From a thread"}, channel=thread_obj("t-9", "c-dust2")))
        assert db.query(Strat).one().map_name == "de_dust2"

    def test_unknown_map_is_kept_and_falls_back_to_the_bind_channel(self, db, group_team):
        """Docstring for test_unknown_map_is_kept_and_falls_back_to_the_bind_channel."""
        r = client.post(URL, json=command("create", {"title": "Workshop", "map": "aim_map"}, channel=channel_obj("c-mirage")))
        assert db.query(Strat).one().map_name == "aim_map"
        assert "<#c-general>" in _content(r)

    def test_view_defaults_to_the_channels_map(self, db, group_team):
        """Docstring for test_view_defaults_to_the_channels_map."""
        for title, map_name in (("Mirage A", "de_mirage"), ("Inferno B", "de_inferno")):
            create_strat(db, team_id=group_team.id, title=title, map_name=map_name, side="T", buy_type="full_buy",
                         canvas={}, description="", utility=None, author_id="u1")
        db.commit()
        text = _content(client.post(URL, json=command("view", channel=channel_obj("c-mirage"))))
        assert "Mirage A" in text and "Inferno B" not in text

    def test_a_command_teaches_the_cache_a_new_channel(self, db, team):
        """A channel added to the group after the last sync is learned from
        the first command run in it."""
        db.add(TeamDiscordLink(team_id=team.id, guild_id=GUILD, channel_id="c-general", category_id=CATEGORY, bound_by="d1"))
        db.commit()
        client.post(URL, json=command("view", channel=channel_obj("c-dust2")))
        assert db.get(TeamDiscordChannel, "c-dust2").map_name == "de_dust2"

    def test_channels_lists_the_mapping_and_queues_a_refresh(self, db, group_team):
        """Docstring for test_channels_lists_the_mapping_and_queues_a_refresh."""
        r = client.post(URL, json=command("channels", channel=channel_obj("c-general")))
        text = _content(r)
        assert r.json()["data"]["flags"] == 64
        for line in ("<#c-mirage> → de_mirage", "<#c-inferno> → de_inferno", "<#c-dust2> → de_dust2", "<#c-general>"):
            assert line in text
        assert [o.kind for o in db.query(SyncOutbox).all()] == ["channels_sync"]

    def test_channels_in_single_channel_mode_explains_it(self, db, team):
        """Docstring for test_channels_in_single_channel_mode_explains_it."""
        db.add(TeamDiscordLink(team_id=team.id, guild_id=GUILD, channel_id="c-lobby", category_id=None, bound_by="d1"))
        db.commit()
        assert "Single-channel mode" in _content(client.post(URL, json=command("channels", channel=channel_obj("c-lobby"))))


class TestThreadHome:
    """Docstring for TestThreadHome."""

    def _strat(self, db, team_id: str, map_name: str) -> Strat:
        """Docstring for _strat."""
        strat = create_strat(db, team_id=team_id, title=f"Exec {map_name}", map_name=map_name, side="T",
                             buy_type="full_buy", canvas={}, description="", utility=None, author_id="u1")
        db.commit()
        return strat

    def test_thread_opens_in_the_maps_channel(self, db, group_team, discord):
        """Docstring for test_thread_opens_in_the_maps_channel."""
        strat = self._strat(db, group_team.id, "de_inferno")
        _run(db, "strat_upsert", {"strat_id": strat.id})
        assert discord.threads == {"thread-1": "c-inferno"}
        db.refresh(strat)
        assert strat.discord_thread_id == "thread-1"
        assert discord.messages[0][0] == "thread-1"
        assert discord.messages[0][1]["embeds"][0]["title"] == "Exec de_inferno"

    def test_a_cache_miss_refreshes_once_then_finds_the_channel(self, db, team, discord):
        """A strat made on the web for a map nobody ran a command in yet."""
        db.add(TeamDiscordLink(team_id=team.id, guild_id=GUILD, channel_id="c-general", category_id=CATEGORY, bound_by="d1"))
        db.commit()
        strat = self._strat(db, team.id, "de_dust2")
        _run(db, "strat_upsert", {"strat_id": strat.id})
        assert discord.paths("GET") == [f"/guilds/{GUILD}/channels"]
        assert discord.threads == {"thread-1": "c-dust2"}

    def test_a_map_without_a_channel_falls_back_to_the_bind_channel(self, db, group_team, discord):
        """Docstring for test_a_map_without_a_channel_falls_back_to_the_bind_channel."""
        strat = self._strat(db, group_team.id, "de_nuke")
        _run(db, "strat_upsert", {"strat_id": strat.id})
        assert discord.threads == {"thread-1": "c-general"}

    def test_single_channel_mode_never_lists_channels(self, db, team, discord):
        """Docstring for test_single_channel_mode_never_lists_channels."""
        db.add(TeamDiscordLink(team_id=team.id, guild_id=GUILD, channel_id="c-lobby", category_id=None, bound_by="d1"))
        db.commit()
        strat = self._strat(db, team.id, "de_mirage")
        _run(db, "strat_upsert", {"strat_id": strat.id})
        assert discord.paths("GET") == []
        assert discord.threads == {"thread-1": "c-lobby"}

    def test_an_existing_thread_is_reused_whatever_the_mapping_says(self, db, group_team, discord):
        """Docstring for test_an_existing_thread_is_reused_whatever_the_mapping_says."""
        strat = self._strat(db, group_team.id, "de_mirage")
        strat.discord_thread_id = "old-thread"
        db.commit()
        _run(db, "strat_upsert", {"strat_id": strat.id})
        assert discord.threads == {}
        assert discord.messages[0][0] == "old-thread"


class TestReviewPutsTheButtonInTheThread:
    """Submitting for review is a status change, so the status job is what
    must post the Approve button."""

    def _in_thread(self, db, team_id: str) -> Strat:
        """Docstring for _in_thread."""
        strat = create_strat(db, team_id=team_id, title="A exec", map_name="de_mirage", side="T",
                             buy_type="full_buy", canvas={}, description="", utility=None, author_id="u1")
        strat.discord_thread_id = "t-1"
        db.commit()
        return strat

    def test_in_review_posts_line_then_embed_with_button(self, db, group_team, discord):
        """Docstring for test_in_review_posts_line_then_embed_with_button."""
        strat = self._in_thread(db, group_team.id)
        transition(db, strat, StratStatus.IN_REVIEW, actor="u1")
        db.commit()
        _run(db, "strat_status", {"strat_id": strat.id, "status": "IN_REVIEW", "actor": "u1"})
        assert [m[0] for m in discord.messages] == ["t-1", "t-1"]
        assert "IN_REVIEW" in discord.messages[0][1]["content"]
        button = discord.messages[1][1]["components"][0]["components"][0]
        assert button["custom_id"] == f"strat_approve:{strat.id}"

    def test_other_statuses_post_only_the_line(self, db, group_team, discord):
        """Docstring for test_other_statuses_post_only_the_line."""
        strat = self._in_thread(db, group_team.id)
        transition(db, strat, StratStatus.ARCHIVED, actor="u1")
        db.commit()
        _run(db, "strat_status", {"strat_id": strat.id, "status": "ARCHIVED", "actor": "u1"})
        assert len(discord.messages) == 1 and "components" not in discord.messages[0][1]


class TestTeamDiscordRoutes:
    """Docstring for TestTeamDiscordRoutes."""

    def test_status_of_an_unbound_team(self, db, team, monkeypatch):
        """Docstring for test_status_of_an_unbound_team."""
        monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)
        body = client.get(f"/api/teams/{team.id}/discord", params={"user_id": "member-1"}).json()
        assert body["bound"] is False and body["channels"] == []
        assert body["configured"] is False
        assert body["settings"] == {"public_key": False, "bot_token": False, "bind_secret": True}

    def test_status_of_a_bound_group(self, db, group_team, monkeypatch):
        """Docstring for test_status_of_a_bound_group."""
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "x")
        monkeypatch.setenv("DISCORD_PUBLIC_KEY", "ab" * 32)
        body = client.get(f"/api/teams/{group_team.id}/discord", params={"user_id": OWNER}).json()
        assert body["configured"] is True and body["bound"] is True
        assert (body["guild_id"], body["category_id"], body["fallback_channel_id"]) == (GUILD, CATEGORY, "c-general")
        assert [(c["name"], c["map_name"]) for c in body["channels"]] == [
            ("mirage", "de_mirage"), ("de-inferno", "de_inferno"), ("🟧│dust-2", "de_dust2"),
        ]

    def test_status_is_members_only(self, db, team):
        """Docstring for test_status_is_members_only."""
        assert client.get(f"/api/teams/{team.id}/discord", params={"user_id": "stranger"}).status_code == 403

    def test_bind_code_is_captain_only_and_verifies(self, db, team):
        """Docstring for test_bind_code_is_captain_only_and_verifies."""
        assert client.post(f"/api/teams/{team.id}/discord/bind-code", params={"user_id": "member-1"}).status_code == 403
        r = client.post(f"/api/teams/{team.id}/discord/bind-code", params={"user_id": OWNER})
        assert r.status_code == 200
        assert r.json()["code"] == make_bind_code(team.id)

    def test_bind_code_is_503_without_the_secret(self, db, team, monkeypatch):
        """Docstring for test_bind_code_is_503_without_the_secret."""
        monkeypatch.delenv("DISCORD_WEBHOOK_SECRET", raising=False)
        assert client.post(f"/api/teams/{team.id}/discord/bind-code", params={"user_id": OWNER}).status_code == 503

    def test_unbind_removes_link_and_channel_cache(self, db, group_team):
        """Docstring for test_unbind_removes_link_and_channel_cache."""
        assert client.delete(f"/api/teams/{group_team.id}/discord", params={"user_id": "member-1"}).status_code == 403
        r = client.delete(f"/api/teams/{group_team.id}/discord", params={"user_id": OWNER})
        assert r.json() == {"status": "unbound"}
        db.expire_all()
        assert db.get(TeamDiscordLink, group_team.id) is None
        assert db.query(TeamDiscordChannel).count() == 0
        # The server can now be bound again, e.g. to a different group.
        r = client.post(URL, json=command("bind", {"code": make_bind_code(group_team.id)}, channel=channel_obj("c-inferno")))
        assert "channel group" in _content(r)


class TestIngestionWebhookFailsClosed:
    """POST /api/discord/webhook writes into a team's knowledge base and spends
    Gemini calls, so it must not be reachable without the shared secret."""

    def test_no_secret_outside_local_mode_is_401(self, monkeypatch):
        """Docstring for test_no_secret_outside_local_mode_is_401."""
        monkeypatch.setenv("LOCAL_MODE", "false")
        monkeypatch.delenv("DISCORD_WEBHOOK_SECRET", raising=False)
        r = client.post("/api/discord/webhook", params={"team_id": "t"}, json={"content": "rush b"})
        assert r.status_code == 401

    def test_unsigned_or_wrongly_signed_is_401(self, monkeypatch):
        """Docstring for test_unsigned_or_wrongly_signed_is_401."""
        monkeypatch.setenv("LOCAL_MODE", "false")
        assert client.post("/api/discord/webhook", params={"team_id": "t"}, json={"content": "x"}).status_code == 401
        r = client.post("/api/discord/webhook", params={"team_id": "t"}, json={"content": "x"},
                        headers={"X-Webhook-Signature": "00" * 32})
        assert r.status_code == 401

    def test_a_valid_signature_reaches_the_handler(self, monkeypatch):
        """Docstring for test_a_valid_signature_reaches_the_handler."""
        monkeypatch.setenv("LOCAL_MODE", "false")
        body = json.dumps({"content": ""}).encode()
        sig = hmac.new(b"test-bind-secret", body, hashlib.sha256).hexdigest()
        r = client.post("/api/discord/webhook", params={"team_id": "t"}, content=body,
                        headers={"X-Webhook-Signature": sig, "Content-Type": "application/json"})
        assert r.status_code == 200
        assert r.json() == {"status": "ignored", "reason": "No text content"}
