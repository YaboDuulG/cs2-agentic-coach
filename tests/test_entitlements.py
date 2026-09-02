"""
Module-2/4 tests: analysis modes, the Coaching Report Schema payload, the
three-tier entitlement matrix, Stripe lifecycle → tier resolution (grace
periods), team-seat inheritance, teaser redaction, and cache invalidation.
"""

from datetime import datetime, timedelta
import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from agents.scribe.modes import AnalysisMode, derive_mode
from agents.scribe.report_generator import _build_report_v2, _grade, _match_score
from db.models import Base, Subscription, Team, TeamMember
from services.billing import (
    Entitlement,
    Tier,
    effective_entitlements,
    invalidate_user,
    redact_coaching_payload,
    resolve_tier,
    resolve_user_tier,
)
from services.billing.entitlements import (
    TIER_ENTITLEMENTS,
    _clear_cache,
    tier_from_subscription,
)

FINDINGS = [
    {
        "claim": "Opening duel rate 31% vs pro 50% [F1][B1]",
        "evidence_ids": ["F1", "B1"],
        "rounds": [3, 7],
        "severity": "high",
        "category": "OPENING_DUELS",
        "drill": "Prefire practice on mirage connector, 15 min daily.",
        "audience": "individual",
    },
    {
        "claim": "No trade within 5s on B retakes [F2][P1]",
        "evidence_ids": ["F2", "P1"],
        "rounds": [12],
        "severity": "medium",
        "category": "TRADE_SPACING",
        "drill": "Retake spacing drill.",
        "audience": "team",
    },
]

EVIDENCE_PACK = {
    "facts": [
        {"id": "F1", "kind": "fcr", "detail": "won 4/13 opening duels", "rounds": [3, 7]},
        {"id": "F2", "kind": "trade", "detail": "0/4 traded on B", "rounds": [12]},
    ],
    "baselines": [
        {"id": "B1", "metric": "fcr_win_rate", "detail": "tier-1 opening duel rate",
         "value": 0.5, "unit": "ratio", "source": "hltv aggregate"},
    ],
    "pro_examples": [
        {"id": "P1", "detail": "Vitality B retake with trade spacing",
         "pro_match_id": "hltv-2377810", "round_ref": 12},
    ],
    "round_ticks": {"3": 34120, "7": 91000, "12": 160010},
}

TACTICAL = {
    "fcr": {"fcr_match_rate": 0.4},
    "economy": {"overall_coherence_score": 0.8, "flags": []},
}


def _coaching(mode=AnalysisMode.PERSONAL_IMPROVEMENT):
    """Docstring for _coaching."""
    report_v2 = _build_report_v2(mode, FINDINGS, "Headline here.", TACTICAL, EVIDENCE_PACK)
    return {
        "individual_report": "### Individual Report\nfull detail",
        "team_report": "### Team Report\nfull detail",
        "player_reports": {"alice": "deep dive"},
        "strat_card": "full strat",
        "coach_report": "full coach detail",
        "findings": FINDINGS,
        "summary": "Headline here.",
        "report_v2": report_v2,
    }


@pytest.fixture()
def db_session():
    """Docstring for db_session."""
    _clear_cache()
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    _clear_cache()


class TestModes:
    """Docstring for TestModes."""

    def test_recon_wins(self):
        """Docstring for test_recon_wins."""
        assert derive_mode({"is_recon": True, "team_id": "t1"}) is AnalysisMode.OPPOSITION_RESEARCH

    def test_team_context(self):
        """Only an explicit team upload selects team analysis."""
        assert derive_mode({"team_id": "t1"}) is AnalysisMode.TEAM_ANALYSIS

    def test_identified_uploader_stays_personal(self):
        """Finding the uploader's Steam ID in the demo must NOT force team mode."""
        scout = {"user_team": "CT", "uploader_team_label": "Team A", "uploader_steam_id": "765"}
        assert derive_mode(scout) is AnalysisMode.PERSONAL_IMPROVEMENT

    def test_default_personal(self):
        """Docstring for test_default_personal."""
        assert derive_mode({}) is AnalysisMode.PERSONAL_IMPROVEMENT


