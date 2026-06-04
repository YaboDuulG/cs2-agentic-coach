"""
The Scribe — Report Generator
==============================
Consumes the final MatchState (scout stats, rag context, tactician analysis)
and generates three tailored reports:
- Strat Card (Team-visible)
- Player Reports (Private, constructive)
- Coach Report (Team Owner only)
"""

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


def generate_reports(
    match_id: str, scout_out: dict, rag_context: list, tactical_analysis: dict
) -> dict[str, Any]:
    """Calls Gemini to compile the final structured reports."""
    import os

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("No Gemini API key found for report generation.")
        return _stub_reports()

    try:
        from langchain_google_genai import ChatGoogleGenerativeAI

        from db.config import get_config

        model_name = get_config("coaching_model", "gemini-2.5-flash")
        temp_str = get_config("coaching_temperature", "0.4")
        try:
            temperature = float(temp_str)
        except ValueError:
            temperature = 0.4

        llm = ChatGoogleGenerativeAI(
            model=model_name,
            temperature=temperature,
            google_api_key=api_key,
            model_kwargs={"response_mime_type": "application/json"},
        )

        # Compile data payload
        payload = {
            "match_id": match_id,
            "scout_stats": scout_out,
            "rag_context": rag_context,
            "tactical_analysis": tactical_analysis,
        }

        user_team = scout_out.get("user_team")
        user_notes = scout_out.get("user_notes")
        uploader_steam_id = scout_out.get("uploader_steam_id")
        is_recon = scout_out.get("is_recon", False)

        # Load prompts from DB
        scribe_base = get_config("prompt_scribe_base")
        focus_prompt_template = get_config("prompt_focus_instruction")
        recon_prompt = get_config("prompt_recon_instruction")

        focus_instruction = ""
        if is_recon:
            focus_instruction = recon_prompt
        elif user_team:
            focus_instruction = focus_prompt_template.format(
                user_team=user_team, uploader_steam_id=uploader_steam_id
            )

        notes_instruction = ""
        if user_notes:
            notes_instruction = f"""
CRITICAL COACH NOTES TO INCORPORATE:
The user/coach has provided the following custom notes/instructions for this analysis:
---
{user_notes}
---
You MUST address, incorporate, or tailor your coaching, recommendations, and tactical insights based directly on these custom notes.
"""

        prompt = f"""
{scribe_base}
{focus_instruction}
{notes_instruction}

Generate a JSON object containing the following reports:
1. "individual_report": A markdown string focused exclusively on the uploader ({uploader_steam_id}) and how they can personally improve (their duels, positioning, utility, economy). If this is a Recon Scan (is_recon=true) or the uploader's Steam ID is not present in the match stats, focus this report on detailing individual highlights, head-to-head match-up analysis, and performance profiles of key players.
2. "team_report": A markdown string focused on the team's structure, rotation coordination, trade-fragging, utility setups, and communication improvements.
3. "player_reports": A dictionary mapping player names to their individual constructive markdown reports.
4. "strat_card": Legacy field - populate this with the same markdown as "team_report".
5. "coach_report": Legacy field - populate this with a summary of the tactical errors and rotation flags.

Ensure the output is valid JSON matching this schema:
{{
    "individual_report": "markdown string",
    "team_report": "markdown string",
    "player_reports": {{ "PlayerName": "markdown string" }},
    "strat_card": "markdown string",
    "coach_report": "markdown string"
}}

Match Data:
{json.dumps(payload, indent=2)}
"""

        response = llm.invoke(prompt)

        return json.loads(response.content)

    except Exception as e:
        logger.error(f"Failed to generate reports with Gemini: {e}")
        return _stub_reports()


def _stub_reports() -> dict[str, Any]:
    return {
        "individual_report": "### Individual Report\nAI coaching requires GEMINI_API_KEY.",
        "team_report": "### Team Report\nAI coaching requires GEMINI_API_KEY.",
        "player_reports": {},
        "strat_card": "### Strat Card\nAI coaching requires GEMINI_API_KEY.",
        "coach_report": "### Coach Report\nAI coaching requires GEMINI_API_KEY.",
    }
