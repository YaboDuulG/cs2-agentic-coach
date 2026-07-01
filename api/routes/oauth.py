"""
Steam + FACEIT OAuth Routes
============================
Steam uses OpenID 2.0 (legacy). FACEIT uses OAuth2 Authorization Code + PKCE.
These flows link a player's external accounts to their Clerk user_id.
"""

import base64
import hashlib
import logging
import os
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from api.auth import get_current_user
from db.database import get_session
from db.models import LinkedAccount

logger = logging.getLogger(__name__)
router = APIRouter()

STEAM_OPENID_URL = "https://steamcommunity.com/openid/login"
FACEIT_AUTH_URL = "https://accounts.faceit.com/accounts"
FACEIT_TOKEN_URL = "https://api.faceit.com/auth/v1/oauth/token"
FACEIT_API_BASE = "https://api.faceit.com/core/v1"

_pkce_state_store: dict[str, str] = {}  # state -> code_verifier (in-memory; use Redis in prod)


# ---------------------------------------------------------------------------
# Steam OpenID 2.0
# ---------------------------------------------------------------------------


@router.get("/steam/login", summary="Initiate Steam OpenID login")
async def steam_login(request: Request):
    """Redirects user to Steam OpenID login page."""
    base_url = os.environ.get("API_BASE_URL", "http://localhost:8000")
    return_to = f"{base_url}/api/oauth/steam/callback"

    params = {
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": return_to,
        "openid.realm": base_url,
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    }
    return RedirectResponse(url=f"{STEAM_OPENID_URL}?{urlencode(params)}")


@router.get("/steam/callback", summary="Steam OpenID callback")
async def steam_callback(
    request: Request,
    user_id: str = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """Handles Steam OpenID callback, extracts Steam ID, and links to Clerk user."""
    params = dict(request.query_params)

    # Verify the OpenID response
    claimed_id = params.get("openid.claimed_id", "")
    if not claimed_id or "steamcommunity.com/openid/id/" not in claimed_id:
        raise HTTPException(status_code=400, detail="Invalid Steam callback — missing claimed_id")

    # Validate with Steam (direct verification)
    verify_params = dict(params)
    verify_params["openid.mode"] = "check_authentication"
    async with httpx.AsyncClient() as client:
        resp = await client.post(STEAM_OPENID_URL, data=verify_params)
        if "is_valid:true" not in resp.text:
            raise HTTPException(status_code=401, detail="Steam OpenID verification failed")

    # Extract Steam ID from claimed_id URL
    steam_id = claimed_id.rsplit("/", 1)[-1]

    # Upsert LinkedAccount
    existing = db.query(LinkedAccount).filter(
        LinkedAccount.user_id == user_id,
        LinkedAccount.provider == "steam"
    ).first()
    if existing:
        existing.provider_user_id = steam_id
    else:
        db.add(LinkedAccount(user_id=user_id, provider="steam", provider_user_id=steam_id))
    db.commit()

    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    return RedirectResponse(url=f"{frontend_url}/onboarding?steam=linked")


# ---------------------------------------------------------------------------
# FACEIT OAuth2 + PKCE
# ---------------------------------------------------------------------------


@router.get("/faceit/login", summary="Initiate FACEIT OAuth2 login")
async def faceit_login():
    """Redirects user to FACEIT OAuth2 authorization page."""
    client_id = os.environ.get("FACEIT_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=500, detail="FACEIT_CLIENT_ID not configured")

    # PKCE
    code_verifier = secrets.token_urlsafe(64)
    code_challenge = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge_b64 = base64.urlsafe_b64encode(code_challenge).rstrip(b"=").decode()

    state = secrets.token_urlsafe(16)
    _pkce_state_store[state] = code_verifier

    base_url = os.environ.get("API_BASE_URL", "http://localhost:8000")
    redirect_uri = f"{base_url}/api/oauth/faceit/callback"

    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": "openid profile email membership",
        "state": state,
        "code_challenge": code_challenge_b64,
        "code_challenge_method": "S256",
    }
    return RedirectResponse(url=f"{FACEIT_AUTH_URL}?{urlencode(params)}")


@router.get("/faceit/callback", summary="FACEIT OAuth2 callback")
async def faceit_callback(
    code: str = Query(...),
    state: str = Query(...),
    user_id: str = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """Exchanges FACEIT authorization code for tokens and links account."""
    code_verifier = _pkce_state_store.pop(state, None)
    if not code_verifier:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

    client_id = os.environ.get("FACEIT_CLIENT_ID")
    client_secret = os.environ.get("FACEIT_CLIENT_SECRET")
    base_url = os.environ.get("API_BASE_URL", "http://localhost:8000")
    redirect_uri = f"{base_url}/api/oauth/faceit/callback"

    # Exchange code for token
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            FACEIT_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "code_verifier": code_verifier,
            },
            auth=(client_id, client_secret),
        )
        if token_resp.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"FACEIT token exchange failed: {token_resp.text}",
            )

        tokens = token_resp.json()
        access_token = tokens["access_token"]

        # Fetch FACEIT player profile
        profile_resp = await client.get(
            f"{FACEIT_API_BASE}/users/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        profile = profile_resp.json()

    faceit_id = profile.get("id", "")
    faceit_nickname = profile.get("nickname", "")

    # Upsert LinkedAccount
    existing = db.query(LinkedAccount).filter(
        LinkedAccount.user_id == user_id,
        LinkedAccount.provider == "faceit"
    ).first()
    if existing:
        existing.provider_user_id = faceit_id
        existing.access_token = access_token
        existing.refresh_token = tokens.get("refresh_token")
    else:
        db.add(LinkedAccount(
            user_id=user_id,
            provider="faceit",
            provider_user_id=faceit_id,
            access_token=access_token,
            refresh_token=tokens.get("refresh_token"),
        ))
    db.commit()

    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    return RedirectResponse(url=f"{frontend_url}/onboarding?faceit=linked&nickname={faceit_nickname}")


@router.get("/status", summary="Get linked account status for current user")
def get_linked_accounts(
    user_id: str = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """Return which external accounts (Steam, FACEIT) are linked for the current user."""
    accounts = db.query(LinkedAccount).filter(LinkedAccount.user_id == user_id).all()
    return {
        "steam": next((a.provider_user_id for a in accounts if a.provider == "steam"), None),
        "faceit": next((a.provider_user_id for a in accounts if a.provider == "faceit"), None),
    }
