"""
`/strat ingest`: read a channel's history since the last ingest and save the
strategies it describes. Discord REST and Gemini are faked; the cursor, the
paging, the saved rows and the replies are real.
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
    SyncOutbox,
    Team,
    TeamDiscordChannel,
    TeamDiscordIngestCursor,
    TeamDiscordLink,
    TeamMember,
)
from db.outbox import claim_next, complete
from services.discord_bot import ingest, sync
from services.discord_bot.channels import store_category_channels
from tests.discord_fakes import CATEGORY, GUILD, GUILD_CHANNELS, FakeDiscord, channel_obj, command

client = TestClient(app)
URL = "/api/discord/interactions"
OWNER = "owner-1"

CHAT = [
    "gl hf tonight",
    "for the A exec: smoke CT and jungle, flash over top con, molly ticket",
    "yeah and connector player holds for the retake",
    {"content": "Status changed to ACTIVE", "author": {"id": "bot", "username": "DemoSage", "bot": True}},
    "who's bringing the drinks",
    "B default: 2 apps, 1 mid, 2 ramp; smoke bench + flash market on the call",
]


@pytest.fixture(autouse=True)
def env(monkeypatch):
    """Docstring for env."""
    monkeypatch.setenv("LOCAL_MODE", "true")
    monkeypatch.delenv("DISCORD_PUBLIC_KEY", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_SECRET", "test-bind-secret")
    monkeypatch.setenv("GEMINI_API_KEY", "fake-key-so-ingest-runs")


@pytest.fixture()
def db():
    """Docstring for db."""
    Base.metadata.create_all(engine)
    session = SessionLocal()
    # Other modules leave team_strategy rows behind; start clean, end clean.
    session.query(KnowledgeEmbedding).delete()
    session.query(SyncOutbox).delete()
    session.commit()
    yield session
    session.rollback()
    for model in (SyncOutbox, KnowledgeEmbedding, TeamDiscordIngestCursor, TeamDiscordChannel, TeamDiscordLink, TeamMember, Team):
        session.query(model).delete()
    session.commit()
    session.close()


@pytest.fixture()
def team(db):
    """Team bound to the Maps group, channels mapped."""
    team = Team(id=str(uuid.uuid4()), name="Night Shift", owner_user_id=OWNER, invite_code=uuid.uuid4().hex[:8])
    db.add(team)
    db.add(TeamMember(team_id=team.id, user_id=OWNER, role="owner"))
    link = TeamDiscordLink(team_id=team.id, guild_id=GUILD, channel_id="c-general", category_id=CATEGORY, bound_by="d1")
    db.add(link)
    db.flush()
    store_category_channels(db, link, GUILD_CHANNELS)
    db.commit()
    return team


@pytest.fixture()
def discord(monkeypatch):
    """Docstring for discord."""
    fake = FakeDiscord()
    monkeypatch.setattr(sync, "_discord_request", fake)
    return fake


@pytest.fixture()
def gemini(monkeypatch):
    """Deterministic stand-in for Gemini: one strategy per 'smoke' mention,
    titled after the line, so the test can see which messages were read."""
    calls: list[tuple[str, str | None]] = []

    def fake_extract(conversation: str, map_name: str | None, team_id: str) -> list[dict]:
        calls.append((conversation, map_name))
        found = []
        for line in conversation.splitlines():
            if "smoke" in line:
                text = line.split(": ", 1)[1]
                found.append({"title": text[:40], "map_name": map_name or "", "side": "T", "summary": text, "steps": [text]})
        return found

    monkeypatch.setattr(ingest, "extract_strategies", fake_extract)
    monkeypatch.setattr(ingest, "embed", lambda text: [0.0] * 768)
    return calls


def drain(db) -> list[str]:
    """Docstring for drain."""
    kinds = []
    while (item := claim_next(db, "w")) is not None:
        sync.process_outbox_item(db, item)
        complete(db, item)
        kinds.append(item.kind)
    return kinds


def _ingest(db, team, channel_id="c-mirage", **extra) -> list[str]:
    """Run /strat ingest in a channel and drain the worker."""
    r = client.post(URL, json=command("ingest", channel=channel_obj(channel_id)))
    assert r.status_code == 200, r.text
    return drain(db)


def _replies(discord: FakeDiscord) -> list[str]:
    """Docstring for _replies."""
    return [body["content"] for _, body in discord.messages if "content" in body]


class TestReadingTheChannel:
    """Docstring for TestReadingTheChannel."""

    def test_is_human_message(self):
        """Docstring for test_is_human_message."""
        assert ingest.is_human_message({"type": 0, "content": "hi", "author": {}})
        assert ingest.is_human_message({"type": 19, "content": "reply", "author": {}})
        assert not ingest.is_human_message({"type": 0, "content": "", "author": {}})
        assert not ingest.is_human_message({"type": 0, "content": "x", "author": {"bot": True}})
        assert not ingest.is_human_message({"type": 0, "content": "x", "author": {}, "webhook_id": "w"})
        assert not ingest.is_human_message({"type": 7, "content": "joined", "author": {}})  # system

    def test_pages_come_back_oldest_first(self, discord):
        """Docstring for test_pages_come_back_oldest_first."""
        discord.seed_history("c-mirage", ["a", "b", "c"])
        assert [m["content"] for m in ingest.fetch_page(discord, "c-mirage", None)] == ["a", "b", "c"]
        assert [m["content"] for m in ingest.fetch_page(discord, "c-mirage", "2")] == ["c"]

    def test_chunks_respect_the_size_limit(self):
        """Docstring for test_chunks_respect_the_size_limit."""
        msgs = [{"content": "x" * 100} for _ in range(10)]
        chunks = ingest.chunk(msgs, max_chars=300)
        assert [len(c) for c in chunks] == [2, 2, 2, 2, 2]
        assert ingest.chunk([], max_chars=300) == []

    def test_render_names_the_speaker(self):
        """Docstring for test_render_names_the_speaker."""
        text = ingest.render([{"content": "rush b", "author": {"username": "igl"}, "timestamp": "2026-10-01T18:05:00.0Z"}])
        assert text == "[2026-10-01 18:05] igl: rush b"


class TestFirstAndFollowingRuns:
    """Docstring for TestFirstAndFollowingRuns."""

    def test_first_run_reads_from_the_beginning_and_saves_strategies(self, db, team, discord, gemini):
        """Docstring for test_first_run_reads_from_the_beginning_and_saves_strategies."""
        discord.seed_history("c-mirage", CHAT)
        assert _ingest(db, team) == ["channel_ingest", "discord_reply"]

        rows = db.query(KnowledgeEmbedding).all()
        assert [json.loads(r.metadata_json)["title"][:12] for r in rows] == ["for the A ex", "B default: 2"]
        meta = json.loads(rows[0].metadata_json)
        assert meta["team_id"] == team.id and meta["map_name"] == "de_mirage" and meta["source_channel"] == "mirage"
        assert meta["author"] == "#mirage via igl"
        # The bot's own line was never shown to Gemini; the map came from the channel.
        assert all("DemoSage" not in conv for conv, _ in gemini) and gemini[0][1] == "de_mirage"

        cursor = db.get(TeamDiscordIngestCursor, "c-mirage")
        assert (cursor.last_message_id, cursor.messages_read, cursor.strategies_saved) == ("6", 5, 2)
        reply = _replies(discord)[-1]
        assert reply.startswith("Read 5 messages from #mirage, saved 2 strategies") and "- B default" in reply

    def test_second_run_reads_only_what_is_new(self, db, team, discord, gemini):
        """Docstring for test_second_run_reads_only_what_is_new."""
        discord.seed_history("c-mirage", CHAT)
        _ingest(db, team)
        discord.seed_history("c-mirage", ["new idea: smoke window and go A through palace"])
        _ingest(db, team)
        assert db.query(KnowledgeEmbedding).count() == 3
        assert db.get(TeamDiscordIngestCursor, "c-mirage").last_message_id == "7"
        assert _replies(discord)[-1].startswith("Read 1 messages from #mirage, saved 1 strategy")

    def test_nothing_new_says_so(self, db, team, discord, gemini):
        """Docstring for test_nothing_new_says_so."""
        discord.seed_history("c-mirage", CHAT)
        _ingest(db, team)
        _ingest(db, team)
        assert _replies(discord)[-1] == "Nothing new in #mirage since the last ingest."
        assert db.query(KnowledgeEmbedding).count() == 2

    def test_the_web_lists_what_was_ingested(self, db, team, discord, gemini):
        """The rows land where the Team Hub's "Ingested from Discord" list reads."""
        discord.seed_history("c-inferno", ["banana: smoke car + coffins, molly sandbags"])
        _ingest(db, team, "c-inferno")
        listed = client.get(f"/api/teams/{team.id}/strategies").json()
        assert [(s["map_name"], s["author"]) for s in listed] == [("de_inferno", "#de-inferno via igl")]

    def test_a_channel_outside_the_group_ingests_without_a_map(self, db, team, discord, gemini):
        """Docstring for test_a_channel_outside_the_group_ingests_without_a_map."""
        discord.seed_history("c-general", ["pistol round: smoke mid, all B"])
        _ingest(db, team, "c-general")
        assert gemini[0][1] is None
        assert json.loads(db.query(KnowledgeEmbedding).one().metadata_json)["map_name"] == "All Maps"


