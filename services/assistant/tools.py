"""
The assistant's tool registry: read tools over the caller's own data.
=====================================================================
Each tool is a plain function taking a `ToolContext` (db session + the
caller's user id + plan header) and a pydantic argument model. The decorator
records the name, description and JSON schema so the same list can be handed
to Gemini as function declarations or served by an MCP server.

Rules every tool follows:
  - Access is checked in the handler with the same logic the HTTP routes use
    (match ownership, team membership, entitlements). A refusal is a
    `ToolError`, which `run_tool` turns into `{"error": ..., "status": N}`
    for the model instead of raising.
  - Payloads are trimmed for a model, not a UI: ids, names, numbers and the
    report text, never raw telemetry dumps.
  - No tool calls Gemini itself; the loop pays for the model, tools are free.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any, Callable, get_type_hints

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.models import KnowledgeEmbedding, Match, Strat, StratRevision, StratStatus, Team, TeamMember
from services.billing.entitlements import (
    Entitlement,
    effective_entitlements,
    redact_coaching_payload,
    resolve_user_tier,
)


class ToolError(Exception):
    """A refusal or a miss, reported to the model as data."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class ToolContext:
    """Docstring for ToolContext."""

    db: Session
    user_id: str
    plan_header: str | None = None

    def entitlements(self, team_id: str | None = None) -> set[Entitlement]:
        """Docstring for entitlements."""
        return effective_entitlements(self.db, self.user_id, self.plan_header, team_id)


@dataclass(frozen=True)
class ToolSpec:
    """Docstring for ToolSpec."""

    name: str
    description: str
    args: type[BaseModel]
    handler: Callable[[ToolContext, BaseModel], Any]
    writes: bool = False

    def schema(self) -> dict[str, Any]:
        """Function-declaration shape: name, description, JSON-schema parameters."""
        params = self.args.model_json_schema()
        params.pop("title", None)
        for prop in params.get("properties", {}).values():
            prop.pop("title", None)
        params["additionalProperties"] = False
        return {"name": self.name, "description": self.description, "parameters": params}


REGISTRY: dict[str, ToolSpec] = {}


def tool(name: str, description: str, *, writes: bool = False):
    """Register a handler `(ctx, args) -> dict` under `name`."""

    def decorate(fn: Callable[[ToolContext, Any], Any]):
        # Annotations are strings under `from __future__ import annotations`.
        args_model = get_type_hints(fn).get("args")
        if not (isinstance(args_model, type) and issubclass(args_model, BaseModel)):
            raise TypeError(f"{name}: handler needs an `args: <BaseModel>` annotation")
        REGISTRY[name] = ToolSpec(name=name, description=description, args=args_model, handler=fn, writes=writes)
        return fn

    return decorate


def tool_schemas(*, include_writes: bool = False) -> list[dict[str, Any]]:
    """Docstring for tool_schemas."""
    return [t.schema() for t in REGISTRY.values() if include_writes or not t.writes]


def run_tool(ctx: ToolContext, name: str, raw_args: dict[str, Any] | None) -> dict[str, Any]:
    """Validate, run, and never raise: the model gets a result or an error dict."""
    spec = REGISTRY.get(name)
    if spec is None:
        return {"error": f"unknown tool {name!r}", "status": 404}
    try:
        args = spec.args.model_validate(raw_args or {})
    except Exception as exc:  # pydantic's message is the useful part
        return {"error": f"invalid arguments: {exc}", "status": 400}
    try:
        return spec.handler(ctx, args)
    except ToolError as exc:
        return {"error": exc.message, "status": exc.status}
    except Exception as exc:  # a bug must not take the whole turn down
        return {"error": f"tool failed: {type(exc).__name__}", "status": 500}


# ---------------------------------------------------------------------------
# Access helpers (same rules as the HTTP routes)
# ---------------------------------------------------------------------------


def _is_member(ctx: ToolContext, team_id: str) -> bool:
    """Docstring for _is_member."""
    return (
        ctx.db.query(TeamMember.id)
        .filter(TeamMember.team_id == team_id, TeamMember.user_id == ctx.user_id)
        .first()
        is not None
    )


def _require_member(ctx: ToolContext, team_id: str) -> None:
    """Docstring for _require_member."""
    if ctx.db.get(Team, team_id) is None:
        raise ToolError(404, "team not found")
    if not _is_member(ctx, team_id):
        raise ToolError(403, "you are not a member of this team")


