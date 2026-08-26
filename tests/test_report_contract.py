"""
Scribe prompt-contract tests — the genai client is fully mocked (CI has no key).
Validates that synthesis findings flow through verification, unsupported
findings get dropped, legacy report keys are rendered with citation brackets,
and round flash calls receive only their own round's evidence.
"""

import json
import logging
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

# Force SQLite for all tests in this module
os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from agents.scribe.report_generator import (
    _render_legacy_reports,
    async_generate_reports,
    generate_reports,
)

EVIDENCE_PACK = {
    "facts": [
        {
            "id": "F1",
            "kind": "fcr",
            "player": "uploader",
            "detail": "uploader won 1/4 opening duels",
            "rounds": [1, 3],
            "value": 0.25,
        },
        {
            "id": "F2",
            "kind": "economy",
            "detail": "Round 2: CT forced with poor economy.",
            "rounds": [2],
            "value": 12000,
        },
        {
            "id": "F3",
            "kind": "rotation",
            "player": "s1mple",
            "detail": "Round 4: s1mple showed very low movement/late rotation.",
            "rounds": [4],
        },
    ],
    "baselines": [
        {
            "id": "B1",
            "metric": "fcr_win_rate",
            "map_name": "any",
            "side": "any",
            "value": 0.50,
            "unit": "ratio",
            "detail": "tier-1 average",
            "source": "bootstrap default",
        }
    ],
    "pro_examples": [
        {"id": "P1", "round_ref": 2, "detail": "Vitality anti-force setup", "source": "hltv_pro_match"}
    ],
}

SCOUT_OUT = {
    "map_name": "mirage",
    "uploader_team_label": "TeamA",
    "uploader_steam_id": "steam123",
    "round_history": [
        {"round_num": 1, "winner_side": "CT"},
        {"round_num": 2, "winner_side": "T"},
    ],
}

CANNED_SYNTHESIS = {
    "findings": [
        {
            "claim": "Your opening-duel win rate was 25% [F1] against a baseline of 50% [B1].",
            "evidence_ids": ["F1", "B1"],
            "rounds": [1, 3],
            "severity": "high",
            "drill": "Prefire common angles for 15 minutes daily.",
            "audience": "individual",
        },
        {
            "claim": "The team forced with poor economy in round 2 [F2].",
            "evidence_ids": ["F2"],
            "rounds": [2],
            "severity": "medium",
            "drill": "Adopt a fixed sub-2000 full-save rule.",
            "audience": "team",
        },
        {
            "claim": "s1mple rotated late in round 4 [F3].",
            "evidence_ids": ["F3"],
            "rounds": [4],
            "severity": "low",
            "drill": "Practice rotation timings on bomb-plant sound cues.",
            "audience": "player:s1mple",
        },
        {
            "claim": "The AWP setups were fundamentally flawed all game.",
            "evidence_ids": ["F99"],
            "rounds": [],
            "severity": "high",
            "drill": "n/a",
            "audience": "team",
        },
    ],
    "summary": "Grounded summary of the match.",
}

# Verification drops the last (bogus-evidence) finding
CANNED_VERDICTS = {
    "verdicts": [
        {"index": 0, "supported": True},
        {"index": 1, "supported": True},
        {"index": 2, "supported": True},
        {"index": 3, "supported": False},
    ]
}


def _make_client(verifier_fails: bool = False) -> tuple[MagicMock, list[dict]]:
    """Mock genai client whose generate_content routes on prompt markers."""
    client = MagicMock()
    calls: list[dict] = []

    async def fake_generate(model=None, contents=None, config=None):
        calls.append({"model": model, "contents": contents, "config": config})
        if "evidence verifier" in contents:
            if verifier_fails:
                raise RuntimeError("verifier down")
            return SimpleNamespace(text=json.dumps(CANNED_VERDICTS))
        if "EVIDENCE PACK" in contents:
            return SimpleNamespace(text=json.dumps(CANNED_SYNTHESIS))
        return SimpleNamespace(text="flash round summary")

    client.aio.models.generate_content = AsyncMock(side_effect=fake_generate)
    return client, calls


