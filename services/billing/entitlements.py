"""
Entitlement matrix, resolution, caching, and payload redaction.
================================================================
Three tiers (module 4):

    FREE      basic self-demo stats, high-level scorecards, public pro-strats
    SOLO_PRO  + deep individual coaching (drills, tick references, heatmaps)
    TEAM      + team macro analysis, opposition research, stratbook + Discord

Authority order: subscriptions table (written by the Stripe webhook fan-out)
→ x-user-plan header (Clerk display cache, transition path) → FREE.

No Stripe call ever happens on a request path. Entitlements are resolved
from Postgres and memoized in a short in-process TTL cache that the webhook
sync endpoint invalidates. (The constraint's Redis suggestion is deliberately
not taken: a second stateful service isn't warranted at this scale — the TTL
bounds cross-instance staleness to seconds, and the DB row is the truth.)

Team seats: members of a team whose OWNER holds the TEAM tier inherit the
team-scoped entitlements (team analysis, scouting, stratbook) for that
team's resources — personal deep coaching is not inherited.

Redaction: paywalled content is OMITTED server-side, never client-filtered.
Full reports are always cached; gating happens at read time, so an expired
subscription mid-analysis simply changes what the next read returns.
"""

import copy
from datetime import UTC, datetime, timedelta
import enum
import logging
import os
import threading
import time
from typing import Any

from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)

_SEVERITY_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}

UPGRADE_CTA = (
    "Upgrade to unlock every finding: round-by-round breakdowns with tick "
    "references, pro benchmarks, and step-by-step corrective drills."
)

_LOCKED_SECTION = "### Locked\nUpgrade to unlock this section of the report."

GRACE_DAYS = 7


class Tier(str, enum.Enum):
    """Docstring for Tier."""
    FREE = "FREE"
    SOLO_PRO = "SOLO_PRO"
    TEAM = "TEAM"


class Entitlement(str, enum.Enum):
    """Docstring for Entitlement."""
    BASIC_ANALYSIS = "basic_analysis"
    FULL_COACHING = "full_coaching"
    TEAM_ANALYSIS = "team_analysis"
    TEAM_SCOUTING = "team_scouting"
    STRATBOOK_SYNC = "stratbook_sync"


TIER_ENTITLEMENTS: dict[Tier, frozenset[Entitlement]] = {
    Tier.FREE: frozenset({Entitlement.BASIC_ANALYSIS}),
    Tier.SOLO_PRO: frozenset({Entitlement.BASIC_ANALYSIS, Entitlement.FULL_COACHING}),
    Tier.TEAM: frozenset(
        {
            Entitlement.BASIC_ANALYSIS,
            Entitlement.FULL_COACHING,
            Entitlement.TEAM_ANALYSIS,
            Entitlement.TEAM_SCOUTING,
            Entitlement.STRATBOOK_SYNC,
        }
    ),
}

# Team-scoped entitlements members inherit from a TEAM-tier owner.
TEAM_SCOPED = frozenset(
    {Entitlement.TEAM_ANALYSIS, Entitlement.TEAM_SCOUTING, Entitlement.STRATBOOK_SYNC}
)

PLAN_TIER: dict[str, Tier] = {
    "free": Tier.FREE,
    "basic": Tier.SOLO_PRO,
    "solo_pro": Tier.SOLO_PRO,
    "pro": Tier.TEAM,
    "team": Tier.TEAM,
    "premium": Tier.SOLO_PRO,
}

# Which tier unlocks each entitlement — for upgrade metadata in teasers/402s.
TIER_NEEDED: dict[Entitlement, Tier] = {
    Entitlement.BASIC_ANALYSIS: Tier.FREE,
    Entitlement.FULL_COACHING: Tier.SOLO_PRO,
    Entitlement.TEAM_ANALYSIS: Tier.TEAM,
    Entitlement.TEAM_SCOUTING: Tier.TEAM,
    Entitlement.STRATBOOK_SYNC: Tier.TEAM,
}


def resolve_tier(plan: str | None) -> Tier:
    """Map a plan string onto a tier (header/display-cache path)."""
    return PLAN_TIER.get((plan or "").lower(), Tier.FREE)


# ---------------------------------------------------------------------------
# Subscription state → tier (grace-period logic)
# ---------------------------------------------------------------------------


