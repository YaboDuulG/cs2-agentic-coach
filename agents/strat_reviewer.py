"""
Strat Reviewer Agent — Critiques custom drawn user/team strategies against professional playbooks.
"""

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


async def critique_strategy(strategy_json: str, map_name: str) -> dict[str, Any]:
    """
    Takes the JSON payload from the frontend Stratbook (containing drawn lines and markers),
    and compares it to the professional baseline MapPlaybook to generate a critique.
    """
    import os

    from google import genai

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("No Gemini API key found for Strat Reviewer.")
        return {"critique": "AI coaching requires GEMINI_API_KEY to be configured."}

    client = genai.Client(api_key=api_key)

    # 1. Fetch Map Playbook
    from db.database import SessionLocal
    from db.models import MapPlaybook

    db = SessionLocal()
    map_playbook = {}
    try:
        # Match both exact name and "de_" prefix
        pb = db.query(MapPlaybook).filter_by(map_name=map_name).first()
        if not pb and not map_name.startswith("de_"):
            pb = db.query(MapPlaybook).filter_by(map_name=f"de_{map_name}").first()
        if pb:
            map_playbook = json.loads(pb.playbook_json)
    except Exception as e:
        logger.warning(f"Could not load map playbook for critique: {e}")
    finally:
        db.close()

    # 2. Compile Prompt
    prompt = f"""
    You are an elite CS2 tactical coach. The user has drawn a custom strategy on a 2D tactical board for the map {map_name}.

    Here is the baseline professional playbook for {map_name}:
    {json.dumps(map_playbook, indent=2)}

    Here is the JSON representation of the user's drawn strategy (including markers for players, smokes, flashes, and drawn lines):
    {strategy_json}

    Analyze the user's strategy and provide a constructive, tactical critique.
    Point out any glaring vulnerabilities (e.g. missing a crucial smoke, leaving a choke point exposed) based on standard professional meta.
    Keep the response concise, formatted in Markdown, and structured logically.
    """

    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        return {"critique": response.text}
    except Exception as e:
        logger.error(f"Strategy critique failed: {e}")
        return {"critique": "Failed to generate critique due to an internal error."}
