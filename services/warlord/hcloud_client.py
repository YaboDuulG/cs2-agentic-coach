import os
import secrets
import logging
from hcloud import Client
from hcloud.server_types.domain import ServerType
from hcloud.images.domain import Image
from hcloud.locations.domain import Location

logger = logging.getLogger(__name__)

def get_hcloud_client() -> Client:
    token = os.environ.get("HETZNER_API_TOKEN")
    if not token:
        raise ValueError("HETZNER_API_TOKEN is not set")
    return Client(token=token)

def provision_practice_server(match_id: str, webhook_url: str, region: str = "ash") -> dict:
    """Spins up a Hetzner server with CS2 Cloud Init."""
    client = get_hcloud_client()
    
    server_type_name = os.environ.get("HETZNER_SERVER_TYPE", "cx22")
    location_name = region # e.g. 'ash' or 'hil'


    
    # RCON and joining passwords
    rcon_password = secrets.token_urlsafe(12)
    server_password = secrets.token_urlsafe(8)
    
    # Read and template cloud-init
    cloud_init_path = os.path.join(os.path.dirname(__file__), "cloud_init.yaml")
    with open(cloud_init_path, "r") as f:
        user_data = f.read()
        
    user_data = user_data.replace("__RCON_PASSWORD__", rcon_password)
    user_data = user_data.replace("__SERVER_PASSWORD__", server_password)
    user_data = user_data.replace("__SERVER_ID__", match_id)
    user_data = user_data.replace("__WEBHOOK_URL__", webhook_url)
    
    try:
        response = client.servers.create(
            name=f"demosage-prac-{match_id[:8]}",
            server_type=ServerType(name=server_type_name),
            image=Image(name="ubuntu-24.04"),
            location=Location(name=location_name),
            user_data=user_data,
            labels={"app": "demosage", "role": "practice-server", "server_id": match_id}
        )
        server = response.server
        
        logger.info(f"Started Hetzner server {server.name} (IP: {server.public_net.ipv4.ip})")
        return {
            "hetzner_id": server.id,
            "ip_address": server.public_net.ipv4.ip,
            "rcon_password": rcon_password,
            "server_password": server_password
        }
    except Exception as e:
        logger.error(f"Failed to provision Hetzner server: {e}")
        raise

def destroy_practice_server(hetzner_id: int):
    """Terminates the Hetzner instance."""
    client = get_hcloud_client()
    try:
        server = client.servers.get_by_id(hetzner_id)
        if server:
            server.delete()
            logger.info(f"Destroyed Hetzner server {hetzner_id}")
    except Exception as e:
        logger.error(f"Failed to destroy Hetzner server {hetzner_id}: {e}")
