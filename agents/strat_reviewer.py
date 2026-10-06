"""
Strat Reviewer Agent — critiques a drawn strat against what a complete,
callable strat has to contain, and against the map's playbook.

A strat is a plan for five players with a trigger, a buy, timed utility and
a contingency. A single lineup or a movement tip is not one; the reviewer
says so instead of grading it as if it were.
"""

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# What a strat has to answer before a team can call it. The critique is
# organised around these, in this order.
STRAT_TEMPLATE = """
1. Identity: map, side (T/CT), objective (site, control, retake, default).
2. Buy requirement: pistol / eco / force / full, and what it needs (how many
   smokes, flashes, mollies; AWP yes/no).
3. Roles for all five players: who entries, who trades, who lurks or anchors,
   who throws what. Every player has a job.
4. Timing: the trigger (on round start, after mid control, at 1:10, on a
   call) and the order of events.
5. Utility: each grenade with thrower, lineup or spot, and purpose.
6. Execution: numbered steps from the trigger to the plant or the hold.
7. Contingencies: "if X, then Y" for the two or three likely counters
   (a stack, an early pick, utility coming back, a bomb-site fake).
8. What beats it, and when not to call it (economy, score, read on the enemy).
"""


async def critique_strategy(strategy_json: str, map_name: str) -> dict[str, Any]:
    """Critique the board JSON from the stratbook (lines and markers) against
    STRAT_TEMPLATE and the map's playbook. Returns {"critique": markdown}."""
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
    map_playbook: dict[str, Any] = {}
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

    playbook_text = (
        json.dumps(map_playbook, indent=2)
        if map_playbook
        else "(no playbook on file for this map: judge against the standard competitive meta and say so)"
    )

    # 2. Compile Prompt
    prompt = f"""
You are a CS2 coach reviewing a strat a team drew on a 2D board for {map_name}.
The board JSON has markers (CT, T, smoke, flash, he, molotov, each with x/y in
0..1 radar space and an optional label) and lines (paths). Read positions from
the markers, movement from the lines, and callouts from labels.

The team's board:
{strategy_json}

The map's playbook (pro-derived setups and defaults):
{playbook_text}

A strat must answer all of this before a team can call it:
{STRAT_TEMPLATE}

Write the review in Markdown with exactly these sections:

## Verdict
One line: "Strat", "Half a strat" or "Not a strat (tip / lineup / mechanic)".
A drawing that needs only one player (a single lineup, a peek, a movement
trick) is a tip, not a strat: say that, say where it belongs (a lineup list
or a fundamentals note), and keep the rest short.

## What the board says
Two or three sentences: side, objective, which players go where, which
utility is drawn. Only what is on the board; do not invent players or nades.

## Missing from the template
A checklist of the eight template items. For each: ✓ with what the board
shows, or ✗ with the one question the team has to answer (e.g. "✗ Buy: this
needs 3 smokes + 2 flashes, is it a full buy only?"). Be concrete; no
generic advice.

## Holes a good team punishes
The two or three biggest problems, each as: what the enemy does → what
happens to this strat → the fix (a specific nade, timing or role change).
Cite the playbook when it has the relevant setup; say when it does not.

## Call it when / don't call it when
Two short bullet lists: the economy, score and read that make this the right
call, and the situations where it is a mistake.

Keep it under 350 words. Use the team's own labels. Never praise for its own
sake; a strong strat gets a short review, not a longer one.
"""

    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        from services.billing.metering import record_usage  # noqa: PLC0415

        record_usage(response, model="gemini-2.5-flash", purpose="critique")
        return {"critique": response.text}
    except Exception as e:
        logger.error(f"Strategy critique failed: {e}")
        return {"critique": "Failed to generate critique due to an internal error."}