class TestReportV2:
    """Docstring for TestReportV2."""

    def test_score_and_grade_are_deterministic(self):
        """Docstring for test_score_and_grade_are_deterministic."""
        assert _match_score(TACTICAL) == 60
        assert _grade(60) == "C"
        assert _grade(86) == "A"
        assert _match_score({}) == 50

    def test_tick_joined_from_evidence_not_llm(self):
        """Docstring for test_tick_joined_from_evidence_not_llm."""
        report = _build_report_v2(
            AnalysisMode.PERSONAL_IMPROVEMENT, FINDINGS, "Solid CT half. More issues on T side.",
            TACTICAL, EVIDENCE_PACK,
        )
        kf = report["key_findings"]
        assert kf[0]["tick"] == 34120 and kf[1]["tick"] == 160010
        assert report["summary"] == {"score": 60, "grade": "C", "headline": "Solid CT half."}

    def test_benchmark_composed_from_cited_evidence(self):
        """Docstring for test_benchmark_composed_from_cited_evidence."""
        report = _build_report_v2(AnalysisMode.TEAM_ANALYSIS, FINDINGS, "s", TACTICAL, EVIDENCE_PACK)
        assert "hltv aggregate" in report["key_findings"][0]["grounded_pro_benchmark"]
        assert "pro match hltv-2377810" in report["key_findings"][1]["grounded_pro_benchmark"]


class TestEntitlementMatrix:
    """Docstring for TestEntitlementMatrix."""

    def test_matrix_is_cumulative(self):
        """Docstring for test_matrix_is_cumulative."""
        assert TIER_ENTITLEMENTS[Tier.FREE] < TIER_ENTITLEMENTS[Tier.SOLO_PRO]
        assert TIER_ENTITLEMENTS[Tier.SOLO_PRO] < TIER_ENTITLEMENTS[Tier.TEAM]
        assert Entitlement.TEAM_SCOUTING in TIER_ENTITLEMENTS[Tier.TEAM]
        assert Entitlement.TEAM_SCOUTING not in TIER_ENTITLEMENTS[Tier.SOLO_PRO]

    def test_plan_strings(self):
        """Docstring for test_plan_strings."""
        assert resolve_tier("free") is Tier.FREE
        assert resolve_tier(None) is Tier.FREE
        assert resolve_tier("basic") is Tier.SOLO_PRO
        assert resolve_tier("pro") is Tier.TEAM


class TestSubscriptionLifecycle:
    """Docstring for TestSubscriptionLifecycle."""

    def _sub(self, **kw):
        """Docstring for _sub."""
        defaults = dict(user_id="u1", plan="pro", status="active")
        defaults.update(kw)
        return Subscription(**defaults)

    def test_active_and_trialing_grant_tier(self):
        """Docstring for test_active_and_trialing_grant_tier."""
        assert tier_from_subscription(self._sub(status="active")) is Tier.TEAM
        assert tier_from_subscription(self._sub(status="trialing", plan="basic")) is Tier.SOLO_PRO

    def test_past_due_keeps_tier_through_grace(self):
        """Docstring for test_past_due_keeps_tier_through_grace."""
        now = datetime(2026, 9, 1, 12, 0)
        sub = self._sub(status="past_due", grace_until=now + timedelta(days=1))
        assert tier_from_subscription(sub, now) is Tier.TEAM
        sub.grace_until = now - timedelta(minutes=1)
        assert tier_from_subscription(sub, now) is Tier.FREE

    def test_canceled_keeps_tier_until_period_end(self):
        """Docstring for test_canceled_keeps_tier_until_period_end."""
        now = datetime(2026, 9, 1, 12, 0)
        sub = self._sub(status="canceled", current_period_end=now + timedelta(days=3))
        assert tier_from_subscription(sub, now) is Tier.TEAM
        sub.current_period_end = now - timedelta(days=1)
        assert tier_from_subscription(sub, now) is Tier.FREE

    def test_db_beats_header_and_cache_invalidates(self, db_session):
        """Docstring for test_db_beats_header_and_cache_invalidates."""
        db_session.add(Subscription(user_id="u1", plan="basic", status="active"))
        db_session.commit()
        # Header claims pro; the DB row (basic → SOLO_PRO) is the authority.
        assert resolve_user_tier(db_session, "u1", "pro") is Tier.SOLO_PRO
        # Upgrade lands via webhook; without invalidation the cache serves stale.
        db_session.get(Subscription, "u1").plan = "pro"
        db_session.commit()
        assert resolve_user_tier(db_session, "u1", None) is Tier.SOLO_PRO  # cached
        invalidate_user("u1")
        assert resolve_user_tier(db_session, "u1", None) is Tier.TEAM

    def test_no_row_falls_back_to_header(self, db_session):
        """Docstring for test_no_row_falls_back_to_header."""
        assert resolve_user_tier(db_session, "nobody", "basic") is Tier.SOLO_PRO


