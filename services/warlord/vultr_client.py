import os
import secrets
import logging
import base64
import requests

logger = logging.getLogger(__name__)

def get_vultr_headers() -> dict:
    api_key = os.environ.get("VULTR_API_KEY")
    if not api_key:
        raise ValueError("VULTR_API_KEY is not set")
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

def provision_practice_server(match_id: str, webhook_url: str, region: str = "dfw") -> dict:
    """Spins up a Vultr High-Frequency instance with CS2 Cloud Init."""
    
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
    
    encoded_user_data = base64.b64encode(user_data.encode("utf-8")).decode("utf-8")
    
    payload = {
        "region": region,
        "plan": "vhf-1c-2gb",  # Vultr High Frequency 1 vCPU, 2GB RAM
        "os_id": 2136,         # Ubuntu 22.04 LTS x64
        "label": f"demosage-prac-{match_id[:8]}",
        "user_data": encoded_user_data,
        "tags": ["demosage", "practice-server"]
    }
    
    try:
        response = requests.post(
            "https://api.vultr.com/v2/instances",
            headers=get_vultr_headers(),
            json=payload
        )
        response.raise_for_status()
        data = response.json()["instance"]
        
        # Vultr API returns the instance object. IP might be "0.0.0.0" while booting
        ip_address = data.get("main_ip")
        if ip_address == "0.0.0.0":
            ip_address = None
            
        logger.info(f"Started Vultr server {data['label']} in {region}")
        return {
            "vultr_id": data["id"],
            "ip_address": ip_address,
            "rcon_password": rcon_password,
            "server_password": server_password
        }
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to provision Vultr server: {e.response.text if e.response else str(e)}")
        raise

def destroy_practice_server(vultr_id: str):
    """Terminates the Vultr instance."""
    try:
        response = requests.delete(
            f"https://api.vultr.com/v2/instances/{vultr_id}",
            headers=get_vultr_headers()
        )
        response.raise_for_status()
        logger.info(f"Destroyed Vultr server {vultr_id}")
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to destroy Vultr server {vultr_id}: {e.response.text if e.response else str(e)}")
