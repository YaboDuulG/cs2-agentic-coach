"""Module docstring."""
import json
from typing import Any


def _build_prompt(
    match_id: str, stats: dict[str, Any], rag_context: list[dict[str, Any]] | None = None
) -> str:
    """Docstring for _build_prompt."""
    rag_text = ""
    if rag_context:
        rag_text = "\n\nCRITICAL CONTEXT & GAME RULES FOR THE COACH (RAG):\n"
        for i, chunk in enumerate(rag_context, 1):
            rag_text += f"[{i}] {chunk.get('content')}\n"

    from db.config import get_config

    base_instructions = get_config(
        "prompt_great_khan_instructions",
        "You are DemoSage — an elite CS2 tactical coach. Analyse this match data and return ONLY valid JSON with no markdown.",
    )

    return f"""{base_instructions}

Match: {stats.get("map_name", "unknown")} | {stats.get("total_rounds", 0)} rounds
Final score (Team A started CT; sides swap at halftime): Team A {stats.get("team_a_wins", 0)} – {stats.get("team_b_wins", 0)} Team B
Rounds won by side across both halves (map-balance signal, NOT the match score): CT {stats.get("ct_wins", 0)} | T {stats.get("t_wins", 0)}

Top killers:
{json.dumps(stats.get("top_killers", []), indent=2)}

Economy summary (avg spend per round):
CT avg: ${stats.get("ct_avg_spend", 0):.0f} | T avg: ${stats.get("t_avg_spend", 0):.0f}

First contact win rate (who won the opening duel):
CT: {stats.get("ct_first_contact_pct", 0):.0%} | T: {stats.get("t_first_contact_pct", 0):.0%}

Top weapons used:
{json.dumps(stats.get("top_weapons", []), indent=2)}

Worst economy rounds (high spend, round lost):
{json.dumps(stats.get("worst_rounds", []), indent=2)}

Return this exact JSON structure:
{{
  "summary": "2-3 sentence match summary mentioning map, score, and overall performance",
  "key_findings": ["finding 1", "finding 2", "finding 3", "finding 4"],
  "economy_analysis": "2-3 sentences on economy patterns and mismanagement",
  "tactical_recommendations": [
    {{"title": "short title", "detail": "specific actionable recommendation"}},
    {{"title": "short title", "detail": "specific actionable recommendation"}},
    {{"title": "short title", "detail": "specific actionable recommendation"}}
  ],
  "strongest_area": "one sentence on what the team did well",
  "weakest_area": "one sentence on the biggest weakness to fix"
}}{rag_text}"""