def tier_from_subscription(sub, now: datetime | None = None) -> Tier | None:
    """
    None when no row exists (caller falls back to the plan header).
    active/trialing → plan tier; past_due keeps the tier until grace_until;
    canceled keeps it until current_period_end (Stripe cancels at period end).
    """
    if sub is None:
        return None
    now = now or datetime.now(UTC).replace(tzinfo=None)
    tier = PLAN_TIER.get((sub.plan or "").lower(), Tier.FREE)
    if tier is Tier.FREE:
        return Tier.FREE
    status = (sub.status or "").lower()
    if status in ("active", "trialing"):
        return tier
    if status == "past_due" and sub.grace_until and now <= sub.grace_until:
        return tier
    if status == "canceled" and sub.current_period_end and now <= sub.current_period_end:
        return tier
    return Tier.FREE


def grace_deadline(period_end: datetime | None) -> datetime | None:
    """Docstring for grace_deadline."""
    if period_end is None:
        return None
    return period_end + timedelta(days=GRACE_DAYS)


# ---------------------------------------------------------------------------
# Cached resolution (invalidated by the webhook sync endpoint)
# ---------------------------------------------------------------------------

_CACHE_TTL_SECONDS = float(os.environ.get("ENTITLEMENT_CACHE_TTL", "60"))
_cache: dict[str, tuple[float, Tier]] = {}
_cache_lock = threading.Lock()


def invalidate_user(user_id: str) -> None:
    """Called by the billing sync path on every webhook event."""
    with _cache_lock:
        _cache.pop(user_id, None)


def _clear_cache() -> None:
    """Test hook."""
    with _cache_lock:
        _cache.clear()


def resolve_user_tier(db, user_id: str | None, plan_header: str | None) -> Tier:
    """DB-first tier resolution with the TTL cache; header fallback."""
    if not user_id:
        return resolve_tier(plan_header)
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(user_id)
        if hit and now - hit[0] < _CACHE_TTL_SECONDS:
            return hit[1]

    from db.models import Subscription  # noqa: PLC0415

    tier: Tier | None = None
    try:
        sub = db.get(Subscription, user_id)
        tier = tier_from_subscription(sub)
    except Exception as e:
        logger.warning(f"Subscription lookup failed for {user_id}: {e}")
    if tier is None:
        tier = resolve_tier(plan_header)
    with _cache_lock:
        _cache[user_id] = (now, tier)
    return tier


def effective_entitlements(
    db, user_id: str | None, plan_header: str | None, team_id: str | None = None
) -> set[Entitlement]:
    """The user's entitlements, including team-seat inheritance for team_id."""
    ents = set(TIER_ENTITLEMENTS[resolve_user_tier(db, user_id, plan_header)])
    if team_id and user_id and TEAM_SCOPED - ents:
        try:
            from sqlalchemy import text  # noqa: PLC0415

            from db.models import Team  # noqa: PLC0415

            member = db.execute(
                text("SELECT 1 FROM team_members WHERE team_id = :t AND user_id = :u"),
                {"t": team_id, "u": user_id},
            ).fetchone()
            team = db.get(Team, team_id)
            if member and team and team.owner_user_id != user_id:
                owner_tier = resolve_user_tier(db, team.owner_user_id, None)
                if owner_tier is Tier.TEAM:
                    ents |= TEAM_SCOPED
        except Exception as e:
            logger.warning(f"Team-seat resolution failed for {user_id}/{team_id}: {e}")
    return ents


# ---------------------------------------------------------------------------
# Reusable gating middleware
# ---------------------------------------------------------------------------


def upgrade_metadata(ent: Entitlement) -> dict[str, Any]:
    """Docstring for upgrade_metadata."""
    return {
        "locked": True,
        "tier_needed": TIER_NEEDED[ent].value,
        "upgrade_cta": UPGRADE_CTA,
    }


def require_entitlement(ent: Entitlement):
    """
    FastAPI dependency factory for hard gates: 402 with upgrade metadata
    when the caller lacks the entitlement. Reads user_id (query) and the
    trusted x-user-plan header; uses the route's DB session via request
    state-free lookup (SessionLocal) to stay drop-in on existing routes.
    """

    def _dependency(request: Request, user_id: str | None = None):
        from db.database import SessionLocal  # noqa: PLC0415

        plan_header = request.headers.get("x-user-plan")
        team_id = request.query_params.get("team_id")
        with SessionLocal() as db:
            ents = effective_entitlements(db, user_id, plan_header, team_id)
        if ent not in ents:
            raise HTTPException(status_code=402, detail=upgrade_metadata(ent))
        return ents

    return _dependency