class TestTeamSeats:
    """Docstring for TestTeamSeats."""

    def _team(self, db, owner="owner1", member="member1"):
        """Docstring for _team."""
        db.add(Team(id="t1", name="Horde", owner_user_id=owner, invite_code="XYZ12345"))
        db.add(TeamMember(team_id="t1", user_id=member))
        db.add(TeamMember(team_id="t1", user_id=owner))
        db.commit()

    def test_member_inherits_team_scoped_entitlements(self, db_session):
        """Docstring for test_member_inherits_team_scoped_entitlements."""
        self._team(db_session)
        db_session.add(Subscription(user_id="owner1", plan="pro", status="active"))
        db_session.commit()
        ents = effective_entitlements(db_session, "member1", None, team_id="t1")
        assert Entitlement.TEAM_ANALYSIS in ents
        assert Entitlement.TEAM_SCOUTING in ents
        # Personal deep coaching is NOT inherited.
        assert Entitlement.FULL_COACHING not in ents

    def test_no_inheritance_without_team_owner_plan(self, db_session):
        """Docstring for test_no_inheritance_without_team_owner_plan."""
        self._team(db_session)
        ents = effective_entitlements(db_session, "member1", None, team_id="t1")
        assert Entitlement.TEAM_ANALYSIS not in ents

    def test_non_member_gets_nothing(self, db_session):
        """Docstring for test_non_member_gets_nothing."""
        self._team(db_session)
        db_session.add(Subscription(user_id="owner1", plan="pro", status="active"))
        db_session.commit()
        ents = effective_entitlements(db_session, "stranger", None, team_id="t1")
        assert Entitlement.TEAM_ANALYSIS not in ents


class TestRedaction:
    """Docstring for TestRedaction."""

    def test_full_coaching_passthrough(self):
        """Docstring for test_full_coaching_passthrough."""
        out = redact_coaching_payload(_coaching(), TIER_ENTITLEMENTS[Tier.SOLO_PRO])
        assert len(out["report_v2"]["key_findings"]) == 2
        assert out["report_v2"]["paywalled_preview"] is None
        assert out["player_reports"] == {"alice": "deep dive"}

    def test_free_gets_one_broad_takeaway(self):
        """Docstring for test_free_gets_one_broad_takeaway."""
        out = redact_coaching_payload(_coaching(), TIER_ENTITLEMENTS[Tier.FREE])
        v2 = out["report_v2"]
        assert len(v2["key_findings"]) == 1
        assert "actionable_drill" not in v2["key_findings"][0]
        assert v2["paywalled_preview"]["hidden_insights_count"] == 1
        assert out["player_reports"] == {}

    def test_oppo_report_teased_without_scouting(self):
        """A Solo Pro user hitting an opposition report gets the masked teaser."""
        coaching = _coaching(AnalysisMode.OPPOSITION_RESEARCH)
        out = redact_coaching_payload(coaching, TIER_ENTITLEMENTS[Tier.SOLO_PRO])
        v2 = out["report_v2"]
        assert v2["key_findings"] == []
        assert v2["finding_categories"] == {"OPENING_DUELS": 1, "TRADE_SPACING": 1}
        assert v2["paywalled_preview"]["tier_needed"] == "TEAM"
        assert "full detail" not in out["team_report"]

    def test_team_report_full_for_team_tier(self):
        """Docstring for test_team_report_full_for_team_tier."""
        coaching = _coaching(AnalysisMode.TEAM_ANALYSIS)
        out = redact_coaching_payload(coaching, TIER_ENTITLEMENTS[Tier.TEAM])
        assert len(out["report_v2"]["key_findings"]) == 2

    def test_team_report_teased_for_solo(self):
        """Docstring for test_team_report_teased_for_solo."""
        coaching = _coaching(AnalysisMode.TEAM_ANALYSIS)
        out = redact_coaching_payload(coaching, TIER_ENTITLEMENTS[Tier.SOLO_PRO])
        assert out["report_v2"]["key_findings"] == []
        assert out["report_v2"]["paywalled_preview"]["tier_needed"] == "TEAM"