def _require_entitlement(ctx: ToolContext, ent: Entitlement, team_id: str | None = None) -> None:
    """Docstring for _require_entitlement."""
    if ent not in ctx.entitlements(team_id):
        raise ToolError(402, f"this needs the {ent.value} entitlement; the user can upgrade on the pricing page")


def _accessible_match(ctx: ToolContext, match_id: str) -> Match:
    """The match if the caller owns it or belongs to its team; 404 otherwise
    (a 403 would confirm the id exists)."""
    match = ctx.db.get(Match, match_id)
    if match is None:
        raise ToolError(404, "match not found")
    if match.team_id:
        if not _is_member(ctx, match.team_id):
            raise ToolError(404, "match not found")
    elif match.user_id != ctx.user_id:
        raise ToolError(404, "match not found")
    return match


def _iso(value: Any) -> str | None:
    """Raw SQL hands back datetimes on Postgres and strings on SQLite."""
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _mode(match: Match) -> str:
    """Docstring for _mode."""
    if match.is_recon:
        return "scouting"
    return "team" if match.team_id else "personal"


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


class NoArgs(BaseModel):
    """Docstring for NoArgs."""


class ListMatchesArgs(BaseModel):
    """Docstring for ListMatchesArgs."""

    scope: str = Field("all", description="personal | team | all")
    limit: int = Field(20, ge=1, le=50)


@tool("list_my_matches", "The caller's analysed matches, newest first: id, map, mode (personal/team/scouting), status, opponent, date.")
def list_my_matches(ctx: ToolContext, args: ListMatchesArgs) -> dict[str, Any]:
    """Docstring for list_my_matches."""
    where = {
        "personal": "m.user_id = :uid AND m.team_id IS NULL",
        "team": "m.team_id IN (SELECT team_id FROM team_members WHERE user_id = :uid)",
        "all": "(m.user_id = :uid AND m.team_id IS NULL) OR m.team_id IN (SELECT team_id FROM team_members WHERE user_id = :uid)",
    }.get(args.scope)
    if where is None:
        raise ToolError(400, "scope must be personal, team or all")
    rows = ctx.db.execute(
        text(
            f"SELECT m.match_id, d.map_name, d.status, m.created_at, m.is_recon, m.team_id, m.match_name, d.total_rounds "
            f"FROM matches m JOIN demos d ON d.demo_id = m.demo_id WHERE {where} "
            f"ORDER BY m.created_at DESC LIMIT :lim"
        ),
        {"uid": ctx.user_id, "lim": args.limit},
    ).fetchall()
    return {
        "matches": [
            {
                "match_id": r[0],
                "map": r[1],
                "status": str(r[2]).lower() if r[2] else None,
                "created_at": _iso(r[3]),
                "mode": "scouting" if r[4] else ("team" if r[5] else "personal"),
                "team_id": r[5],
                "opponent": r[6] if r[4] else None,
                "rounds": r[7],
            }
            for r in rows
        ]
    }


class MatchArgs(BaseModel):
    """Docstring for MatchArgs."""

    match_id: str


@tool("get_match_summary", "Scoreline, map, mode, rounds, players and sides for one match the caller can see.")
def get_match_summary(ctx: ToolContext, args: MatchArgs) -> dict[str, Any]:
    """Docstring for get_match_summary."""
    match = _accessible_match(ctx, args.match_id)
    demo = match.demo
    stats = json.loads(demo.player_stats_json) if demo and demo.player_stats_json else {}
    rounds = ctx.db.execute(
        text("SELECT round_num, winner_side, ct_score, t_score FROM rounds WHERE demo_id = :d ORDER BY round_num"),
        {"d": match.demo_id},
    ).fetchall()
    last = rounds[-1] if rounds else None
    return {
        "match_id": match.match_id,
        "map": demo.map_name if demo else None,
        "mode": _mode(match),
        "status": str(demo.status).lower() if demo and demo.status else None,
        "opponent": match.match_name if match.is_recon else None,
        "total_rounds": len(rounds),
        "final_score": {"ct": last[2], "t": last[3]} if last else None,
        "round_winners": [{"round": r[0], "winner": r[1]} for r in rounds],
        "players": [
            {"steamid": sid, "name": p.get("name"), "starting_side": p.get("team"), "clan": p.get("clan")}
            for sid, p in stats.items()
        ],
        "uploader_steamid": match.uploader_steam_id,
    }


