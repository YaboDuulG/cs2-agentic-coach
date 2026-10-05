"""
Discord doctor: is the live integration wired end to end?
==========================================================
Read-only. Checks the local settings, the Discord application, the registered
slash commands, the deployed interactions endpoint and (with --guild) the
channel group of a server. Prints one PASS/FAIL line per check and exits 1 on
any FAIL.

Usage:
    python scripts/discord_doctor.py                       # settings + app + endpoint
    python scripts/discord_doctor.py --guild <guild_id>    # plus commands and channels there
    python scripts/discord_doctor.py --api http://localhost:8000

Settings are read from the environment, then from the repo's .env. Needed:
DISCORD_APP_ID, DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN, DISCORD_WEBHOOK_SECRET.
"""

import argparse
from dataclasses import dataclass
import os
from pathlib import Path
import sys
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.register_discord_commands import STRAT_COMMAND  # noqa: E402
from services.discord_bot.channels import (  # noqa: E402
    GUILD_CATEGORY,
    GUILD_TEXT,
    map_from_name,
)

DISCORD_API = "https://discord.com/api/v10"
DEFAULT_API = "https://demosage-api-staging-dsr6wo6mta-uc.a.run.app"
REQUIRED = ("DISCORD_APP_ID", "DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN", "DISCORD_WEBHOOK_SECRET")
# View Channels, Send Messages, Create Public Threads, Send Messages in Threads,
# Embed Links, Read Message History (for /strat ingest)
BOT_PERMISSIONS = 1024 | 2048 | 34359738368 | 274877906944 | 16384 | 65536
# Application flags: the Message Content intent, full or limited (<100 servers).
MESSAGE_CONTENT_FLAGS = (1 << 18) | (1 << 19)


@dataclass
class Check:
    """One line of the report."""

    name: str
    ok: bool
    detail: str = ""

    def line(self) -> str:
        """Docstring for line."""
        return f"{'PASS' if self.ok else 'FAIL'}  {self.name}" + (f": {self.detail}" if self.detail else "")


