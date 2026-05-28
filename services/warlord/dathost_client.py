from datetime import UTC, datetime
import logging
import os
import secrets

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Valve Update Detection — Steam News API
# ---------------------------------------------------------------------------
# CS2 App ID on Steam
CS2_APP_ID = 730

# How long after a detected update we block provisioning (seconds).
# DatHost typically needs 30–90 min to apply an update across their fleet.
UPDATE_BLOCK_DURATION_SECONDS = int(os.getenv("UPDATE_BLOCK_DURATION_SECONDS", "7200"))  # 2 hours

# Keywords that identify a CS2 update news item (case-insensitive title match).
_UPDATE_TITLE_KEYWORDS = [
    "release notes",
    "cs2 update",
    "counter-strike update",
    "cs:go update",
    "game update",
]

# Simple in-process cache so we don't call Steam on every provision request.
# Structure: {"checked_at": datetime, "is_active": bool, "detail": str}
_update_cache: dict = {}
_CACHE_TTL_SECONDS = 600  # Re-check Steam API at most every 10 minutes


def check_cs2_update_active() -> tuple[bool, str]:
    """
    Queries the Steam News API for recent CS2 release notes.

    Returns:
        (is_active, detail_message)
        - is_active: True if a CS2 update was posted within UPDATE_BLOCK_DURATION_SECONDS
        - detail_message: Human-readable status string
    """
    global _update_cache
    now = datetime.now(UTC)

    # Serve from cache if fresh enough
    if _update_cache:
        age = (now - _update_cache["checked_at"]).total_seconds()
        if age < _CACHE_TTL_SECONDS:
            return _update_cache["is_active"], _update_cache["detail"]

    # Query Steam News API (no API key required)
    try:
        resp = requests.get(
            "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/",
            params={
                "appid": CS2_APP_ID,
                "count": 5,
                "maxlength": 200,
                "feeds": "steam_community_announcements",
            },
            timeout=8,
        )
        resp.raise_for_status()
        items = resp.json().get("appnews", {}).get("newsitems", [])
    except Exception as e:
        logger.warning(f"Steam News API unreachable: {e}. Skipping update guard.")
        # If Steam API is unreachable, fail open (allow provisioning)
        result = (False, "Steam News API unreachable — update status unknown")
        _update_cache = {"checked_at": now, **dict(zip(["is_active", "detail"], result))}
        return result

    is_active = False
    detail = "No recent CS2 update detected."

    for item in items:
        title = (item.get("title") or "").lower()
        post_time = item.get("date", 0)  # Unix timestamp

        # Check if it's an update announcement
        is_update = any(kw in title for kw in _UPDATE_TITLE_KEYWORDS)
        if not is_update:
            continue

        # Check if it's within our block window
        post_dt = datetime.fromtimestamp(post_time, tz=UTC)
        age_seconds = (now - post_dt).total_seconds()

        if 0 <= age_seconds <= UPDATE_BLOCK_DURATION_SECONDS:
            minutes_ago = int(age_seconds / 60)
            remaining = int((UPDATE_BLOCK_DURATION_SECONDS - age_seconds) / 60)
            detail = (
                f"CS2 update detected {minutes_ago}m ago: \"{item.get('title')}\". "
                f"Provisioning blocked for ~{remaining} more minutes while DatHost applies the update."
            )
            is_active = True
            logger.info(f"[UpdateGuard] Active — {detail}")
            break

    _update_cache = {"checked_at": now, "is_active": is_active, "detail": detail}
    return is_active, detail


def is_valve_update_window() -> bool:
    """Convenience wrapper — returns True if a recent CS2 update is blocking provisioning."""
    active, _ = check_cs2_update_active()
    return active