def _trim_findings(report: dict[str, Any]) -> list[dict[str, Any]]:
    """Docstring for _trim_findings."""
    out = []
    for f in report.get("key_findings") or []:
        if not isinstance(f, dict):
            continue
        out.append(
            {k: f.get(k) for k in ("round", "rounds", "tick", "category", "severity", "observation", "benchmark", "drill", "evidence_ids") if f.get(k) is not None}
        )
    return out


@tool("get_match_findings", "The coaching report for a match: grade, headline, summary and the findings with their rounds. Redacted to the caller's plan; a locked report says so.")
def get_match_findings(ctx: ToolContext, args: MatchArgs) -> dict[str, Any]:
    """Docstring for get_match_findings."""
    match = _accessible_match(ctx, args.match_id)
    if not match.coaching_notes:
        return {"match_id": match.match_id, "status": "pending", "message": "coaching has not finished for this match"}
    try:
        coaching = json.loads(match.coaching_notes)
    except (json.JSONDecodeError, TypeError):
        coaching = {"coach_report": match.coaching_notes}
    coaching = redact_coaching_payload(coaching, ctx.entitlements(match.team_id))
    report = coaching.get("report_v2") or {}
    locked = coaching.get("paywalled_preview") or (report.get("paywalled_preview") if isinstance(report, dict) else None)
    out: dict[str, Any] = {"match_id": match.match_id, "mode": _mode(match)}
    if isinstance(report, dict) and report:
        out["summary"] = report.get("summary")
        out["findings"] = _trim_findings(report)
    elif coaching.get("coach_report"):
        out["report_text"] = str(coaching["coach_report"])[:6000]
    if locked:
        out["locked"] = {k: locked.get(k) for k in ("hidden_insights_count", "tier_needed", "upgrade_cta") if locked.get(k) is not None}
    return out


class RoundArgs(BaseModel):
    """Docstring for RoundArgs."""

    match_id: str
    round: int = Field(ge=1, le=60)


@tool("get_round", "One round of a match: winner, scores, economy, and every kill in tick order with weapon and headshot.")
def get_round(ctx: ToolContext, args: RoundArgs) -> dict[str, Any]:
    """Docstring for get_round."""
    match = _accessible_match(ctx, args.match_id)
    row = ctx.db.execute(
        text("SELECT winner_side, reason, ct_eq_val, t_eq_val, ct_score, t_score FROM rounds WHERE demo_id = :d AND round_num = :r"),
        {"d": match.demo_id, "r": args.round},
    ).fetchone()
    if row is None:
        raise ToolError(404, f"round {args.round} is not in this match")
    kills = ctx.db.execute(
        text(
            "SELECT tick, attacker, attacker_team, victim, victim_team, weapon, headshot FROM kills "
            "WHERE demo_id = :d AND round_num = :r ORDER BY tick"
        ),
        {"d": match.demo_id, "r": args.round},
    ).fetchall()
    grenades = ctx.db.execute(
        text("SELECT tick, thrower, team, grenade_type FROM grenades WHERE demo_id = :d AND round_num = :r ORDER BY tick"),
        {"d": match.demo_id, "r": args.round},
    ).fetchall()
    tickrate = (match.demo.tickrate if match.demo else 64) or 64
    first = kills[0][0] if kills else None
    return {
        "match_id": match.match_id,
        "round": args.round,
        "winner": row[0],
        "end_reason": row[1],
        "economy": {"ct": row[2], "t": row[3]},
        "score_after": {"ct": row[4], "t": row[5]},
        "kills": [
            {"tick": k[0], "attacker": k[1], "attacker_side": k[2], "victim": k[3], "victim_side": k[4], "weapon": k[5], "headshot": bool(k[6])}
            for k in kills
        ],
        "grenades": [{"tick": g[0], "thrower": g[1], "side": g[2], "type": g[3]} for g in grenades],
        "first_kill_tick": first,
        "tickrate": tickrate,
    }


@tool("list_my_teams", "Teams the caller belongs to, with their role.")
def list_my_teams(ctx: ToolContext, args: NoArgs) -> dict[str, Any]:
    """Docstring for list_my_teams."""
    rows = (
        ctx.db.query(Team, TeamMember.role)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .filter(TeamMember.user_id == ctx.user_id)
        .all()
    )
    return {"teams": [{"team_id": t.id, "name": t.name, "role": role} for t, role in rows]}


