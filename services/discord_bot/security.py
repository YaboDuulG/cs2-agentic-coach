"""
Discord request signatures + team bind codes.

verify_signature: Ed25519 check per the Discord interactions contract —
the signed message is `timestamp + raw body`.

Bind codes are the cryptographic team-tenancy binding: `<team_id>.<hex12>`
where hex12 is the truncated HMAC-SHA256 of the team_id under
DISCORD_WEBHOOK_SECRET. Only someone who got the code from the web app
(team owner) can bind a Discord guild to that team.
"""

import hashlib
import hmac
import logging
import os

logger = logging.getLogger(__name__)

_BIND_CODE_HEX_LEN = 12


def verify_signature(
    public_key_hex: str, signature_hex: str, timestamp: str, body_bytes: bytes
) -> bool:
    """True iff signature_hex is a valid Ed25519 signature of timestamp+body."""
    from cryptography.exceptions import InvalidSignature  # noqa: PLC0415
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (  # noqa: PLC0415
        Ed25519PublicKey,
    )

    try:
        key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key_hex))
        key.verify(bytes.fromhex(signature_hex), timestamp.encode() + body_bytes)
        return True
    except (InvalidSignature, ValueError):
        return False


def _bind_secret() -> str:
    """Docstring for _bind_secret."""
    secret = os.environ.get("DISCORD_WEBHOOK_SECRET", "")
    if not secret:
        raise ValueError("DISCORD_WEBHOOK_SECRET is not configured — cannot mint bind codes")
    return secret


def _bind_mac(team_id: str, secret: str) -> str:
    """Docstring for _bind_mac."""
    return hmac.new(secret.encode(), team_id.encode(), hashlib.sha256).hexdigest()[
        :_BIND_CODE_HEX_LEN
    ]


def make_bind_code(team_id: str) -> str:
    """`<team_id>.<hex12>` — HMAC-SHA256 of the team id under the shared secret."""
    return f"{team_id}.{_bind_mac(team_id, _bind_secret())}"


def verify_bind_code(code: str) -> str | None:
    """Return the team_id when the code's MAC checks out, else None."""
    secret = os.environ.get("DISCORD_WEBHOOK_SECRET", "")
    if not secret:
        logger.warning("Bind code rejected: DISCORD_WEBHOOK_SECRET is not configured.")
        return None
    team_id, sep, mac = code.rpartition(".")
    if not sep or not team_id or not mac:
        return None
    if not hmac.compare_digest(mac, _bind_mac(team_id, secret)):
        return None
    return team_id
