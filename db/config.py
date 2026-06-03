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
        "and automated tactical analysis (economy, rotations, utility, first contacts)."
    ),
    "prompt_focus_instruction": (
        "\nCRITICAL USER/TEAM FOCUS:\n"
        "The user who uploaded this match belongs to team: {user_team} (their Steam ID is {uploader_steam_id}).\n"
        "You MUST focus your coaching and insights EXCLUSIVELY on team {user_team} and its members.\n"
        "- The \"strat_card\" must outline strategy and improvements specifically for team {user_team}.\n"
        "- The \"player_reports\" dictionary must ONLY include reports for players belonging to team {user_team}. "
        "Do not generate reports for opposing team players.\n"
        "- The \"coach_report\" must analyze tactical flags, critical issues, and performance "
        "specifically for team {user_team} and its members.\n"
        "Do not highlight details or recommendations for the opposing team.\n"
    ),
    "prompt_recon_instruction": (
        "\nCRITICAL OPPOSITION RESEARCH FOCUS:\n"
        "This match is analyzed under an \"Ilchi Spy Scan\" (Opposition Research).\n"
        "Your goal is to perform reconnaissance on BOTH teams (or focus on identifying patterns, weaknesses, "
        "and exploits of the opponents for the user to take advantage of).\n"
        "- The \"strat_card\" should be framed as a strategic recon briefing. Detail the patterns, tactical vulnerabilities, "
        "setup habits, and tendencies of BOTH teams (with a focus on how to counter or exploit them).\n"
        "- The \"player_reports\" dictionary should highlight key players from BOTH teams who exhibit notable habits, "
        "weaknesses, or carry potential (constructive feedback or exploit strategies for key players).\n"
        "- The \"coach_report\" must identify tactical vulnerabilities, rotational failures, and economy mistakes "
        "of both teams that can be targeted/exploited in future games.\n"
    )
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
