"""
Authorization dependencies for FastAPI.

Two kinds of caller reach the API:

- the Next.js proxies (``app/api/**``), which present ``API_SHARED_SECRET`` as
  the bearer token and forward the signed-in user's id in ``x-clerk-user-id``
  / ``user_id`` after Clerk has verified the session. They are the
  **service** principal and are trusted to speak for any user;
- a client holding a Clerk JWT (``CLERK_PEM_PUBLIC_KEY`` set), the **user**
  principal. Such a caller may only speak for the token's own subject: every
  identity the request carries (header, query string, JSON body) must equal
  it, or the request is refused. Without that check any signed-in user could
  read or change another user's data by naming them in the header.
"""

from dataclasses import dataclass
import hmac
import json
import os
from typing import Literal

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

security = HTTPBearer()

INTERNAL_SERVICE_USER = "internal_service_user"
_IDENTITY_HEADER = "x-clerk-user-id"
_IDENTITY_FIELD = "user_id"


@dataclass(frozen=True)
class Principal:
    """Who is calling: the proxy (service) or a user with a Clerk token."""

    kind: Literal["service", "user"]
    user_id: str | None = None


def authenticate(credentials: HTTPAuthorizationCredentials) -> Principal:
    """Bearer token → principal. The shared secret is checked first, in
    constant time; then the Clerk JWT when a public key is configured."""
    token = credentials.credentials

    expected_secret = os.getenv("API_SHARED_SECRET")
    if expected_secret and hmac.compare_digest(token, expected_secret):
        return Principal("service")

    pem_key = os.getenv("CLERK_PEM_PUBLIC_KEY")
    if not pem_key:
        if expected_secret:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Neither CLERK_PEM_PUBLIC_KEY nor API_SHARED_SECRET is configured on the server.",
        )
    if "-----BEGIN PUBLIC KEY-----" not in pem_key:
        pem_key = f"-----BEGIN PUBLIC KEY-----\n{pem_key}\n-----END PUBLIC KEY-----"

    try:
        payload = jwt.decode(token, pem_key, algorithms=["RS256"], options={"verify_aud": False})
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except JWTError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {e}")
    subject = str(payload.get("sub") or "")
    if not subject:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has no subject")
    return Principal("user", subject)


async def claimed_identities(request: Request) -> set[str]:
    """Every user id the request names: the identity header, the ``user_id``
    query parameter, and a top-level ``user_id`` in a JSON body."""
    claimed = {
        request.headers.get(_IDENTITY_HEADER) or "",
        request.query_params.get(_IDENTITY_FIELD) or "",
    }
    if request.headers.get("content-type", "").split(";")[0].strip() == "application/json":
        body = await request.body()  # cached by Starlette; the route still gets it
        if body:
            try:
                data = json.loads(body)
            except ValueError:
                data = None
            if isinstance(data, dict) and isinstance(data.get(_IDENTITY_FIELD), str):
                claimed.add(data[_IDENTITY_FIELD])
    claimed.discard("")
    return claimed


async def get_current_user(
    request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)
) -> str:
    """Resolves the caller. Returns ``INTERNAL_SERVICE_USER`` for the proxy
    (routes then trust the forwarded identity) or the Clerk subject for a
    user, after refusing any forwarded identity that is not their own."""
    principal = authenticate(credentials)
    if principal.kind == "service":
        return INTERNAL_SERVICE_USER

    assert principal.user_id is not None
    others = {c for c in await claimed_identities(request) if c != principal.user_id}
    if others:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The request names a user other than the one the token belongs to.",
        )
    return principal.user_id
