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
from services.billing.promo import (
    PromoError,
    RedeemResult,
    create_trial_codes,
    get_or_create_referral_code,
    grant_days,
    redeem,
)

__all__ = [
    "PromoError",
    "RedeemResult",
    "create_trial_codes",
    "get_or_create_referral_code",
    "grant_days",
    "redeem",
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
