"""
Analysis modes — the evaluation lens the Scribe applies to a match.
===================================================================
The mode shifts what the synthesis prompt emphasizes and which audiences
the findings target. It is derived from match facts (recon flag, team
context), never guessed by the LLM.
"""

import enum

# Finding categories enforced by the report schema. Superset of the three
# module examples so every heuristic has a home.
FINDING_CATEGORIES = [
    "UTILITY_USAGE",
    "POSITIONING",
    "TRADE_SPACING",
    "OPENING_DUELS",
    "ECONOMY",
    "ROTATION",
]


class AnalysisMode(str, enum.Enum):
    """Docstring for AnalysisMode."""
    PERSONAL_IMPROVEMENT = "PERSONAL_IMPROVEMENT"
    TEAM_ANALYSIS = "TEAM_ANALYSIS"
    OPPOSITION_RESEARCH = "OPPOSITION_RESEARCH"


MODE_SPEC: dict[AnalysisMode, dict] = {
    AnalysisMode.PERSONAL_IMPROVEMENT: {
        "focus_instruction": (
            "MODE: PERSONAL_IMPROVEMENT. Evaluate ONLY the uploader as an individual: "
            "positioning and crosshair-placement proxies (kill/death angles), utility "
            "efficiency, opening-duel decisions, whether their deaths were traded. "
            "Facts whose player field equals the uploader's Steam ID are about the "
            "uploader — build findings from those first. Other players matter only as "
            "context for the uploader's decisions (who traded them, who they flashed); "
            "never coach a teammate. Address every finding to the uploader as 'you'."
        ),
        "audiences": ("individual",),
        "category_bias": ["POSITIONING", "OPENING_DUELS", "UTILITY_USAGE"],
    },
    AnalysisMode.TEAM_ANALYSIS: {
        "focus_instruction": (
            "MODE: TEAM_ANALYSIS. Evaluate the team as a unit: macro spacing, trade "
            "percentage, default map control, synchronized utility executes, retake "
            "timing, and rotation delays. Findings should target the team and named players."
        ),
        "audiences": ("team", "player:*", "coach"),
        "category_bias": ["TRADE_SPACING", "UTILITY_USAGE", "ROTATION"],
    },
    AnalysisMode.OPPOSITION_RESEARCH: {
        "focus_instruction": (
            "MODE: OPPOSITION_RESEARCH. Profile the opposing team's tendencies: default "
            "habits, favorite execute timings, role mapping (anchors, lurkers), eco and "
            "force-buy setups, and exploitable defensive gaps. Findings are scouting "
            "intel for playing AGAINST this team, not advice to them."
        ),
        "audiences": ("scout",),
        "category_bias": ["ECONOMY", "POSITIONING", "ROTATION"],
    },
}


def derive_mode(scout_out: dict) -> AnalysisMode:
    """Recon flag wins; an explicit team context means team analysis; else personal.

    Only team_id (the match was uploaded into a team) selects TEAM_ANALYSIS.
    user_team / uploader_team_label merely mean the uploader's Steam ID was
    found in the demo — that identifies WHO the individual is, and must not
    knock a solo upload out of personal mode.
    """
    if scout_out.get("is_recon"):
        return AnalysisMode.OPPOSITION_RESEARCH
    if scout_out.get("team_id"):
        return AnalysisMode.TEAM_ANALYSIS
    return AnalysisMode.PERSONAL_IMPROVEMENT