class TeamStratsArgs(BaseModel):
    """Docstring for TeamStratsArgs."""

    team_id: str
    map_name: str | None = Field(None, description="Filter, e.g. de_mirage")


@tool("list_team_strats", "A team's stratbook entries: title, map, side, buy, status, revision count.")
def list_team_strats(ctx: ToolContext, args: TeamStratsArgs) -> dict[str, Any]:
    """Docstring for list_team_strats."""
    _require_member(ctx, args.team_id)
    q = ctx.db.query(Strat).filter(Strat.team_id == args.team_id)
    if args.map_name:
        q = q.filter(Strat.map_name == args.map_name)
    strats = q.order_by(Strat.updated_at.desc()).limit(50).all()
    return {
        "strats": [
            {
                "strat_id": s.id,
                "title": s.title,
                "map": s.map_name,
                "side": s.side,
                "buy_type": s.buy_type,
                "status": StratStatus(s.status).value,
                "revisions": len(s.revisions),
                "discord_thread": bool(s.discord_thread_id),
            }
            for s in strats
        ]
    }


class StratArgs(BaseModel):
    """Docstring for StratArgs."""

    strat_id: str


@tool("get_strat", "One strat with its current revision: description, step labels, utility list.")
def get_strat(ctx: ToolContext, args: StratArgs) -> dict[str, Any]:
    """Docstring for get_strat."""
    strat = ctx.db.get(Strat, args.strat_id)
    if strat is None:
        raise ToolError(404, "strat not found")
    if not _is_member(ctx, strat.team_id):
        raise ToolError(404, "strat not found")
    rev = ctx.db.get(StratRevision, strat.current_revision_id) if strat.current_revision_id else None
    canvas = json.loads(rev.canvas_json or "{}") if rev else {}
    utility = json.loads(rev.utility_json or "[]") if rev else []
    return {
        "strat_id": strat.id,
        "title": strat.title,
        "map": strat.map_name,
        "side": strat.side,
        "buy_type": strat.buy_type,
        "status": StratStatus(strat.status).value,
        "revision": rev.revision_no if rev else 0,
        "description": rev.description if rev else "",
        "steps": [{"t": s.get("t"), "label": s.get("label"), "players": len(s.get("positions") or {})} for s in canvas.get("steps") or []],
        "utility": [{"type": u.get("type"), "callout": u.get("callout")} for u in utility[:20]],
    }


class SearchArgs(BaseModel):
    """Docstring for SearchArgs."""

    team_id: str
    query: str = Field(min_length=1, max_length=200)
    limit: int = Field(5, ge=1, le=10)


@tool("search_team_strategies", "Search a team's written strategies (ingested from Discord or added by hand) by words in the title, summary or steps.")
def search_team_strategies(ctx: ToolContext, args: SearchArgs) -> dict[str, Any]:
    """Docstring for search_team_strategies."""
    _require_member(ctx, args.team_id)
    rows = (
        ctx.db.query(KnowledgeEmbedding)
        .filter(
            KnowledgeEmbedding.source == "team_strategy",
            KnowledgeEmbedding.metadata_json.like(f'%"team_id": "{args.team_id}"%'),
        )
        .order_by(KnowledgeEmbedding.created_at.desc())
        .limit(200)
        .all()
    )
    words = [w for w in args.query.lower().split() if len(w) > 2]
    scored = []
    for r in rows:
        meta = json.loads(r.metadata_json or "{}")
        hay = (r.content or "").lower()
        score = sum(hay.count(w) for w in words)
        if score or not words:
            scored.append((score, r.created_at or 0, meta))
    scored.sort(key=lambda x: (x[0], str(x[1])), reverse=True)
    return {
        "strategies": [
            {"title": m.get("title"), "map": m.get("map_name"), "side": m.get("side"), "summary": m.get("summary"), "steps": (m.get("steps") or [])[:8], "author": m.get("author")}
            for _, _, m in scored[: args.limit]
        ]
    }


@tool("my_plan", "The caller's plan tier and entitlements, so the assistant can say what is locked and why.")
def my_plan(ctx: ToolContext, args: NoArgs) -> dict[str, Any]:
    """Docstring for my_plan."""
    tier = resolve_user_tier(ctx.db, ctx.user_id, ctx.plan_header)
    return {"tier": tier.value, "entitlements": sorted(e.value for e in ctx.entitlements())}


__all__ = ["REGISTRY", "ToolContext", "ToolError", "run_tool", "tool_schemas"]
