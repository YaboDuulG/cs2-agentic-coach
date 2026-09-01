"""Entitlement gating and Stripe-backed subscription authority."""

from services.billing.entitlements import (
    Entitlement,
    Tier,
    build_teaser,
    effective_entitlements,
    invalidate_user,
    redact_coaching_payload,
    require_entitlement,
    resolve_tier,
    resolve_user_tier,
    upgrade_metadata,
)

__all__ = [
    "Entitlement",
    "Tier",
    "build_teaser",
    "effective_entitlements",
    "invalidate_user",
    "redact_coaching_payload",
    "require_entitlement",
    "resolve_tier",
    "resolve_user_tier",
    "upgrade_metadata",
]
