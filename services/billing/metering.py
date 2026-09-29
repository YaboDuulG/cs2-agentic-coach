"""
Per-team cost metering: Gemini spend and practice-server hours.
================================================================
Two cost lines decide whether a $300 season is profitable for a given team:

    LLM     every generate_content / LangChain call records a `llm_usage` row
            (tokens + USD at the price in force at the time). Attribution comes
            from a contextvar set by the caller (`usage_context(...)`), and a
            match_id is enough: the Match row supplies team_id and user_id.
    Servers TrainingSession rows already carry started_at / ended_at; hours ×
            the configured hourly rate is the server line.

`team_metering(db, since)` joins the two per team for the admin table. Prices
and the hourly rate live in SystemConfig (db/config.py DEFAULTS) so the admin
page can correct them without a deploy. Recording never raises: a metering
failure must not fail a coaching run.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
import logging
from typing import Any, Iterator

logger = logging.getLogger(__name__)

# Price per 1M tokens, USD. Overridable in SystemConfig (keys below).
PRICE_KEYS = {
    "flash": ("llm_price_flash_in", "llm_price_flash_out"),
    "pro": ("llm_price_pro_in", "llm_price_pro_out"),
}
SERVER_HOURLY_KEY = "server_hourly_cost_usd"


@dataclass(frozen=True)
class UsageContext:
    """Who a Gemini call is for. Any field may be None; match_id resolves the rest."""
    match_id: str | None = None
    team_id: str | None = None
    user_id: str | None = None
    purpose: str = "coach"


_context: ContextVar[UsageContext] = ContextVar("llm_usage_context", default=UsageContext())


@contextmanager
def usage_context(**fields: Any) -> Iterator[None]:
    """Attribute every Gemini call inside the block (asyncio tasks inherit it)."""
    current = _context.get()
    merged = UsageContext(**{**current.__dict__, **{k: v for k, v in fields.items() if v is not None}})
    token = _context.set(merged)
    try:
        yield
    finally:
        _context.reset(token)


def current_context() -> UsageContext:
    """Docstring for current_context."""
    return _context.get()


def _now() -> datetime:
    """Docstring for _now."""
    return datetime.now(UTC).replace(tzinfo=None)


def _float_config(key: str, default: float) -> float:
    """Docstring for _float_config."""
    try:
        from db.config import get_config  # noqa: PLC0415

        return float(get_config(key, str(default)))
    except Exception:
        return default


def model_family(model: str | None) -> str:
    """Docstring for model_family."""
    return "pro" if model and "pro" in model.lower() else "flash"


def llm_cost_usd(model: str | None, input_tokens: int, output_tokens: int) -> float:
    """USD for one call at the configured per-million prices."""
    in_key, out_key = PRICE_KEYS[model_family(model)]
    defaults = {"flash": (0.30, 2.50), "pro": (1.25, 10.00)}[model_family(model)]
    price_in = _float_config(in_key, defaults[0])
    price_out = _float_config(out_key, defaults[1])
    return round((input_tokens * price_in + output_tokens * price_out) / 1_000_000, 6)


def extract_tokens(response: Any) -> tuple[int, int, int]:
    """(input, output, cached) from a google-genai response or a LangChain message."""
    meta = getattr(response, "usage_metadata", None)
    if meta is None:
        return (0, 0, 0)
    if isinstance(meta, dict):  # LangChain AIMessage.usage_metadata
        return (
            int(meta.get("input_tokens") or 0),
            int(meta.get("output_tokens") or 0),
            int((meta.get("input_token_details") or {}).get("cache_read") or 0),
        )
    return (  # google-genai GenerateContentResponse.usage_metadata
        int(getattr(meta, "prompt_token_count", 0) or 0),
        int(getattr(meta, "candidates_token_count", 0) or 0),
        int(getattr(meta, "cached_content_token_count", 0) or 0),
    )


def record_usage(response: Any, *, model: str | None, **overrides: Any) -> float | None:
    """Write one llm_usage row for `response`. Returns the USD cost, or None if
    nothing was recorded. Never raises."""
    try:
        ctx = current_context()
        fields = {**ctx.__dict__, **{k: v for k, v in overrides.items() if v is not None}}
        input_tokens, output_tokens, cached = extract_tokens(response)
        if input_tokens == 0 and output_tokens == 0:
            return None
        cost = llm_cost_usd(model, input_tokens, output_tokens)

        from db.database import SessionLocal  # noqa: PLC0415
        from db.models import LlmUsage, Match  # noqa: PLC0415

        with SessionLocal() as db:
            team_id, user_id = fields.get("team_id"), fields.get("user_id")
            if fields.get("match_id") and (team_id is None or user_id is None):
                match = db.get(Match, fields["match_id"])
                if match is not None:
                    team_id = team_id or match.team_id
                    user_id = user_id or match.user_id
            db.add(
                LlmUsage(
                    match_id=fields.get("match_id"),
                    team_id=team_id,
                    user_id=user_id,
                    purpose=fields.get("purpose") or "coach",
                    model=model or "unknown",
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cached_tokens=cached,
                    cost_usd=cost,
                )
            )
            db.commit()
        return cost
    except Exception as e:  # metering must never break the caller
        logger.warning(f"[Metering] could not record LLM usage: {e}")
        return None


# ---------------------------------------------------------------------------
# Aggregation for the admin table
# ---------------------------------------------------------------------------


@dataclass
class TeamMetering:
    """Docstring for TeamMetering."""
    team_id: str
    name: str
    owner_user_id: str
    members: int
    season: int | None
    season_until: datetime | None
    season_active: bool
    matches: int
    llm_calls: int
    input_tokens: int
    output_tokens: int
    llm_cost_usd: float
    server_sessions: int
    server_hours: float
    server_cost_usd: float
    revenue_usd: float
    total_cost_usd: float = field(init=False)
    margin_usd: float = field(init=False)

    def __post_init__(self) -> None:
        """Docstring for __post_init__."""
        self.total_cost_usd = round(self.llm_cost_usd + self.server_cost_usd, 2)
        self.margin_usd = round(self.revenue_usd - self.total_cost_usd, 2)


def window_start(window: str, now: datetime | None = None) -> datetime | None:
    """`season` (current or most recent season start), `30d`, `90d`, or `all`."""
    now = now or _now()
    if window == "all":
        return None
    if window in ("30d", "90d"):
        return now - timedelta(days=int(window[:-1]))
    from services.billing.seasons import (  # noqa: PLC0415
        purchasable_season,
        season,
        season_for_date,
    )

    s = season_for_date(now)
    if s is None:  # off-season gap: meter the season that just ended
        s = season(purchasable_season(now).number - 1)
    return datetime(s.start.year, s.start.month, s.start.day)


def team_metering(db, window: str = "season", now: datetime | None = None) -> dict[str, Any]:
    """Docstring for team_metering."""
    from sqlalchemy import func, select  # noqa: PLC0415

    from db.models import (  # noqa: PLC0415
        LlmUsage,
        Match,
        PracticeServer,
        Subscription,
        Team,
        TeamMember,
        TrainingSession,
    )
    from services.billing.seasons import TEAM_SEASON_PRICE_USD  # noqa: PLC0415

    now = now or _now()
    since = window_start(window, now)
    hourly = _float_config(SERVER_HOURLY_KEY, 0.10)

    def _since(col, stmt):
        return stmt.where(col >= since) if since is not None else stmt

    teams = db.execute(select(Team)).scalars().all()
    rows: list[TeamMetering] = []
    for team in teams:
        members = db.execute(
            select(func.count()).select_from(TeamMember).where(TeamMember.team_id == team.id)
        ).scalar_one()
        matches = db.execute(
            _since(Match.created_at, select(func.count()).select_from(Match).where(Match.team_id == team.id))
        ).scalar_one()
        llm = db.execute(
            _since(
                LlmUsage.created_at,
                select(
                    func.count(),
                    func.coalesce(func.sum(LlmUsage.input_tokens), 0),
                    func.coalesce(func.sum(LlmUsage.output_tokens), 0),
                    func.coalesce(func.sum(LlmUsage.cost_usd), 0.0),
                ).where(LlmUsage.team_id == team.id),
            )
        ).one()
        sessions = db.execute(
            _since(
                TrainingSession.started_at,
                select(TrainingSession).where(TrainingSession.team_id == team.id),
            )
        ).scalars().all()
        # LOCAL_MODE servers ("local-…") never touched DatHost; the old
        # "mock-…" fallback is gone but historical rows may still carry it.
        # Neither is a billable hour.
        server_ids = [s.server_id for s in sessions if s.server_id]
        fake_servers: set[str] = set()
        if server_ids:
            for sid, instance in db.execute(
                select(PracticeServer.id, PracticeServer.vultr_instance_id).where(
                    PracticeServer.id.in_(server_ids)
                )
            ).all():
                if instance and (instance.startswith("local-") or instance.startswith("mock-")):
                    fake_servers.add(sid)
        sessions = [s for s in sessions if s.server_id not in fake_servers]
        seconds = 0.0
        for s in sessions:
            if s.duration_seconds is not None:
                seconds += s.duration_seconds
            elif s.ended_at is None:
                seconds += max(0.0, (now - s.started_at).total_seconds())
        hours = round(seconds / 3600, 2)

        sub = db.get(Subscription, team.owner_user_id)
        season_until = sub.season_until if sub else None
        season_active = bool(season_until and now <= season_until)
        # Revenue counts once per season purchase that overlaps the window.
        revenue = float(TEAM_SEASON_PRICE_USD) if sub and sub.season and (
            season_active or (since is not None and season_until and season_until >= since)
        ) else 0.0

        rows.append(
            TeamMetering(
                team_id=team.id,
                name=team.name,
                owner_user_id=team.owner_user_id,
                members=int(members),
                season=sub.season if sub else None,
                season_until=season_until,
                season_active=season_active,
                matches=int(matches),
                llm_calls=int(llm[0]),
                input_tokens=int(llm[1]),
                output_tokens=int(llm[2]),
                llm_cost_usd=round(float(llm[3]), 4),
                server_sessions=len(sessions),
                server_hours=hours,
                server_cost_usd=round(hours * hourly, 2),
                revenue_usd=revenue,
            )
        )

    unattributed = db.execute(
        _since(
            LlmUsage.created_at,
            select(func.count(), func.coalesce(func.sum(LlmUsage.cost_usd), 0.0)).where(
                LlmUsage.team_id.is_(None)
            ),
        )
    ).one()

    rows.sort(key=lambda r: r.total_cost_usd, reverse=True)
    return {
        "window": window,
        "since": since.isoformat() if since else None,
        "server_hourly_cost_usd": hourly,
        "teams": [
            {**r.__dict__, "season_until": r.season_until.isoformat() if r.season_until else None}
            for r in rows
        ],
        "unattributed_llm": {"calls": int(unattributed[0]), "cost_usd": round(float(unattributed[1]), 4)},
        "totals": {
            "llm_cost_usd": round(sum(r.llm_cost_usd for r in rows), 2),
            "server_cost_usd": round(sum(r.server_cost_usd for r in rows), 2),
            "revenue_usd": round(sum(r.revenue_usd for r in rows), 2),
            "margin_usd": round(sum(r.margin_usd for r in rows), 2),
        },
    }