class TestReportContract:
    """Docstring for TestReportContract."""

    async def test_full_pipeline_renders_legacy_keys_with_citations(self, monkeypatch, caplog):
        """Synthesis → verification (drops one) → legacy markdown with [ID] citations."""
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        client, _calls = _make_client()

        with patch("agents.scribe.report_generator.genai.Client", return_value=client):
            with caplog.at_level(logging.WARNING, logger="agents.scribe.report_generator"):
                report = await async_generate_reports(
                    "match-123", SCOUT_OUT, [], {}, {"mid": "smoke lineups"}, EVIDENCE_PACK
                )

        # Legacy keys the frontend expects
        for key in ("individual_report", "team_report", "player_reports", "strat_card", "coach_report"):
            assert key in report

        # Raw findings + summary ride along; the unsupported finding is gone
        assert len(report["findings"]) == 3
        assert report["summary"] == "Grounded summary of the match."
        assert not any("F99" in json.dumps(f) for f in report["findings"])
        assert "dropped 1/4" in caplog.text

        # Citations survive into the rendered markdown
        assert "[F1]" in report["individual_report"]
        assert "[B1]" in report["individual_report"]
        assert "[F2]" in report["team_report"]
        assert report["strat_card"] == report["team_report"]
        assert "s1mple" in report["player_reports"]
        assert "[F3]" in report["player_reports"]["s1mple"]
        assert "Grounded summary of the match." in report["coach_report"]

    async def test_round_flash_gets_only_its_rounds_evidence(self, monkeypatch):
        """Round 1 prompt carries F1 (rounds 1,3) but not F2 (round 2) or P1 (round 2)."""
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        client, calls = _make_client()

        with patch("agents.scribe.report_generator.genai.Client", return_value=client):
            await async_generate_reports(
                "match-123", SCOUT_OUT, [], {}, {}, EVIDENCE_PACK
            )

        round_calls = [
            c for c in calls
            if "evidence verifier" not in c["contents"] and "EVIDENCE PACK" not in c["contents"]
        ]
        assert len(round_calls) == 2  # one per round in round_history

        round1 = next(c for c in round_calls if '"round_num": 1' in c["contents"])
        assert '"F1"' in round1["contents"]
        assert '"F2"' not in round1["contents"]
        assert '"P1"' not in round1["contents"]
        assert '"B1"' in round1["contents"]  # baselines are round-agnostic

        round2 = next(c for c in round_calls if '"round_num": 2' in c["contents"])
        assert '"F2"' in round2["contents"]
        assert '"P1"' in round2["contents"]
        assert '"F1"' not in round2["contents"]

    async def test_synthesis_is_schema_constrained(self, monkeypatch):
        """The synthesis call passes a response_schema, not just a mime type."""
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        client, calls = _make_client()

        with patch("agents.scribe.report_generator.genai.Client", return_value=client):
            await async_generate_reports("match-123", SCOUT_OUT, [], {}, {}, EVIDENCE_PACK)

        synthesis = next(c for c in calls if "EVIDENCE PACK" in c["contents"])
        assert synthesis["config"] is not None
        assert synthesis["config"].response_schema is not None
        assert synthesis["config"].response_mime_type == "application/json"
        # The full evidence pack and the contract text ride in the prompt
        assert '"P1"' in synthesis["contents"]
        assert "square brackets" in synthesis["contents"]

    async def test_verifier_failure_keeps_all_findings(self, monkeypatch):
        """If the verification call blows up, no findings are dropped."""
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        client, _calls = _make_client(verifier_fails=True)

        with patch("agents.scribe.report_generator.genai.Client", return_value=client):
            report = await async_generate_reports(
                "match-123", SCOUT_OUT, [], {}, {}, EVIDENCE_PACK
            )

        assert len(report["findings"]) == 4

    def test_stub_reports_without_api_key(self, monkeypatch):
        """No key → stub reports, and the DB is never touched."""
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

        report = generate_reports("match-123", SCOUT_OUT, [], {})

        assert "GEMINI_API_KEY" in report["individual_report"]
        assert report["findings"] == []
        assert report["player_reports"] == {}


class TestLegacyRendering:
    """Docstring for TestLegacyRendering."""

    def test_missing_citation_brackets_are_appended(self):
        """A claim without inline [ID] brackets gets them appended in the markdown."""
        findings = [
            {
                "claim": "Economy discipline broke down.",
                "evidence_ids": ["F2", "B1"],
                "rounds": [2],
                "severity": "medium",
                "drill": "Buy rules.",
                "audience": "team",
            }
        ]
        report = _render_legacy_reports(findings, "Summary.")
        assert "[F2, B1]" in report["team_report"]
        assert "Rounds: 2" in report["team_report"]
        assert "Drill: Buy rules." in report["team_report"]

    def test_empty_findings_render_placeholders(self):
        """Docstring for test_empty_findings_render_placeholders."""
        report = _render_legacy_reports([], "Nothing to report.")
        assert "No evidence-backed findings" in report["individual_report"]
        assert report["player_reports"] == {}
        assert report["summary"] == "Nothing to report."
