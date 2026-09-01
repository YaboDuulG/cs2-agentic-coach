"""
Module-2 tests: analysis modes, the Coaching Report Schema payload, and
tier-gated redaction (paywalled data omitted server-side, never hidden).
"""

import os

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from agents.scribe.modes import AnalysisMode, derive_mode
from agents.scribe.report_generator import _build_report_v2, _grade, _match_score
from services.billing import Tier, redact_coaching_payload, resolve_tier

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
    # JSON round-trip stringifies keys — the builder must tolerate that.
    "round_ticks": {"3": 34120, "7": 91000, "12": 160010},
}

TACTICAL = {
    "fcr": {"fcr_match_rate": 0.4},
    "economy": {"overall_coherence_score": 0.8, "flags": []},
}


class TestModes:
    """Docstring for TestModes."""

    def test_recon_wins(self):
        """Docstring for test_recon_wins."""
        assert derive_mode({"is_recon": True, "team_id": "t1"}) is AnalysisMode.OPPOSITION_RESEARCH

    def test_team_context(self):
        """Docstring for test_team_context."""
        assert derive_mode({"user_team": "CT"}) is AnalysisMode.TEAM_ANALYSIS

    def test_default_personal(self):
        """Docstring for test_default_personal."""
        assert derive_mode({}) is AnalysisMode.PERSONAL_IMPROVEMENT


class TestReportV2:
    """Docstring for TestReportV2."""

    def test_score_and_grade_are_deterministic(self):
        """Docstring for test_score_and_grade_are_deterministic."""
        assert _match_score(TACTICAL) == 60  # mean(0.4, 0.8) = 0.6
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
        assert kf[0]["round"] == 3
        assert kf[0]["tick"] == 34120
        assert kf[1]["tick"] == 160010
        assert kf[0]["severity"] == "HIGH"
        assert report["mode"] == "PERSONAL_IMPROVEMENT"
        assert report["summary"] == {"score": 60, "grade": "C", "headline": "Solid CT half."}

    def test_benchmark_composed_from_cited_evidence(self):
        """Docstring for test_benchmark_composed_from_cited_evidence."""
        report = _build_report_v2(
            AnalysisMode.TEAM_ANALYSIS, FINDINGS, "s", TACTICAL, EVIDENCE_PACK
        )
        bench0 = report["key_findings"][0]["grounded_pro_benchmark"]
        assert "[B1]" in bench0 and "0.5" in bench0 and "hltv aggregate" in bench0
        bench1 = report["key_findings"][1]["grounded_pro_benchmark"]
        assert "pro match hltv-2377810" in bench1


class TestTierGating:
    """Docstring for TestTierGating."""

    def _coaching(self):
        report_v2 = _build_report_v2(
            AnalysisMode.PERSONAL_IMPROVEMENT, FINDINGS, "Headline here.", TACTICAL, EVIDENCE_PACK
        )
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

    def test_resolve_tier(self):
        """Docstring for test_resolve_tier."""
        assert resolve_tier("free") is Tier.FREE
        assert resolve_tier(None) is Tier.FREE
        assert resolve_tier("basic") is Tier.PREMIUM
        assert resolve_tier("pro") is Tier.PREMIUM

    def test_premium_passthrough(self):
        """Docstring for test_premium_passthrough."""
        out = redact_coaching_payload(self._coaching(), Tier.PREMIUM)
        assert len(out["report_v2"]["key_findings"]) == 2
        assert out["report_v2"]["paywalled_preview"] is None
        assert out["player_reports"] == {"alice": "deep dive"}

    def test_free_gets_one_broad_takeaway_only(self):
        """FREE: grade + summary + 1 takeaway; drills/ticks/benchmarks omitted."""
        out = redact_coaching_payload(self._coaching(), Tier.FREE)
        v2 = out["report_v2"]
        assert v2["summary"]["grade"] == "C"
        assert len(v2["key_findings"]) == 1
        takeaway = v2["key_findings"][0]
        # The highest-severity finding, stripped to a broad observation.
        assert takeaway["severity"] == "HIGH"
        assert "tick" not in takeaway
        assert "actionable_drill" not in takeaway
        assert "grounded_pro_benchmark" not in takeaway
        assert v2["paywalled_preview"]["hidden_insights_count"] == 1
        assert "Upgrade" in v2["paywalled_preview"]["upgrade_cta"]

    def test_free_legacy_sections_omitted_not_hidden(self):
        """Docstring for test_free_legacy_sections_omitted_not_hidden."""
        out = redact_coaching_payload(self._coaching(), Tier.FREE)
        assert "full detail" not in out["team_report"]
        assert out["player_reports"] == {}
        assert out["findings"] == []
        # The original payload is untouched (no shared-state mutation).
        original = self._coaching()
        redact_coaching_payload(original, Tier.FREE)
        assert original["player_reports"] == {"alice": "deep dive"}

    def test_free_without_report_v2_still_redacts(self):
        """Cached pre-v2 reports (no report_v2 key) must still be gated."""
        coaching = self._coaching()
        coaching["report_v2"] = None
        out = redact_coaching_payload(coaching, Tier.FREE)
        assert out["player_reports"] == {}
        assert out["paywalled_preview"]["hidden_insights_count"] == 2
