import logging
import os
import requests
import secrets

logger = logging.getLogger(__name__)


def get_dathost_auth() -> tuple:
    email = os.environ.get("DATHOST_EMAIL")
    password = os.environ.get("DATHOST_PASSWORD") or os.environ.get("DATHOST_API_KEY")
    if not email or not password:
        raise ValueError("DATHOST_EMAIL and DATHOST_PASSWORD (or DATHOST_API_KEY) must be configured in environment")
    return (email.strip(), password.strip())


def provision_practice_server(match_id: str, webhook_url: str, region: str = "dfw") -> dict:
    """Creates and starts a DatHost CS2 server instance."""
    auth = get_dathost_auth()

    # Map region code to DatHost API locations
    location_map = {
        "eu": "dusseldorf",
        "na": "dallas",
        "dfw": "dallas",
        "fra": "dusseldorf",
        "ord": "chicago",
    }
    dathost_location = location_map.get(region, "dallas")

    rcon_password = secrets.token_urlsafe(12)
    server_password = secrets.token_urlsafe(8)
    server_name = f"demosage-prac-{match_id[:8]}"

    # Use multipart/form-data payload as expected by DatHost API
    # Support both cs2_settings and csgo_settings prefixes for schema safety
    payload = {
        "name": server_name,
        "game": "cs2",
        "location": dathost_location,
        "cs2_settings.rcon": rcon_password,
        "cs2_settings.password": server_password,
        "cs2_settings.start_map": "de_dust2",
        "cs2_settings.slots": "14",
        "csgo_settings.rcon": rcon_password,
        "csgo_settings.password": server_password,
        "csgo_settings.start_map": "de_dust2",
        "csgo_settings.slots": "14",
    }

    try:
        # 1. Create the server
        logger.info(f"Creating DatHost server '{server_name}' in {dathost_location}...")
        response = requests.post(
            "https://dathost.net/api/0.1/game-servers",
            auth=auth,
            data=payload
        )
        response.raise_for_status()
        server_data = response.json()
        dathost_id = server_data["id"]

        # 2. Get server IP and Port
        ip_address = server_data.get("ip")
        port = server_data.get("ports", {}).get("game")
        
        # If IP or port are not in creation response, query the server details
        if not ip_address or not port:
            logger.info("IP or port not in creation response. Querying server details...")
            details_r = requests.get(
                f"https://dathost.net/api/0.1/game-servers/{dathost_id}",
                auth=auth
            )
            details_r.raise_for_status()
            details = details_r.json()
            ip_address = details.get("ip")
            port = details.get("ports", {}).get("game")

        full_address = f"{ip_address}:{port}" if ip_address and port else None

        # 3. Start the server
        logger.info(f"Starting DatHost server {dathost_id}...")
        start_r = requests.post(
            f"https://dathost.net/api/0.1/game-servers/{dathost_id}/start",
            auth=auth
        )
        start_r.raise_for_status()

        return {
            "vultr_id": dathost_id,  # Kept as vultr_id for schema/DB column compatibility
            "ip_address": full_address,
            "rcon_password": rcon_password,
            "server_password": server_password,
        }

    except requests.exceptions.RequestException as e:
        error_msg = e.response.text if e.response else str(e)
        logger.error(f"Failed to provision DatHost server: {error_msg}")
        raise ValueError(f"DatHost provision failed: {error_msg}")


def destroy_practice_server(dathost_id: str):
    """Terminates and deletes the DatHost server instance."""
    auth = get_dathost_auth()
    try:
        # First stop the server to be clean
        logger.info(f"Stopping DatHost server {dathost_id}...")
        requests.post(
            f"https://dathost.net/api/0.1/game-servers/{dathost_id}/stop",
            auth=auth
        )
        
        # Delete the server
        logger.info(f"Deleting DatHost server {dathost_id}...")
        response = requests.delete(
            f"https://dathost.net/api/0.1/game-servers/{dathost_id}",
            auth=auth
        )
        response.raise_for_status()
        logger.info(f"Successfully destroyed DatHost server {dathost_id}")
    except requests.exceptions.RequestException as e:
        error_msg = e.response.text if e.response else str(e)
        logger.error(f"Failed to destroy DatHost server {dathost_id}: {error_msg}")