class TestLongChannels:
    """Docstring for TestLongChannels."""

    def test_a_long_channel_is_read_in_runs_that_chain_themselves(self, db, team, discord, gemini):
        """Docstring for test_a_long_channel_is_read_in_runs_that_chain_themselves."""
        total = ingest.PAGE_SIZE * ingest.PAGE_LIMIT + 30
        discord.seed_history("c-mirage", [f"msg {i}" + (" smoke" if i % 100 == 0 else "") for i in range(total)])
        kinds = _ingest(db, team)
        # First run: PAGE_LIMIT pages, a continuation, a progress reply; the
        # continuation then finishes the channel and replies again.
        assert kinds == ["channel_ingest", "channel_ingest", "discord_reply", "discord_reply"]
        cursor = db.get(TeamDiscordIngestCursor, "c-mirage")
        assert cursor.last_message_id == str(total) and cursor.messages_read == total
        replies = _replies(discord)
        assert "still reading" in replies[0] and replies[1].startswith("Read 30 messages")
        assert db.query(KnowledgeEmbedding).count() == 7

    def test_a_failure_mid_run_keeps_the_pages_already_saved(self, db, team, discord, gemini, monkeypatch):
        """Docstring for test_a_failure_mid_run_keeps_the_pages_already_saved."""
        discord.seed_history("c-mirage", [f"line {i} smoke" if i in (5, 150) else f"line {i}" for i in range(1, 161)])
        original = ingest.extract_strategies
        pages_seen = {"n": 0}

        def flaky(conversation, map_name, team_id):
            pages_seen["n"] += 1
            if pages_seen["n"] == 2:
                raise RuntimeError("Gemini 503")
            return original(conversation, map_name, team_id)

        monkeypatch.setattr(ingest, "extract_strategies", flaky)
        client.post(URL, json=command("ingest", channel=channel_obj("c-mirage")))
        item = claim_next(db, "w")
        with pytest.raises(RuntimeError):
            sync.process_outbox_item(db, item)
        # Page 1 was committed before page 2 failed.
        assert db.get(TeamDiscordIngestCursor, "c-mirage").last_message_id == "100"
        assert db.query(KnowledgeEmbedding).count() == 1

        # The requeued item resumes at page 2; page 1 is not read or saved again.
        from db.outbox import fail

        fail(db, item, "Gemini 503")
        assert drain(db) == ["channel_ingest", "discord_reply"]
        assert db.query(KnowledgeEmbedding).count() == 2
        assert discord.paths("GET").count("/channels/c-mirage/messages?limit=100&after=0") == 1