# ---------------------------------------------------------------------------
# Redaction / teaser layer (server-side omission, never client filtering)
# ---------------------------------------------------------------------------


def build_teaser(coaching: dict[str, Any], ent: Entitlement) -> dict[str, Any]:
    """
    High-level teaser for TEAM/OPPO reports requested without the tier:
    mode + grade + a category histogram of the findings — tactical specifics
    (observations, rounds, ticks, drills, benchmarks) are masked entirely.
    """
    v2 = coaching.get("report_v2") or {}
    findings = v2.get("key_findings") or []
    histogram: dict[str, int] = {}
    for f in findings:
        cat = f.get("category") or "OTHER"
        histogram[cat] = histogram.get(cat, 0) + 1
    return {
        "report_v2": {
            "mode": v2.get("mode"),
            "summary": {"grade": (v2.get("summary") or {}).get("grade")},
            "finding_categories": histogram,
            "key_findings": [],
            "paywalled_preview": {
                "hidden_insights_count": len(findings),
                **upgrade_metadata(ent),
            },
        },
        "individual_report": _LOCKED_SECTION,
        "team_report": _LOCKED_SECTION,
        "player_reports": {},
        "strat_card": _LOCKED_SECTION,
        "coach_report": _LOCKED_SECTION,
        "findings": [],
        "summary": "",
        "paywalled_preview": {
            "hidden_insights_count": len(findings),
            **upgrade_metadata(ent),
        },
    }


def _redact_report_v2(report: dict[str, Any]) -> dict[str, Any]:
    """FREE view of a personal report: score, grade, headline, one broad
    takeaway — drills/ticks/benchmarks omitted."""
    findings = report.get("key_findings") or []
    ranked = sorted(
        findings, key=lambda f: _SEVERITY_ORDER.get((f.get("severity") or "").upper(), 3)
    )
    takeaway = None
    if ranked:
        top = ranked[0]
        takeaway = {
            "round": top.get("round"),
            "category": top.get("category"),
            "severity": top.get("severity"),
            "observation": top.get("observation"),
        }
    return {
        "mode": report.get("mode"),
        "summary": report.get("summary"),
        "key_findings": [takeaway] if takeaway else [],
        "paywalled_preview": {
            "hidden_insights_count": max(0, len(findings) - (1 if takeaway else 0)),
            "upgrade_cta": UPGRADE_CTA,
        },
    }


def redact_coaching_payload(
    coaching: dict[str, Any], ents: set[Entitlement], mode: str | None = None
) -> dict[str, Any]:
    """
    Apply entitlements to a cached coaching payload:
    - OPPOSITION_RESEARCH report without TEAM_SCOUTING → teaser
    - TEAM_ANALYSIS report without TEAM_ANALYSIS → teaser
    - personal report with FULL_COACHING → full; without → FREE redaction
    """
    mode = mode or ((coaching.get("report_v2") or {}).get("mode"))
    if mode == "OPPOSITION_RESEARCH" and Entitlement.TEAM_SCOUTING not in ents:
        return build_teaser(coaching, Entitlement.TEAM_SCOUTING)
    if mode == "TEAM_ANALYSIS" and Entitlement.TEAM_ANALYSIS not in ents:
        return build_teaser(coaching, Entitlement.TEAM_ANALYSIS)

    if Entitlement.FULL_COACHING in ents:
        out = dict(coaching)
        if isinstance(out.get("report_v2"), dict):
            out["report_v2"] = {**out["report_v2"], "paywalled_preview": None}
        return out

    out = copy.deepcopy(coaching)
    hidden = len(out.get("findings") or [])
    if isinstance(out.get("report_v2"), dict):
        out["report_v2"] = _redact_report_v2(out["report_v2"])
        hidden = out["report_v2"]["paywalled_preview"]["hidden_insights_count"]
    summary = out.get("summary") or ""
    free_summary_md = f"### Match Summary\n{summary}".rstrip()
    out["individual_report"] = free_summary_md
    out["team_report"] = _LOCKED_SECTION
    out["player_reports"] = {}
    out["strat_card"] = _LOCKED_SECTION
    out["coach_report"] = free_summary_md
    out["findings"] = []
    out["paywalled_preview"] = {
        "hidden_insights_count": hidden,
        "upgrade_cta": UPGRADE_CTA,
    }
    return out
