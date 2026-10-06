"""Module docstring."""
from fastapi import Depends
from sqlalchemy.orm import Session

from db.database import get_session

"""
FACEIT integration status.

The webhook receiver lives in api/routes/webhooks.py (`POST /api/webhooks/faceit`),
mounted without the user auth dependency because FACEIT is the caller and the
HMAC signature authenticates it. This router sits behind the auth dependency
and only reports configuration to the Settings UI.

Setup (FACEIT Developer Portal):
    1. Create a webhook subscription on your FACEIT hub/championship
    2. Point it at: https://<api-domain>/api/webhooks/faceit
    3. Set the secret and store it as FACEIT_WEBHOOK_SECRET

Environment variables:
    FACEIT_WEBHOOK_SECRET   - HMAC-SHA256 secret from the FACEIT developer portal
    FACEIT_API_KEY          - FACEIT server-side API key (fetching match details)
    FACEIT_AUTO_TEAM_ID     - Optional: auto-associate demos with this team_id
"""

import logging
import os

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter()

FACEIT_WEBHOOK_SECRET = os.getenv("FACEIT_WEBHOOK_SECRET", "")
FACEIT_API_KEY = os.getenv("FACEIT_API_KEY", "")
FACEIT_AUTO_TEAM_ID = os.getenv("FACEIT_AUTO_TEAM_ID")


# ---------------------------------------------------------------------------
# Connection status endpoint (for frontend settings page)
# ---------------------------------------------------------------------------


@router.get("/status")
def faceit_connection_status(db: Session = Depends(get_session)) -> dict:
    """Returns FACEIT integration config status (for the Settings UI)."""
    return {
        "webhook_configured": bool(FACEIT_WEBHOOK_SECRET),
        "api_key_configured": bool(FACEIT_API_KEY),
        "auto_team_id": FACEIT_AUTO_TEAM_ID,
        "webhook_url_path": "/api/webhooks/faceit",
    }
