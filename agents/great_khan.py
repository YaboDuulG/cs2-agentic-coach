"""
The Great Khan — AI Coaching Engine
=====================================
Pulls parsed match data from the DB and calls Gemini to generate
structured tactical coaching feedback. Output cached in matches.coaching_notes.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger("great_khan")

COACHING_MODEL = "gemini-2.0-flash"


def _build_prompt(match_id: str, stats: dict[str, Any]) -> str:
    return f"""You are DemoSage — an elite CS2 tactical coach. Analyse this match data and return ONLY valid JSON with no markdown.

Match: {stats.get('map_name', 'unknown')} | {stats.get('total_rounds', 0)} rounds
CT wins: {stats.get('ct_wins', 0)} | T wins: {stats.get('t_wins', 0)}

Top killers:
{json.dumps(stats.get('top_killers', []), indent=2)}

Economy summary (avg spend per round):
CT avg: ${stats.get('ct_avg_spend', 0):.0f} | T avg: ${stats.get('t_avg_spend', 0):.0f}

First contact win rate (who won the opening duel):
CT: {stats.get('ct_first_contact_pct', 0):.0%} | T: {stats.get('t_first_contact_pct', 0):.0%}

Top weapons used:
{json.dumps(stats.get('top_weapons', []), indent=2)}

Worst economy rounds (high spend, round lost):
{json.dumps(stats.get('worst_rounds', []), indent=2)}

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
}}"""


def _compute_stats(match_id: str) -> dict[str, Any] | None:
    """Pull match data from DB and compute summary statistics."""
    try:
        from db.database import SessionLocal  # noqa: PLC0415
        from db.models import FirstContact, Kill, Match, Round  # noqa: PLC0415

        db = SessionLocal()
        try:
            match = db.query(Match).filter(Match.match_id == match_id).first()
            if not match:
                return None

            kills = db.query(Kill).filter(Kill.match_id == match_id).all()
            rounds = db.query(Round).filter(Round.match_id == match_id).all()
            first_contacts = db.query(FirstContact).filter(FirstContact.match_id == match_id).all()

            # Win rates
            ct_wins = sum(1 for r in rounds if r.winner_side == "CT")
            t_wins = sum(1 for r in rounds if r.winner_side == "T")

            # Top killers
            killer_counts: dict[str, int] = {}
            weapon_counts: dict[str, int] = {}
            for k in kills:
                killer_counts[k.attacker] = killer_counts.get(k.attacker, 0) + 1
                weapon_counts[k.weapon] = weapon_counts.get(k.weapon, 0) + 1

            top_killers = sorted(killer_counts.items(), key=lambda x: x[1], reverse=True)[:5]
            top_weapons = sorted(weapon_counts.items(), key=lambda x: x[1], reverse=True)[:5]

            # Economy
            ct_spends = [r.ct_eq_val for r in rounds if r.ct_eq_val > 0]
            t_spends = [r.t_eq_val for r in rounds if r.t_eq_val > 0]

            # Worst rounds (lost despite high spend)
            worst_rounds = []
            for r in rounds:
                spend = r.ct_eq_val if r.winner_side == "T" else r.t_eq_val
                if spend > 10000:
                    worst_rounds.append({
                        "round": r.round_num,
                        "loser": "CT" if r.winner_side == "T" else "T",
                        "spend": spend,
                        "winner": r.winner_side,
                    })
            worst_rounds = sorted(worst_rounds, key=lambda x: x["spend"], reverse=True)[:5]

            # First contact win rate
            ct_fc = sum(1 for fc in first_contacts if fc.attacker_team == "CT")
            t_fc = len(first_contacts) - ct_fc
            total_fc = len(first_contacts) or 1

            return {
                "map_name": match.map_name,
                "total_rounds": match.total_rounds,
                "ct_wins": ct_wins,
                "t_wins": t_wins,
                "top_killers": [{"player": p, "kills": k} for p, k in top_killers],
                "top_weapons": [{"weapon": w, "kills": k} for w, k in top_weapons],
                "ct_avg_spend": sum(ct_spends) / len(ct_spends) if ct_spends else 0,
                "t_avg_spend": sum(t_spends) / len(t_spends) if t_spends else 0,
                "ct_first_contact_pct": ct_fc / total_fc,
                "t_first_contact_pct": t_fc / total_fc,
                "worst_rounds": worst_rounds,
            }
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to compute stats for {match_id}: {e}")
        return None


def _call_gemini(prompt: str) -> dict[str, Any] | None:
    """Call Gemini and parse the JSON coaching response."""
    try:
        import google.generativeai as genai  # noqa: PLC0415

        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            logger.warning("No Gemini API key — returning stub coaching notes")
            return _stub_coaching()

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(COACHING_MODEL)
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.4,
                response_mime_type="application/json",
            ),
        )
        return json.loads(response.text)
    except Exception as e:
        logger.error(f"Gemini call failed: {e}")
        return None


def _stub_coaching() -> dict[str, Any]:
    """Fallback when no API key is configured."""
    return {
        "summary": "Demo analysed. AI coaching requires GEMINI_API_KEY to be configured.",
        "key_findings": ["Upload a demo and configure GEMINI_API_KEY to see AI insights."],
        "economy_analysis": "Economy data parsed successfully.",
        "tactical_recommendations": [
            {"title": "Configure API Key", "detail": "Add GEMINI_API_KEY to your GCP Secret Manager to enable AI coaching."}
        ],
        "strongest_area": "Demo parsed successfully.",
        "weakest_area": "AI coaching not yet configured.",
    }


def analyse_match(match_id: str) -> dict[str, Any] | None:
    """
    Main entry point. Compute stats → call Gemini → cache result in DB.
    Returns the coaching dict or None on failure.
    """
    logger.info(f"[Great Khan] Starting coaching analysis for {match_id}")

    stats = _compute_stats(match_id)
    if not stats:
        logger.warning(f"[Great Khan] No stats for {match_id} — skipping")
        return None

    prompt = _build_prompt(match_id, stats)
    coaching = _call_gemini(prompt)
    if not coaching:
        coaching = _stub_coaching()

    # Cache in DB
    try:
        from db.database import SessionLocal  # noqa: PLC0415
        from db.models import Match  # noqa: PLC0415

        db = SessionLocal()
        try:
            match = db.query(Match).filter(Match.match_id == match_id).first()
            if match:
                match.coaching_notes = json.dumps(coaching)
                db.commit()
                logger.info(f"[Great Khan] Coaching notes saved for {match_id}")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to save coaching notes: {e}")

    return coaching
