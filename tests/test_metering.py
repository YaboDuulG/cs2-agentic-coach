"""Per-team metering: usage recording, pricing, attribution, aggregation."""

from datetime import datetime, timedelta
import os
from types import SimpleNamespace

import pytest

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"
os.environ.setdefault("LOCAL_MODE", "true")

from db.database import SessionLocal, engine
from db.models import (
    Base,
    Demo,
    LlmUsage,
    Match,
    Subscription,
    Team,
    TeamMember,
    TrainingSession,
)
from services.billing.metering import (
    current_context,
    extract_tokens,
    llm_cost_usd,
    record_usage,
    team_metering,
    usage_context,
    window_start,
)


def _genai_response(prompt=1000, out=200, cached=0):
    """Shape of google-genai's GenerateContentResponse.usage_metadata."""
    return SimpleNamespace(
        usage_metadata=SimpleNamespace(
            prompt_token_count=prompt, candidates_token_count=out, cached_content_token_count=cached
        )
    )


def _langchain_message(inp=500, out=50):
    """Shape of a LangChain AIMessage.usage_metadata."""
    return SimpleNamespace(usage_metadata={"input_tokens": inp, "output_tokens": out})


@pytest.fixture()
def db():
    """Other modules drop_all the shared in-memory engine in teardown, so the
    tables are (re)created per test, not at import."""
    Base.metadata.create_all(engine)
    session = SessionLocal()
    for model in (LlmUsage, TrainingSession, TeamMember, Match, Demo, Subscription, Team):
        session.query(model).delete()
    session.commit()
    yield session
    session.close()


class TestPricing:
    """Docstring for TestPricing."""

    def test_flash_and_pro_list_prices(self):
        """1M in + 1M out at the 2026-09-29 defaults."""
        assert llm_cost_usd("gemini-2.5-flash", 1_000_000, 1_000_000) == pytest.approx(2.80)
        assert llm_cost_usd("gemini-2.5-pro", 1_000_000, 1_000_000) == pytest.approx(11.25)

    def test_extract_tokens_both_shapes(self):
        """Docstring for test_extract_tokens_both_shapes."""
        assert extract_tokens(_genai_response(10, 5, 2)) == (10, 5, 2)
        assert extract_tokens(_langchain_message(7, 3)) == (7, 3, 0)
        assert extract_tokens(SimpleNamespace()) == (0, 0, 0)


class TestRecording:
    """Docstring for TestRecording."""

    def test_context_resolves_team_through_match(self, db):
        """A coaching run only knows the match; the row must still carry the team."""
        db.add(Team(id="t1", name="Squad", owner_user_id="owner", invite_code="SQUAD001"))
        db.add(Demo(demo_id="d1", map_name="de_anubis"))
        db.add(Match(match_id="m1", demo_id="d1", user_id="owner", team_id="t1"))
        db.commit()

        with usage_context(match_id="m1", purpose="coach"):
            assert current_context().match_id == "m1"
            cost = record_usage(_genai_response(1000, 200), model="gemini-2.5-flash")
        assert cost == pytest.approx(0.0008)
        row = db.query(LlmUsage).one()
        assert (row.team_id, row.user_id, row.purpose, row.model) == ("t1", "owner", "coach", "gemini-2.5-flash")
        assert (row.input_tokens, row.output_tokens) == (1000, 200)

    def test_context_is_restored_and_overrides_win(self, db):
        """Docstring for test_context_is_restored_and_overrides_win."""
        with usage_context(team_id="t9", purpose="chat"):
            record_usage(_langchain_message(), model="gemini-2.5-flash", purpose="critique")
        assert current_context().team_id is None
        row = db.query(LlmUsage).one()
        assert row.team_id == "t9" and row.purpose == "critique"

    def test_empty_usage_records_nothing_and_never_raises(self, db):
        """Docstring for test_empty_usage_records_nothing_and_never_raises."""
        assert record_usage(SimpleNamespace(), model="gemini-2.5-flash") is None
        assert record_usage(None, model=None) is None
        assert db.query(LlmUsage).count() == 0


class TestAggregation:
    """Docstring for TestAggregation."""

    def test_team_table(self, db):
        """Docstring for test_team_table."""
        now = datetime(2026, 11, 1)
        db.add(Team(id="t1", name="Alpha", owner_user_id="a", invite_code="ALPHA001"))
        db.add(Team(id="t2", name="Bravo", owner_user_id="b", invite_code="BRAVO001"))
        db.add_all([TeamMember(team_id="t1", user_id="a"), TeamMember(team_id="t1", user_id="x")])
        db.add(Subscription(user_id="a", season=59, season_until=datetime(2027, 1, 4)))
        db.add(Demo(demo_id="d1", map_name="de_anubis"))
        db.add(Match(match_id="m1", demo_id="d1", user_id="a", team_id="t1", created_at=datetime(2026, 10, 20)))
        db.add_all(
            [
                LlmUsage(team_id="t1", match_id="m1", model="gemini-2.5-pro", input_tokens=100, output_tokens=10, cost_usd=1.5, created_at=datetime(2026, 10, 20)),
                LlmUsage(team_id="t1", model="gemini-2.5-flash", input_tokens=5, output_tokens=1, cost_usd=0.5, created_at=datetime(2026, 10, 21)),
                LlmUsage(team_id="t1", model="gemini-2.5-flash", input_tokens=5, output_tokens=1, cost_usd=9.0, created_at=datetime(2026, 9, 1)),  # before S59
                LlmUsage(team_id=None, model="gemini-2.5-flash", input_tokens=5, output_tokens=1, cost_usd=0.25, created_at=datetime(2026, 10, 22)),
            ]
        )
        db.add_all(
            [
                TrainingSession(id="s1", team_id="t1", user_id="a", started_at=datetime(2026, 10, 10), ended_at=datetime(2026, 10, 10, 2), duration_seconds=7200),
                TrainingSession(id="s2", team_id="t1", user_id="a", started_at=now - timedelta(hours=1)),  # still running
            ]
        )
        db.commit()

        out = team_metering(db, "season", now=now)
        assert out["since"] == "2026-10-05T00:00:00"
        alpha = next(t for t in out["teams"] if t["team_id"] == "t1")
        assert alpha["members"] == 2 and alpha["matches"] == 1
        assert alpha["llm_calls"] == 2 and alpha["llm_cost_usd"] == pytest.approx(2.0)
        assert alpha["server_hours"] == pytest.approx(3.0)
        assert alpha["server_cost_usd"] == pytest.approx(0.30)
        assert alpha["revenue_usd"] == 300.0 and alpha["season_active"] is True
        assert alpha["margin_usd"] == pytest.approx(300 - 2.30)
        bravo = next(t for t in out["teams"] if t["team_id"] == "t2")
        assert bravo["revenue_usd"] == 0.0 and bravo["total_cost_usd"] == 0.0
        assert out["unattributed_llm"]["cost_usd"] == pytest.approx(0.25)
        assert out["totals"]["margin_usd"] == pytest.approx(297.70)

        everything = team_metering(db, "all", now=now)
        assert next(t for t in everything["teams"] if t["team_id"] == "t1")["llm_cost_usd"] == pytest.approx(11.0)

    def test_window_start(self):
        """Docstring for test_window_start."""
        assert window_start("30d", datetime(2026, 11, 1)) == datetime(2026, 10, 2)
        assert window_start("all") is None
        # Off-season gap meters the season that just ended.
        assert window_start("season", datetime(2026, 9, 29)) == datetime(2026, 7, 13)