def load_env_file(path: Path) -> dict[str, str]:
    """KEY=value lines of a .env file; no interpolation, quotes stripped."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def check_env(env: dict[str, str]) -> list[Check]:
    """Every setting present and shaped right. Values are never printed."""
    checks = []
    for name in REQUIRED:
        value = env.get(name, "")
        placeholder = value.startswith("your-") or value.startswith("pick_any")
        checks.append(Check(f"{name} is set", bool(value) and not placeholder,
                            "" if value and not placeholder else "missing or still the .env.example placeholder"))
    key = env.get("DISCORD_PUBLIC_KEY", "")
    if key:
        is_hex = len(key) == 64 and all(c in "0123456789abcdefABCDEF" for c in key)
        checks.append(Check("DISCORD_PUBLIC_KEY is 64 hex characters", is_hex,
                            "" if is_hex else f"got {len(key)} characters"))
    return checks


def check_application(app: dict[str, Any], env: dict[str, str], api_url: str) -> list[Check]:
    """The Discord application matches our settings and points at our API."""
    expected_url = f"{api_url.rstrip('/')}/api/discord/interactions"
    endpoint = app.get("interactions_endpoint_url") or ""
    return [
        Check("bot token belongs to DISCORD_APP_ID", str(app.get("id")) == env.get("DISCORD_APP_ID"),
              f"token is for application {app.get('id')}"),
        Check("public key matches the application", (app.get("verify_key") or "").lower() == env.get("DISCORD_PUBLIC_KEY", "").lower(),
              "" if (app.get("verify_key") or "").lower() == env.get("DISCORD_PUBLIC_KEY", "").lower()
              else "DISCORD_PUBLIC_KEY is not this application's public key"),
        Check("Interactions Endpoint URL points at the API", endpoint == expected_url,
              endpoint or f"not set in the developer portal; expected {expected_url}"),
        Check("Message Content intent is on (needed by /strat ingest)",
              bool(int(app.get("flags") or 0) & MESSAGE_CONTENT_FLAGS),
              "" if int(app.get("flags") or 0) & MESSAGE_CONTENT_FLAGS
              else "enable it under Bot → Privileged Gateway Intents; without it message history comes back empty"),
    ]


def check_commands(registered: list[dict[str, Any]], scope: str) -> Check:
    """/strat is registered with every subcommand the handler implements."""
    strat = next((c for c in registered if c.get("name") == "strat"), None)
    if strat is None:
        return Check(f"/strat registered ({scope})", False, "run scripts/register_discord_commands.py")
    have = {o.get("name") for o in strat.get("options") or []}
    want = {o["name"] for o in STRAT_COMMAND["options"]}
    missing = sorted(want - have)
    return Check(f"/strat registered ({scope})", not missing,
                 f"subcommands: {', '.join(sorted(have))}" if not missing
                 else f"missing {', '.join(missing)}; re-run scripts/register_discord_commands.py")


def check_endpoint(status: int, body: str) -> Check:
    """An unsigned PING must be refused BY SIGNATURE: that proves the deployed
    API has the public key. 401 for a missing key means the secret is not on
    the service."""
    name = "deployed endpoint verifies signatures"
    if status == 401 and "Bad request signature" in body:
        return Check(name, True, "unsigned request refused")
    if status == 401 and "not configured" in body:
        return Check(name, False, "DISCORD_PUBLIC_KEY is not set on the API service")
    if status == 200:
        return Check(name, False, "an unsigned request was ACCEPTED; the API is in LOCAL_MODE or has no public key")
    return Check(name, False, f"unexpected {status}: {body[:120]}")


def describe_channels(channels: list[dict[str, Any]]) -> tuple[Check, list[str]]:
    """Which category would be bound and which of its channels map to maps."""
    categories = {str(c["id"]): c.get("name", "?") for c in channels if c.get("type") == GUILD_CATEGORY}
    lines: list[str] = []
    best = 0
    for category_id, category_name in categories.items():
        mapped = [(c.get("name", ""), map_from_name(c.get("name")))
                  for c in channels
                  if c.get("type") == GUILD_TEXT and str(c.get("parent_id") or "") == category_id]
        hits = [(n, m) for n, m in mapped if m]
        if hits:
            lines.append(f"      group '{category_name}' ({category_id}): "
                         + ", ".join(f"#{n} -> {m}" for n, m in hits))
            skipped = [n for n, m in mapped if not m]
            if skipped:
                lines.append(f"        not a map (ignored): {', '.join('#' + n for n in skipped)}")
        best = max(best, len(hits))
    ok = best > 0
    return (Check("a channel group with map channels exists", ok,
                  f"{best} map channels in the best group" if ok
                  else "no category has channels named after maps (mirage, inferno, dust2, ...)"), lines)


def invite_url(app_id: str) -> str:
    """Docstring for invite_url."""
    return (f"https://discord.com/oauth2/authorize?client_id={app_id}"
            f"&scope=bot+applications.commands&permissions={BOT_PERMISSIONS}")


def main() -> int:
    """Docstring for main."""
    import httpx  # noqa: PLC0415

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--guild", help="Discord server id: also check its commands and channels")
    parser.add_argument("--api", default=os.environ.get("DEMOSAGE_API_URL", DEFAULT_API))
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    env = {**load_env_file(root / ".env"), **{k: v for k, v in os.environ.items() if k.startswith("DISCORD_")}}

    checks = check_env(env)
    notes: list[str] = []
    token, app_id = env.get("DISCORD_BOT_TOKEN", ""), env.get("DISCORD_APP_ID", "")
    headers = {"Authorization": f"Bot {token}"}

    try:
        r = httpx.post(f"{args.api.rstrip('/')}/api/discord/interactions", json={"type": 1}, timeout=20)
        checks.append(check_endpoint(r.status_code, r.text))
    except httpx.HTTPError as e:
        checks.append(Check("deployed endpoint verifies signatures", False, f"unreachable: {e}"))

    if all(c.ok for c in checks[: len(REQUIRED)]):
        app = httpx.get(f"{DISCORD_API}/applications/@me", headers=headers, timeout=20)
        if app.status_code != 200:
            checks.append(Check("bot token is valid", False, f"Discord answered {app.status_code}"))
        else:
            checks.append(Check("bot token is valid", True, f"application '{app.json().get('name')}'"))
            checks.extend(check_application(app.json(), env, args.api))
            cmds = httpx.get(f"{DISCORD_API}/applications/{app_id}/commands", headers=headers, timeout=20)
            global_check = check_commands(cmds.json() if cmds.status_code == 200 else [], "global")
            if args.guild:
                g = httpx.get(f"{DISCORD_API}/applications/{app_id}/guilds/{args.guild}/commands", headers=headers, timeout=20)
                guild_check = check_commands(g.json() if g.status_code == 200 else [], f"guild {args.guild}")
                # Either registration is enough for that server.
                checks.append(guild_check if guild_check.ok or not global_check.ok else global_check)
                ch = httpx.get(f"{DISCORD_API}/guilds/{args.guild}/channels", headers=headers, timeout=20)
                if ch.status_code != 200:
                    checks.append(Check("bot is in the server", False,
                                        f"Discord answered {ch.status_code}; invite it: {invite_url(app_id)}"))
                else:
                    checks.append(Check("bot is in the server", True, f"{len(ch.json())} channels visible"))
                    check, lines = describe_channels(ch.json())
                    checks.append(check)
                    notes.extend(lines)
            else:
                checks.append(global_check)
    else:
        notes.append("      Discord checks skipped until the settings above are filled in.")

    for c in checks:
        print(c.line())
    for n in notes:
        print(n)
    failed = [c for c in checks if not c.ok]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} checks passed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
