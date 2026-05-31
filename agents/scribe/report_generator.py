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

def generate_reports(match_id: str, scout_out: dict, rag_context: list, tactical_analysis: dict) -> dict[str, Any]:
    """Calls Gemini to compile the final structured reports."""
    import os

    import google.generativeai as genai

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("No Gemini API key found for report generation.")
        return _stub_reports()

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")

        # Compile data payload
        payload = {
            "match_id": match_id,
            "scout_stats": scout_out,
            "rag_context": rag_context,
            "tactical_analysis": tactical_analysis
        }

        prompt = f"""
You are the DemoSage CS2 Coach ('The Scribe').
Analyze the following match data, which includes raw stats, RAG context (pro strategies and rules), and automated tactical analysis (economy, rotations, utility, first contacts).

Generate a JSON object containing three distinct reports:
1. "strat_card": A markdown string for the whole team. Focus on high-level team strategy, what the team did well, areas to improve, and a pro reference if applicable.
2. "player_reports": A dictionary mapping player names to their individual markdown reports. Focus on constructive framing (positives first, then areas to improve based on tactician flags).
3. "coach_report": A markdown string for the team owner. Aggregate the tactical analysis flags, highlighting critical issues (like over-peeking, terrible utility dumping, economy mismanagement) across the team.

Ensure the output is valid JSON matching this schema:
{{
    "strat_card": "markdown string",
    "player_reports": {{ "PlayerName": "markdown string" }},
    "coach_report": "markdown string"
}}

Match Data:
{json.dumps(payload, indent=2)}
"""

        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json"
            )
        )

        return json.loads(response.text)

    except Exception as e:
        logger.error(f"Failed to generate reports with Gemini: {e}")
        return _stub_reports()


def _stub_reports() -> dict[str, Any]:
    return {
        "strat_card": "### Strat Card\nAI coaching requires GEMINI_API_KEY.",
        "player_reports": {},
        "coach_report": "### Coach Report\nAI coaching requires GEMINI_API_KEY."
    }