# ---------------------------------------------------------------------------
# Training Mode → server config mapping
# ---------------------------------------------------------------------------
# Each mode sets:
#   game_mode: competitive | deathmatch | casual | custom
#   start_map: recommended default map for that mode
#   extra_cmds: list of console commands to exec after start
# ---------------------------------------------------------------------------
TRAINING_MODE_CONFIGS: dict[str, dict] = {
    "practice": {
        "game_mode": "competitive",
        "start_map": "de_dust2",
        "extra_cmds": [
            "sv_cheats 1",
            "mp_warmuptime 60",
            "mp_freezetime 0",
            "sv_infinite_ammo 1",
            "mp_maxmoney 60000",
            "mp_startmoney 60000",
            "bot_kick",
        ],
        "description": "Free-form practice server with cheats and infinite ammo.",
    },
    "prefire": {
        "game_mode": "competitive",
        "start_map": "de_mirage",
        "extra_cmds": [
            "sv_cheats 1",
            "bot_kick",
            "mp_freezetime 0",
            "sv_infinite_ammo 1",
            "mp_roundtime_defuse 60",
            "mp_warmuptime 0",
        ],
        "description": "Prefire practice — solo competitive runs.",
    },
    "defense": {
        "game_mode": "competitive",
        "start_map": "de_dust2",
        "extra_cmds": [
            "sv_cheats 1",
            "mp_warmuptime 0",
            "mp_freezetime 3",
            "sv_infinite_ammo 1",
            "mp_startmoney 60000",
        ],
        "description": "Hold angles and practice defensive setups.",
    },
    "tradefire": {
        "game_mode": "deathmatch",
        "start_map": "de_inferno",
        "extra_cmds": [
            "sv_cheats 1",
            "mp_dm_bonus_length_max 0",
            "mp_dm_bonus_length_min 0",
            "sv_infinite_ammo 1",
        ],
        "description": "Trade-kill mechanics in deathmatch.",
    },
    "spray": {
        "game_mode": "deathmatch",
        "start_map": "de_dust2",
        "extra_cmds": [
            "sv_cheats 1",
            "sv_infinite_ammo 2",
            "weapon_recoil_scale 2",
            "mp_warmuptime 0",
        ],
        "description": "Spray pattern and transfer practice.",
    },
    "awp": {
        "game_mode": "deathmatch",
        "start_map": "de_dust2",
        "extra_cmds": [
            "sv_cheats 1",
            "sv_infinite_ammo 1",
            "mp_warmuptime 0",
            "mp_dm_bonus_length_max 0",
        ],
        "description": "AWP-only deathmatch for sniper training.",
    },
    "aimtrainer": {
        "game_mode": "deathmatch",
        "start_map": "de_shortdust",
        "extra_cmds": [
            "sv_cheats 1",
            "sv_infinite_ammo 1",
            "mp_warmuptime 0",
            "bot_difficulty 3",
        ],
        "description": "Aim trainer with hard bots.",
    },
    "promode": {
        "game_mode": "competitive",
        "start_map": "de_mirage",
        "extra_cmds": [
            "sv_cheats 0",
            "mp_warmuptime 30",
            "mp_freezetime 15",
            "mp_maxmoney 16000",
            "mp_startmoney 800",
        ],
        "description": "Standard competitive rules, no cheats.",
    },
    "grenade": {
        "game_mode": "competitive",
        "start_map": "de_mirage",
        "extra_cmds": [
            "sv_cheats 1",
            "sv_grenade_trajectory 1",
            "sv_grenade_trajectory_time 15",
            "sv_infinite_ammo 1",
            "mp_warmuptime 0",
            "mp_freezetime 0",
            "bot_kick",
        ],
        "description": "Grenade practice with trajectory visualization.",
    },
    "retake": {
        "game_mode": "competitive",
        "start_map": "de_inferno",
        "extra_cmds": [
            "sv_cheats 1",
            "mp_warmuptime 0",
            "mp_freezetime 3",
            "mp_startmoney 4000",
            "mp_maxmoney 8000",
        ],
        "description": "Post-plant retake scenarios.",
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def get_dathost_auth() -> tuple:
    email = os.environ.get("DATHOST_EMAIL")
    password = os.environ.get("DATHOST_PASSWORD") or os.environ.get("DATHOST_API_KEY")
    if not email or not password:
        raise ValueError(
            "DATHOST_EMAIL and DATHOST_PASSWORD (or DATHOST_API_KEY) must be configured in environment"
        )
    return (email.strip(), password.strip())


# ---------------------------------------------------------------------------
# Provisioning
# ---------------------------------------------------------------------------


def provision_practice_server(
    match_id: str,
    webhook_url: str,
    region: str = "dfw",
    mode: str = "practice",
    map_name: str | None = None,
) -> dict:
    """
    Creates and starts a DatHost CS2 server instance.

    Args:
        match_id:    Unique match/server ID used for naming.
        webhook_url: URL DatHost pings when the server is ready.
        region:      Region code — 'eu', 'na', 'dfw', 'fra', 'ord'.
        mode:        Training mode key from TRAINING_MODE_CONFIGS.
        map_name:    Optional map override (e.g. "de_mirage"). Falls back to
                     the mode's default start_map when None or empty.

    Raises:
        ValueError:  During Valve's Tuesday update window (Option A guard).
        ValueError:  If DatHost provisioning fails.
    """
    # --- Option A: Block provisioning during Valve's Tuesday update window ---
    if is_valve_update_window():
        now = datetime.now(UTC)
        raise ValueError(
            f"Server provisioning is temporarily blocked during Valve's Tuesday "
            f"maintenance window (21:00–01:00 UTC). Current UTC time: "
            f"{now.strftime('%A %H:%M')}. Please try again after 01:00 UTC Wednesday."
        )

    auth = get_dathost_auth()

    # Map region code → DatHost location slug
    location_map = {
        "eu": "dusseldorf",
        "na": "dallas",
        "dfw": "dallas",
        "fra": "dusseldorf",
        "ord": "chicago",
        "sea": "seattle",
        "sgp": "singapore",
        "syd": "sydney",
    }
    dathost_location = location_map.get(region, "dallas")

    # Resolve training mode config
    mode_cfg = TRAINING_MODE_CONFIGS.get(mode, TRAINING_MODE_CONFIGS["practice"])
    game_mode = mode_cfg["game_mode"]
    start_map = map_name if map_name else mode_cfg["start_map"]

    # Map game mode to DatHost-specific API values to prevent "Unknown game mode" validation errors
    # - cs2_settings: "deathmatch" -> "ffa_deathmatch"
    # - csgo_settings: "competitive" -> "classic_competitive"
    cs2_game_mode = "ffa_deathmatch" if game_mode == "deathmatch" else game_mode

    rcon_password = secrets.token_urlsafe(12)
    server_password = secrets.token_urlsafe(8)
    server_name = f"demosage-{mode[:6]}-{match_id[:8]}"

    # Build multipart/form-data payload for DatHost API
    payload = {
        "name": server_name,
        "game": "cs2",
        "location": dathost_location,
        # CS2-specific settings
        "cs2_settings.rcon": rcon_password,
        "cs2_settings.password": server_password,
        "cs2_settings.start_map": start_map,
        "cs2_settings.slots": "14",          # 10 players + 4 spectator slots
        "cs2_settings.game_mode": cs2_game_mode,
        "cs2_settings.autostart": "true",
    }

    try:
        # 1. Create the server
        logger.info(
            f"Creating DatHost CS2 server '{server_name}' in {dathost_location} "
            f"[mode={mode}, tickrate=128, game_mode={game_mode}]..."
        )
        multipart_data = {k: (None, str(v)) for k, v in payload.items()}
        response = requests.post(
            "https://dathost.net/api/0.1/game-servers", auth=auth, files=multipart_data
        )
        response.raise_for_status()
        server_data = response.json()
        dathost_id = server_data["id"]

        # 2. Resolve IP and port from creation response or a follow-up GET
        ip_address = server_data.get("ip")
        port = server_data.get("ports", {}).get("game")

        if not ip_address or not port:
            logger.info("IP/port not in creation response; querying server details...")
            details_r = requests.get(
                f"https://dathost.net/api/0.1/game-servers/{dathost_id}", auth=auth
            )
            details_r.raise_for_status()
            details = details_r.json()
            ip_address = details.get("ip")
            port = details.get("ports", {}).get("game")

        full_address = f"{ip_address}:{port}" if ip_address and port else None

        # 3. Start the server
        logger.info(f"Starting DatHost server {dathost_id}...")
        start_r = requests.post(
            f"https://dathost.net/api/0.1/game-servers/{dathost_id}/start", auth=auth
        )
        start_r.raise_for_status()

        # 4. Apply mode-specific console commands via RCON console endpoint
        extra_cmds = mode_cfg.get("extra_cmds", [])
        if extra_cmds:
            logger.info(f"Applying {len(extra_cmds)} mode config commands to {dathost_id}...")
            for cmd in extra_cmds:
                try:
                    requests.post(
                        f"https://dathost.net/api/0.1/game-servers/{dathost_id}/console",
                        auth=auth,
                        data={"line": cmd},
                    )
                except Exception as cmd_err:
                    logger.warning(f"Console cmd '{cmd}' failed (non-fatal): {cmd_err}")

        return {
            "vultr_id": dathost_id,       # Kept as vultr_id for DB column compat
            "ip_address": full_address,
            "rcon_password": rcon_password,
            "server_password": server_password,
            "mode": mode,
            "game_mode": game_mode,
            "tickrate": 128,
        }

    except requests.exceptions.RequestException as e:
        error_msg = e.response.text if (e.response is not None and e.response.text) else str(e)
        logger.error(f"Failed to provision DatHost server: {error_msg}")

        if "credits" in error_msg.lower() or "payment" in error_msg.lower():
            logger.warning("DatHost out of credits. Returning mock server for dev/demo purposes.")
            return {
                "vultr_id": f"mock-{match_id[:8]}",
                "ip_address": "127.0.0.1:27015",
                "rcon_password": rcon_password,
                "server_password": server_password,
                "mode": mode,
                "game_mode": game_mode,
                "tickrate": 128,
            }

        raise ValueError(f"DatHost provision failed: {error_msg}")


def destroy_practice_server(dathost_id: str):
    """Terminates and deletes the DatHost server instance."""
    auth = get_dathost_auth()
    try:
        logger.info(f"Stopping DatHost server {dathost_id}...")
        requests.post(f"https://dathost.net/api/0.1/game-servers/{dathost_id}/stop", auth=auth)

        logger.info(f"Deleting DatHost server {dathost_id}...")
        response = requests.delete(
            f"https://dathost.net/api/0.1/game-servers/{dathost_id}", auth=auth
        )
        response.raise_for_status()
        logger.info(f"Successfully destroyed DatHost server {dathost_id}")
    except requests.exceptions.RequestException as e:
        error_msg = e.response.text if e.response else str(e)
        logger.error(f"Failed to destroy DatHost server {dathost_id}: {error_msg}")


def get_available_modes() -> list[dict]:
    """Returns list of training modes with their metadata for the frontend."""
    return [
        {"key": key, "description": cfg["description"], "game_mode": cfg["game_mode"]}
        for key, cfg in TRAINING_MODE_CONFIGS.items()
    ]
