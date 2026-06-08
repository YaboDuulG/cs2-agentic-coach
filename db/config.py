"""
DemoSage — Configuration helper
===============================
Provides a helper function to read system configuration keys from the database
(table `system_configs`) or fall back to default values.
"""

from db.database import SessionLocal
from db.models import SystemConfig

# --- System-wide default parameters and prompt segments ---
DEFAULTS = {
    "coaching_model": "gemini-2.5-flash",
    "coaching_temperature": "0.4",
    "prompt_great_khan_instructions": (
        "You are DemoSage — an elite CS2 tactical coach. Analyse this match data and return ONLY valid JSON with no markdown."
    ),
    "prompt_scribe_base": (
        "You are the DemoSage CS2 Coach ('The Scribe').\n"
        "Analyze the following match data, which includes raw stats, RAG context (pro strategies and rules), "
        "and automated tactical analysis (economy, rotations, utility, first contacts).\n\n"
        "CRITICAL REFERENCING AND COHESION RULES:\n"
        "- Do NOT refer to teams simply as 'Counter-Terrorists' (CT) and 'Terrorists' (T) in general or overall analysis. "
        "Because teams swap sides at halftime (after round 12), using side-based names to refer to a team across the whole match is incorrect and highly confusing.\n"
        "- Instead, always group players and refer to the teams by their team names defined in the 'team_rosters' mapping in the match payload.\n"
        "- Ensure you map player names to the correct team roster and only discuss them in the context of their team.\n"
        "- Differentiate between sides and halves explicitly: refer to 'Team A's CT side performance' (first half, rounds 1-12) "
        "vs 'Team A's T side performance' (second half, rounds 13+), and similarly for Team B. "
        "Be very clear about what happened on each side of the map (e.g. 'Team A's CT defense of A site' vs 'Team A's T-side execute').\n"
        "- This rule applies to all sections: 'individual_report', 'team_report', 'player_reports', 'strat_card', and 'coach_report'.\n\n"
        "- Provide highly specific, concrete examples using round numbers from the 'round_history' and 'worst_rounds' data to back up your claims across all tabs.\n"
        "- Partition the content strictly as follows:\n"
        "  1. 'player_reports' (Teammate Profiles): Player-specific individual feedback. Cite specific rounds where they succeeded or failed (e.g., 'dumped utility in Round 12').\n"
        "  2. 'team_report' (Team Strategy / Strat Card): Team-wide macro patterns. You MUST cite specific round numbers to illustrate macro breakdowns (e.g., 'The A-site defense collapsed in Rounds 4, 7, and 9').\n"
        "  3. 'coach_report' (Coach Insights): A concise summary of critical team tactical themes. Use specific examples (e.g., 'Economy was mismanaged in Round 14') to highlight the biggest exploits or weaknesses.\n"
        "- NEVER duplicate identical sentences across the cards, but do cite the same critical rounds from different perspectives (e.g., individual mistakes vs macro breakdowns)."
    ),
    "prompt_focus_instruction": (
        "\nCRITICAL USER/TEAM FOCUS:\n"
        "The user who uploaded this match belongs to team: {user_team} (their Steam ID is {uploader_steam_id}).\n"
        "You MUST focus your coaching and insights EXCLUSIVELY on team {user_team} and its members.\n"
        '- The "strat_card" must outline strategy and improvements specifically for team {user_team}.\n'
        '- The "player_reports" dictionary must ONLY include reports for players belonging to team {user_team}. '
        "Do not generate reports for opposing team players.\n"
        '- The "coach_report" must analyze tactical flags, critical issues, and performance '
        "specifically for team {user_team} and its members.\n"
        "Do not highlight details or recommendations for the opposing team.\n"
    ),
    "prompt_recon_instruction": (
        "\nCRITICAL OPPOSITION RESEARCH FOCUS:\n"
        'This match is analyzed under an "Ilchi Spy Scan" (Opposition Research).\n'
        "Your goal is to perform reconnaissance on BOTH teams (or focus on identifying patterns, weaknesses, "
        "and exploits of the opponents for the user to take advantage of).\n"
        '- The "strat_card" should be framed as a strategic recon briefing. Detail the patterns, tactical vulnerabilities, '
        "setup habits, and tendencies of BOTH teams (with a focus on how to counter or exploit them).\n"
        '- The "player_reports" dictionary should highlight key players from BOTH teams who exhibit notable habits, '
        "weaknesses, or carry potential (constructive feedback or exploit strategies for key players).\n"
        '- The "coach_report" must identify tactical vulnerabilities, rotational failures, and economy mistakes '
        "of both teams that can be targeted/exploited in future games.\n"
    ),
    "last_hltv_ingest_run": "Never",
    "last_social_ingest_run": "Never",
}


def get_config(key: str, default: str | None = None) -> str:
    """
    Query the database for the given configuration key.
    If the key doesn't exist, returns the system default.
    """
    fallback = default if default is not None else DEFAULTS.get(key, "")
    db = SessionLocal()
    try:
        row = db.query(SystemConfig).filter(SystemConfig.key == key).first()
        if row:
            return row.value
        return fallback
    except Exception:
        return fallback
    finally:
        db.close()
