"""RCON transport plus the command policy that sits in front of it.

Two callers, two policies:

- the Warlord agent turns natural language into commands with an LLM. That
  output is untrusted, so it runs under the **allowlist**: only practice
  commands we know are harmless to the team's own server;
- the practice-server console on the web runs what a team member typed. That
  is their server, so it runs under the **denylist**: anything except the
  commands that would lock the team out or hand the server to someone else.
"""

import asyncio
import logging
import re

from rcon.source import Client

logger = logging.getLogger("warlord.rcon")

# Commands the LLM path may issue, by their first word. Values are either
# None (any arguments) or a regex every argument string must match.
ALLOWED_COMMANDS: dict[str, str | None] = {
    # match flow
    "mp_pause_match": None,
    "mp_unpause_match": None,
    "mp_restartgame": r"^\d{0,3}$",
    "mp_warmup_start": None,
    "mp_warmup_end": None,
    "mp_warmup_pausetimer": r"^[01]$",
    "mp_warmuptime": r"^\d{1,4}$",
    "mp_freezetime": r"^\d{1,3}$",
    "mp_roundtime": r"^\d{1,3}(\.\d+)?$",
    "mp_roundtime_defuse": r"^\d{1,3}(\.\d+)?$",
    "mp_maxrounds": r"^\d{1,3}$",
    "mp_overtime_enable": r"^[01]$",
    "mp_startmoney": r"^\d{1,5}$",
    "mp_maxmoney": r"^\d{1,5}$",
    "mp_buytime": r"^\d{1,5}$",
    "mp_buy_anywhere": r"^[012]$",
    "mp_autoteambalance": r"^[01]$",
    "mp_limitteams": r"^\d{1,2}$",
    "mp_respawn_on_death_ct": r"^[01]$",
    "mp_respawn_on_death_t": r"^[01]$",
    "mp_death_drop_gun": r"^[012]$",
    "mp_death_drop_grenade": r"^[0123]$",
    "mp_death_drop_defuser": r"^[01]$",
    "mp_randomspawn": r"^[012]$",
    "mp_warmup_offline_enabled": r"^[01]$",
    # practice toggles
    "sv_cheats": r"^[01]$",
    "sv_infinite_ammo": r"^[012]$",
    "sv_grenade_trajectory_prac_pipreview": r"^[01]$",
    "sv_grenade_trajectory_prac_trailtime": r"^\d{1,3}$",
    "sv_showimpacts": r"^[0123]$",
    "sv_showimpacts_time": r"^\d{1,3}$",
    "ammo_grenade_limit_total": r"^\d{1,2}$",
    "mp_drop_knife_enable": r"^[01]$",
    "mp_damage_headshot_only": r"^[01]$",
    # bots
    "bot_kick": r"^(all|ct|t)?$",
    "bot_add": r"^(ct|t)?$",
    "bot_add_ct": r"^$",
    "bot_add_t": r"^$",
    "bot_stop": r"^[01]$",
    "bot_freeze": r"^[01]$",
    "bot_mimic": r"^\d{1,2}$",
    "bot_crouch": r"^[01]$",
    "bot_place": r"^$",
    "bot_quota": r"^\d{1,2}$",
    "bot_difficulty": r"^[0-3]$",
    "bot_dont_shoot": r"^[01]$",
    # map and chat
    "changelevel": r"^(de|cs|ar|aim|awp)_[a-z0-9_]{1,40}$",
    "map": r"^(de|cs|ar|aim|awp)_[a-z0-9_]{1,40}$",
    "say": None,
    "status": r"^$",
    "exec": r"^[a-z0-9_\-]{1,40}(\.cfg)?$",
}

