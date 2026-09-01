"""
Register the /strat slash-command set with Discord (one-time per app,
re-run after changing the command definitions).

Usage:
    DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... python scripts/register_discord_commands.py

Registers globally (propagation can take up to an hour). Pass a guild id to
register instantly for one server while testing:
    python scripts/register_discord_commands.py <guild_id>
"""

import os
import sys

import httpx

STRAT_COMMAND = {
    "name": "strat",
    "description": "Team stratbook",
    "options": [
        {
            "type": 1,  # SUB_COMMAND
            "name": "bind",
            "description": "Bind this server to your DemoSage team",
            "options": [
                {"type": 3, "name": "code", "description": "Bind code from the web stratbook",
                 "required": True}
            ],
        },
        {
            "type": 1,
            "name": "create",
            "description": "Create a draft strat",
            "options": [
                {"type": 3, "name": "title", "description": "Strat name", "required": True},
                {"type": 3, "name": "map", "description": "Map (e.g. de_mirage)", "required": True},
                {"type": 3, "name": "side", "description": "T or CT", "required": False,
                 "choices": [{"name": "T", "value": "T"}, {"name": "CT", "value": "CT"}]},
                {"type": 3, "name": "buy", "description": "Buy type", "required": False,
                 "choices": [{"name": n, "value": n} for n in
                             ("pistol", "eco", "force_buy", "full_buy")]},
            ],
        },
        {
            "type": 1,
            "name": "view",
            "description": "List strats for a map",
            "options": [
                {"type": 3, "name": "map", "description": "Map name", "required": True},
                {"type": 3, "name": "name", "description": "Strat title filter", "required": False},
            ],
        },
        {
            "type": 1,
            "name": "analyze",
            "description": "Show coaching findings for a round",
            "options": [
                {"type": 3, "name": "round_id",
                 "description": "Round number, or match_id:round", "required": True}
            ],
        },
        {
            "type": 1,
            "name": "adapt",
            "description": "Ask the Strat Assistant to adapt this thread's strat",
            "options": [
                {"type": 3, "name": "prompt",
                 "description": "e.g. adapt this A-execute for a 4v5", "required": True}
            ],
        },
    ],
}


def main() -> None:
    """Docstring for main."""
    app_id = os.environ.get("DISCORD_APP_ID")
    token = os.environ.get("DISCORD_BOT_TOKEN")
    if not app_id or not token:
        sys.exit("Set DISCORD_APP_ID and DISCORD_BOT_TOKEN in the environment first.")

    guild_id = sys.argv[1] if len(sys.argv) > 1 else None
    path = (
        f"/applications/{app_id}/guilds/{guild_id}/commands"
        if guild_id
        else f"/applications/{app_id}/commands"
    )
    resp = httpx.put(
        f"https://discord.com/api/v10{path}",
        json=[STRAT_COMMAND],
        headers={"Authorization": f"Bot {token}"},
        timeout=30,
    )
    resp.raise_for_status()
    scope = f"guild {guild_id}" if guild_id else "global (may take up to 1h to propagate)"
    print(f"Registered /strat ({len(STRAT_COMMAND['options'])} subcommands) — {scope}")


if __name__ == "__main__":
    main()