class TestGuards:
    """Docstring for TestGuards."""

    def test_without_gemini_the_channel_is_left_unread(self, db, team, discord, monkeypatch):
        """Reading without extracting would skip content forever."""
        monkeypatch.delenv("GEMINI_API_KEY")
        discord.seed_history("c-mirage", CHAT)
        assert _ingest(db, team) == ["channel_ingest", "discord_reply"]
        assert discord.paths("GET") == []
        assert db.get(TeamDiscordIngestCursor, "c-mirage").last_message_id is None
        assert "AI is not configured" in _replies(discord)[-1]

    def test_ingest_needs_a_text_channel_or_thread(self, db, team):
        """Docstring for test_ingest_needs_a_text_channel_or_thread."""
        r = client.post(URL, json=command("ingest", channel=channel_obj("v-nuke")))
        assert r.json()["data"]["flags"] == 64 and db.query(SyncOutbox).count() == 0

    def test_ingest_needs_a_bound_server(self, db):
        """Docstring for test_ingest_needs_a_bound_server."""
        r = client.post(URL, json=command("ingest", channel=channel_obj("c-mirage")))
        assert "isn't linked" in r.json()["data"]["content"]

    def test_the_reply_says_where_it_starts(self, db, team, discord, gemini):
        """Docstring for test_the_reply_says_where_it_starts."""
        first = client.post(URL, json=command("ingest", channel=channel_obj("c-mirage"))).json()["data"]["content"]
        assert first.startswith("Reading <#c-mirage> from the beginning as de_mirage strategies")
        drain(db)
        again = client.post(URL, json=command("ingest", channel=channel_obj("c-mirage"))).json()["data"]["content"]
        assert again.startswith("Reading <#c-mirage> since ") and "UTC" in again

    def test_outbox_rows_all_complete(self, db, team, discord, gemini):
        """Docstring for test_outbox_rows_all_complete."""
        discord.seed_history("c-mirage", CHAT)
        _ingest(db, team)
        assert db.query(SyncOutbox).filter(SyncOutbox.status != OutboxStatus.DONE).count() == 0