# Never over RCON from our side, whoever asks: these lock the team out, hand
# the server to someone else, or change where it talks to.
DENIED_PREFIXES: tuple[str, ...] = (
    "quit", "exit", "_restart", "shutdown", "crash", "killserver",
    "rcon_password", "sv_password", "sv_rcon", "sv_lan", "sv_setsteamaccount",
    "host_", "net_", "ip ", "hostport", "clientport", "tv_",
    "sv_downloadurl", "sv_allowupload", "sv_allowdownload", "sv_pure",
    "logaddress", "log ", "con_logfile", "writeconfig", "writeid", "writeip",
    "banid", "addip", "removeid", "removeip", "kickid", "kick ",
    "sv_cheats_", "plugin_", "meta ", "css_", "sm_", "exec autoexec", "exec server",
)

_MAX_COMMAND_LEN = 120


def _split(command: str) -> tuple[str, str]:
    """("mp_pause_match", "") / ("changelevel", "de_mirage")."""
    parts = command.strip().split(None, 1)
    if not parts:
        return "", ""
    return parts[0].lower(), (parts[1].strip() if len(parts) > 1 else "")


def is_denied(command: str) -> bool:
    """True for commands no caller may run through us."""
    lowered = command.strip().lower()
    name, _ = _split(lowered)
    return any(lowered.startswith(p) or name == p.strip() for p in DENIED_PREFIXES)


def check_command(command: str, *, strict: bool) -> str | None:
    """Why a command is refused, or None when it may run. ``strict`` is the
    allowlist (LLM output); otherwise only the denylist applies (a person at
    the console of their own server)."""
    text = command.strip()
    if not text or len(text) > _MAX_COMMAND_LEN:
        return "empty or too long"
    if "\n" in text or "\r" in text or ";" in text:
        return "one command per line, no chaining"
    if is_denied(text):
        return "not allowed through DemoSage"
    if not strict:
        return None
    name, args = _split(text)
    pattern = ALLOWED_COMMANDS.get(name, "__missing__")
    if pattern == "__missing__":
        return "not a known practice command"
    if pattern is not None and not re.fullmatch(pattern, args):
        return f"bad argument for {name}"
    return None


def filter_commands(commands: list[str], *, strict: bool = True) -> tuple[list[str], list[tuple[str, str]]]:
    """(commands that may run, [(command, reason) refused])."""
    allowed: list[str] = []
    refused: list[tuple[str, str]] = []
    for raw in commands:
        if not isinstance(raw, str):
            refused.append((str(raw), "not a string"))
            continue
        reason = check_command(raw, strict=strict)
        if reason is None:
            allowed.append(raw.strip())
        else:
            refused.append((raw.strip(), reason))
    return allowed, refused


async def send_rcon_command(host: str, port: int, password: str, command: str) -> str:
    """Sends one RCON command (denylist applies) to a Source server."""
    reason = check_command(command, strict=False)
    if reason is not None:
        raise ValueError(f"Refused RCON command {command!r}: {reason}")

    def _run():
        """Docstring for _run."""
        try:
            with Client(host, port, passwd=password, timeout=5.0) as client:
                return client.run(command.strip())
        except Exception as e:
            logger.error(f"RCON Error to {host}:{port}: {e}")
            raise

    logger.info(f"[RCON] -> {host}:{port} | Cmd: {command}")
    return await asyncio.to_thread(_run)


async def execute_batch_commands(
    host: str, port: int, password: str, commands: list[str], *, strict: bool = True
) -> list[str]:
    """Executes commands sequentially. Every command is checked first (the
    allowlist by default); one refused command refuses the whole batch so a
    half-applied practice config never happens."""
    _, refused = filter_commands(commands, strict=strict)
    if refused:
        detail = "; ".join(f"{cmd!r} ({why})" for cmd, why in refused)
        raise ValueError(f"Refused RCON batch: {detail}")

    results: list[str] = []

    def _run_batch():
        """Docstring for _run_batch."""
        try:
            with Client(host, port, passwd=password, timeout=8.0) as client:
                for cmd in commands:
                    logger.info(f"[RCON Batch] -> {host}:{port} | Cmd: {cmd}")
                    results.append(client.run(cmd.strip()))
        except Exception as e:
            logger.error(f"RCON Batch Error to {host}:{port}: {e}")
            raise

    await asyncio.to_thread(_run_batch)
    return results
