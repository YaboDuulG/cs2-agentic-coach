"""
Entitlement tiers and payload redaction.
=========================================
The full coaching report is always generated and cached; gating happens at
READ time so an upgrade unlocks instantly and downgraded users never see
stale premium data. Paywalled content is OMITTED from the payload —
never sent and hidden client-side.

Tier resolution trusts the x-user-plan header only because it is set by the
Next.js server route from Clerk's server-side user record (the browser
cannot reach the FastAPI backend directly; requests carry the shared
secret). When the user_entitlements table lands (refactor plan §3), this
becomes a DB lookup and the header goes away.
"""

import copy
import enum
import logging
from typing import Any

logger = logging.getLogger(__name__)

_SEVERITY_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}

UPGRADE_CTA = (
    "Upgrade to unlock every finding: round-by-round breakdowns with tick "
    "references, pro benchmarks, and step-by-step corrective drills."
)

_LOCKED_SECTION = "### Locked\nUpgrade to unlock this section of the report."


class Tier(str, enum.Enum):
    """Docstring for Tier."""
    FREE = "FREE"
    PREMIUM = "PREMIUM"


def resolve_tier(plan: str | None) -> Tier:
    """Map the product plan (free/basic/pro) onto the two report tiers."""
    if (plan or "").lower() in ("basic", "pro", "premium", "team"):
        return Tier.PREMIUM
    return Tier.FREE


def _redact_report_v2(report: dict[str, Any]) -> dict[str, Any]:
    """FREE view: score, grade, headline, and ONE broad takeaway — the top
    finding stripped of tick, benchmark, and drill detail."""
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


def redact_coaching_payload(coaching: dict[str, Any], tier: Tier) -> dict[str, Any]:
    """Apply the tier to a cached coaching payload. PREMIUM passes through
    (with an empty paywall marker); FREE keeps the summary view only."""
    if tier is Tier.PREMIUM:
        out = dict(coaching)
        if isinstance(out.get("report_v2"), dict):
            out["report_v2"] = {**out["report_v2"], "paywalled_preview": None}
        return out

    out = copy.deepcopy(coaching)
    hidden = len(out.get("findings") or [])
    if isinstance(out.get("report_v2"), dict):
        out["report_v2"] = _redact_report_v2(out["report_v2"])
        hidden = out["report_v2"]["paywalled_preview"]["hidden_insights_count"]

    # Legacy markdown sections carry the same premium content — omit them too.
    summary = out.get("summary") or ""
    free_summary_md = f"### Match Summary\n{summary}".rstrip()
    out["individual_report"] = free_summary_md
    out["team_report"] = _LOCKED_SECTION
    out["player_reports"] = {}
    out["strat_card"] = _LOCKED_SECTION
    out["coach_report"] = free_summary_md
    out["findings"] = (out.get("findings") or [])[:0]
    out["paywalled_preview"] = {
        "hidden_insights_count": hidden,
        "upgrade_cta": UPGRADE_CTA,
    }
    return out
