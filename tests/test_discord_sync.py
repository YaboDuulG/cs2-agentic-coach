"""
Outbox processor tests — services/discord_bot/sync.process_outbox_item with
Discord REST and Gemini mocked out.
"""

import json
import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from db.models import (
    Base,
    OutboxStatus,
    StratRevision,
    SyncOutbox,
    Team,
    TeamDiscordLink,
)
from db.outbox import claim_next, fail
from services.discord_bot import sync
from services.stratbook.service import create_strat, enqueue_sync

TEAM_ID = "team-sync-test-0000"
CHANNEL_ID = "chan-1"

CANVAS = {
    "steps": [
        {
            "t": 20,
            "label": "Exec",
            "positions": {"alice": {"x": 10, "y": 20}},
            "utility": [
                {"type": "smoke", "from": {"x": 1, "y": 2}, "to": {"x": 3, "y": 4},
                 "callout": "Jungle"}
            ],
        }
    ],
    "callouts": [],
}


@pytest.fixture()
def db_session():
    """Docstring for db_session."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    session.add(Team(id=TEAM_ID, name="Sync Horde", owner_user_id="u1", invite_code="SYNC1234"))
    session.add(
        TeamDiscordLink(team_id=TEAM_ID, guild_id="g-sync", channel_id=CHANNEL_ID, bound_by="d1")
    )
    session.commit()
    yield session
    session.close()


@pytest.fixture()
def rest_calls(monkeypatch):
    """Record _discord_request calls; scripted thread-create response."""
    calls: list[tuple[str, str, dict | None]] = []

    def fake_request(method, path, json_body=None):
        calls.append((method, path, json_body))
        if path.endswith("/threads"):
            return {"id": "t-123"}
        return {"id": "m-1"}

    monkeypatch.setattr(sync, "_discord_request", fake_request)
    return calls


def _make_strat(db, **overrides):
    """Docstring for _make_strat."""
    kwargs = dict(
        team_id=TEAM_ID, title="A Exec", map_name="de_mirage", side="T",
        buy_type="full_buy", canvas=CANVAS, description="Deep jungle smoke exec",
        utility=[{"type": "smoke", "callout": "Jungle"}], author_id="u1",
    )
    kwargs.update(overrides)
    strat = create_strat(db, **kwargs)
    db.commit()
    return strat


class TestStratUpsert:
    """Docstring for TestStratUpsert."""

    def test_creates_thread_saves_id_and_posts_embed(self, db_session, rest_calls):
        """Docstring for test_creates_thread_saves_id_and_posts_embed."""
        strat = _make_strat(db_session)
        item = claim_next(db_session, "w1")
        assert item is not None and item.kind == "strat_upsert"

        sync.process_outbox_item(db_session, item)

        assert strat.discord_thread_id == "t-123"
        (thread_method, thread_path, thread_body), (msg_method, msg_path, msg_body) = rest_calls
        assert (thread_method, thread_path) == ("POST", f"/channels/{CHANNEL_ID}/threads")
        assert "A Exec" in thread_body["name"]
        assert (msg_method, msg_path) == ("POST", "/channels/t-123/messages")

        embed = msg_body["embeds"][0]
        assert embed["title"] == "A Exec"
        field_values = {f["name"]: f["value"] for f in embed["fields"]}
        assert field_values["Map"] == "de_mirage"
        assert "Jungle" in field_values["Utility"]
        assert embed["description"] == "Deep jungle smoke exec"
        # DRAFT: no approve button
        assert "components" not in msg_body

    def test_reuses_existing_thread(self, db_session, rest_calls):
        """Docstring for test_reuses_existing_thread."""
        strat = _make_strat(db_session)
        strat.discord_thread_id = "t-existing"
        db_session.commit()
        item = claim_next(db_session, "w1")

        sync.process_outbox_item(db_session, item)

        assert len(rest_calls) == 1
        assert rest_calls[0][1] == "/channels/t-existing/messages"

    def test_rest_failure_raises_and_fail_requeues(self, db_session, monkeypatch):
        """Docstring for test_rest_failure_raises_and_fail_requeues."""
        def boom(method, path, json_body=None):
            raise RuntimeError("Discord API 500 on /threads: gateway error")

        monkeypatch.setattr(sync, "_discord_request", boom)
        _make_strat(db_session)
        item = claim_next(db_session, "w1")

        with pytest.raises(RuntimeError):
            sync.process_outbox_item(db_session, item)
        db_session.rollback()
        fail(db_session, item, "Discord API 500")
        assert item.status == OutboxStatus.PENDING  # attempts remain → requeued

    def test_unknown_kind_raises(self, db_session):
        """Docstring for test_unknown_kind_raises."""
        item = SyncOutbox(kind="mystery", payload_json="{}")
        db_session.add(item)
        db_session.commit()
        with pytest.raises(ValueError):
            sync.process_outbox_item(db_session, item)


class TestStratStatusAndReply:
    """Docstring for TestStratStatusAndReply."""

    def test_status_posts_new_line_to_thread(self, db_session, rest_calls):
        """Docstring for test_status_posts_new_line_to_thread."""
        strat = _make_strat(db_session)
        strat.discord_thread_id = "t-9"
        db_session.commit()
        item = SyncOutbox(
            kind="strat_status",
            payload_json=json.dumps({"strat_id": strat.id, "status": "ACTIVE", "actor": "u1"}),
        )
        db_session.add(item)
        db_session.commit()

        sync.process_outbox_item(db_session, item)
        assert rest_calls[-1][1] == "/channels/t-9/messages"
        assert "ACTIVE" in rest_calls[-1][2]["content"]

    def test_discord_reply_posts_text(self, db_session, rest_calls):
        """Docstring for test_discord_reply_posts_text."""
        item = SyncOutbox(
            kind="discord_reply",
            payload_json=json.dumps({"thread_id": "t-9", "text": "hello thread"}),
        )
        db_session.add(item)
        db_session.commit()

        sync.process_outbox_item(db_session, item)
        assert rest_calls == [("POST", "/channels/t-9/messages", {"content": "hello thread"})]


class TestAiAdapt:
    """Docstring for TestAiAdapt."""

    def _enqueue_adapt(self, db, strat, prompt="tighten the timings"):
        """Docstring for _enqueue_adapt."""
        enqueue_sync(
            db, "ai_adapt",
            {"strat_id": strat.id, "prompt": prompt, "thread_id": "t-9", "requested_by": "d1"},
        )
        db.commit()
        return (
            db.query(SyncOutbox)
            .filter(SyncOutbox.kind == "ai_adapt")
            .one()
        )

    def test_adapt_creates_ai_revision_and_enqueues_reply_and_upsert(
        self, db_session, rest_calls, monkeypatch
    ):
        """Docstring for test_adapt_creates_ai_revision_and_enqueues_reply_and_upsert."""
        monkeypatch.setenv("GEMINI_API_KEY", "fake-key-for-tests")
        monkeypatch.setattr(
            sync,
            "_gemini_adapt",
            lambda strat, revision, prompt: {
                "canvas": CANVAS,
                "description": "v2: tighter timings",
                "summary": "Moved the jungle smoke 3s earlier.",
            },
        )
        strat = _make_strat(db_session)
        strat.discord_thread_id = "t-9"
        db_session.commit()
        item = self._enqueue_adapt(db_session, strat)

        sync.process_outbox_item(db_session, item)

        revisions = (
            db_session.query(StratRevision)
            .filter(StratRevision.strat_id == strat.id)
            .order_by(StratRevision.revision_no)
            .all()
        )
        assert len(revisions) == 2
        assert revisions[-1].source == "ai"
        assert revisions[-1].description == "v2: tighter timings"
        assert strat.current_revision_id == revisions[-1].id

        pending = [
            o.kind
            for o in db_session.query(SyncOutbox)
            .filter(SyncOutbox.status == OutboxStatus.PENDING)
            .order_by(SyncOutbox.id)
            .all()
        ]
        # the original create upsert + the ai revision's upsert + the reply
        assert pending.count("strat_upsert") == 2
        assert pending.count("discord_reply") == 1
        reply = (
            db_session.query(SyncOutbox).filter(SyncOutbox.kind == "discord_reply").one()
        )
        assert "jungle smoke" in json.loads(reply.payload_json)["text"]

    def test_adapt_without_api_key_posts_apology(self, db_session, rest_calls, monkeypatch):
        """Docstring for test_adapt_without_api_key_posts_apology."""
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
        strat = _make_strat(db_session)
        item = self._enqueue_adapt(db_session, strat)

        sync.process_outbox_item(db_session, item)

        assert len(rest_calls) == 1
        assert "Sorry" in rest_calls[0][2]["content"]
        revisions = (
            db_session.query(StratRevision).filter(StratRevision.strat_id == strat.id).all()
        )
        assert len(revisions) == 1  # no ai revision was added
