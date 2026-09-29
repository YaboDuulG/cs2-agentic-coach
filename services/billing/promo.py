"""
Promo codes: weekly trial codes and per-user referral codes.
============================================================
Two kinds of code, one grant mechanism:

    trial     admin-minted (`TRIAL-XXXX-XXXX`), usually single-use, expires after
              `valid_days`; grants `days` of `tier` to whoever redeems it.
    referral  one per user (`REF-XXXXXX`), unlimited uses; a NEW account that
              signs up with it gets REFERRAL_DAYS of SOLO_PRO, and the referrer
              gets REFERRER_BONUS_DAYS on top of whatever they have.

A grant writes a time-boxed `trialing` row into `subscriptions`, the same
table the Stripe webhook fan-out owns. That keeps the entitlement layer
single-sourced: `tier_from_subscription` already understands `trialing`, and
a later Stripe event simply overwrites the row. A paying subscriber is never
downgraded by a grant.

No Stripe calls, no request-path lookups; everything here is Postgres.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import logging
import secrets

from sqlalchemy import select

from services.billing.entitlements import (
    PLAN_TIER,
    Tier,
    invalidate_user,
    tier_from_subscription,
)

logger = logging.getLogger(__name__)

TRIAL_DAYS = 7
TRIAL_CODE_VALID_DAYS = 14
REFERRAL_DAYS = 7
REFERRER_BONUS_DAYS = 7
# A referral code only counts for accounts younger than this.
REFERRAL_WINDOW_DAYS = 7

KIND_TRIAL = "trial"
KIND_REFERRAL = "referral"

# Plan strings the subscriptions table (and Clerk publicMetadata.plan) use.
TIER_PLAN: dict[Tier, str] = {Tier.FREE: "free", Tier.SOLO_PRO: "basic", Tier.TEAM: "pro"}
_TIER_RANK: dict[Tier, int] = {Tier.FREE: 0, Tier.SOLO_PRO: 1, Tier.TEAM: 2}

# No I/L/O/0/1: codes get read aloud and typed from Discord screenshots.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


class PromoError(Exception):
    """A redemption that must be refused, with a stable machine code."""

    def __init__(self, code: str, message: str):
        """Docstring for __init__."""
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class GrantResult:
    """Docstring for GrantResult."""
    applied: bool
    until: datetime | None
    reason: str


@dataclass(frozen=True)
class RedeemResult:
    """Docstring for RedeemResult."""
    code: str
    kind: str
    tier: Tier
    plan: str
    days: int
    until: datetime
    referrer_rewarded: bool


def _now() -> datetime:
    """Naive UTC, matching the subscriptions table."""
    return datetime.now(UTC).replace(tzinfo=None)


def normalize_code(raw: str) -> str:
    """Upper-case, strip whitespace; tolerate a pasted `ref=` prefix."""
    code = (raw or "").strip().upper().replace(" ", "")
    if code.startswith("REF=") or code.startswith("CODE="):
        code = code.split("=", 1)[1]
    return code


def _random_block(length: int) -> str:
    """Docstring for _random_block."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def _unique_code(db, prefix: str, blocks: tuple[int, ...]) -> str:
    """Docstring for _unique_code."""
    from db.models import PromoCode  # noqa: PLC0415

    for _ in range(20):
        code = "-".join([prefix, *(_random_block(n) for n in blocks)])
        if db.get(PromoCode, code) is None:
            return code
    raise RuntimeError("could not mint a unique promo code")


# ---------------------------------------------------------------------------
# Granting
# ---------------------------------------------------------------------------


def grant_days(
    db, user_id: str, tier: Tier, days: int, *, commit: bool = True
) -> GrantResult:
    """
    Give `user_id` `days` of `tier` as a `trialing` subscription row.

    - A paying subscriber (Stripe subscription, active or past_due) at or above
      `tier` is left alone: applied=False, reason="already_subscribed".
    - An active trial at or above `tier` is EXTENDED from its current end, so
      two codes stack instead of the second one being wasted.
    - Anything else (no row, free, expired, lower tier) becomes `tier` from now.
    """
    from db.models import Subscription  # noqa: PLC0415

    if tier is Tier.FREE or days <= 0:
        return GrantResult(False, None, "nothing_to_grant")

    now = _now()
    sub = db.get(Subscription, user_id)
    current = tier_from_subscription(sub, now) if sub else None

    if (
        sub is not None
        and sub.stripe_subscription_id
        and (sub.status or "").lower() in ("active", "past_due")
        and current is not None
        and _TIER_RANK[current] >= _TIER_RANK[tier]
    ):
        return GrantResult(False, sub.current_period_end, "already_subscribed")

    base = now
    if (
        sub is not None
        and (sub.status or "").lower() == "trialing"
        and sub.current_period_end
        and sub.current_period_end > now
        and _TIER_RANK[PLAN_TIER.get((sub.plan or "").lower(), Tier.FREE)] >= _TIER_RANK[tier]
    ):
        base = sub.current_period_end
        # Keep the higher tier the user already holds on trial.
        tier = PLAN_TIER.get((sub.plan or "").lower(), tier)

    until = base + timedelta(days=days)
    if sub is None:
        sub = Subscription(user_id=user_id)
        db.add(sub)
    sub.plan = TIER_PLAN[tier]
    sub.status = "trialing"
    sub.current_period_end = until
    sub.grace_until = None
    db.flush()
    if commit:
        db.commit()
    invalidate_user(user_id)
    logger.info(f"[Promo] {user_id}: +{days}d {tier.value} until {until.isoformat()}")
    return GrantResult(True, until, "granted")


# ---------------------------------------------------------------------------
# Minting
# ---------------------------------------------------------------------------


def create_trial_codes(
    db,
    *,
    count: int = 5,
    tier: Tier = Tier.SOLO_PRO,
    days: int = TRIAL_DAYS,
    max_uses: int | None = 1,
    valid_days: int = TRIAL_CODE_VALID_DAYS,
    created_by: str | None = None,
    note: str | None = None,
) -> list:
    """Mint `count` trial codes. Returns the PromoCode rows (committed)."""
    from db.models import PromoCode  # noqa: PLC0415

    count = max(1, min(int(count), 200))
    expires_at = _now() + timedelta(days=valid_days) if valid_days else None
    rows = []
    for _ in range(count):
        row = PromoCode(
            code=_unique_code(db, "TRIAL", (4, 4)),
            kind=KIND_TRIAL,
            tier=tier.value,
            days=int(days),
            max_uses=max_uses,
            created_by=created_by,
            expires_at=expires_at,
            note=note,
        )
        db.add(row)
        db.flush()
        rows.append(row)
    db.commit()
    return rows


def get_or_create_referral_code(db, user_id: str):
    """Every user owns exactly one referral code; minted on first request."""
    from db.models import PromoCode  # noqa: PLC0415

    existing = db.execute(
        select(PromoCode).where(
            PromoCode.created_by == user_id, PromoCode.kind == KIND_REFERRAL
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    row = PromoCode(
        code=_unique_code(db, "REF", (6,)),
        kind=KIND_REFERRAL,
        tier=Tier.SOLO_PRO.value,
        days=REFERRAL_DAYS,
        max_uses=None,
        created_by=user_id,
        expires_at=None,
    )
    db.add(row)
    db.commit()
    return row


# ---------------------------------------------------------------------------
# Redeeming
# ---------------------------------------------------------------------------


def redeem(
    db, *, code: str, user_id: str, account_age_days: float | None = None
) -> RedeemResult:
    """
    Validate and apply a code for `user_id`. Raises PromoError with one of:
    invalid · expired · exhausted · already_redeemed · own_code · not_new ·
    referral_used · already_subscribed.
    """
    from db.models import PromoCode, PromoRedemption  # noqa: PLC0415

    now = _now()
    normalized = normalize_code(code)
    promo = db.get(PromoCode, normalized) if normalized else None
    if promo is None or not promo.active:
        raise PromoError("invalid", "That code isn't valid.")
    if promo.expires_at and now > promo.expires_at:
        raise PromoError("expired", "That code has expired.")
    if promo.max_uses is not None and promo.uses >= promo.max_uses:
        raise PromoError("exhausted", "That code has already been used.")

    already = db.execute(
        select(PromoRedemption.id).where(
            PromoRedemption.code == promo.code, PromoRedemption.user_id == user_id
        )
    ).first()
    if already:
        raise PromoError("already_redeemed", "You've already used this code.")

    if promo.kind == KIND_REFERRAL:
        if promo.created_by == user_id:
            raise PromoError("own_code", "You can't redeem your own invite code.")
        if account_age_days is not None and account_age_days > REFERRAL_WINDOW_DAYS:
            raise PromoError(
                "not_new", "Invite codes are for new accounts (first 7 days)."
            )
        prior = db.execute(
            select(PromoRedemption.id)
            .join(PromoCode, PromoCode.code == PromoRedemption.code)
            .where(PromoRedemption.user_id == user_id, PromoCode.kind == KIND_REFERRAL)
        ).first()
        if prior:
            raise PromoError("referral_used", "You've already used an invite code.")

    tier = Tier(promo.tier)
    grant = grant_days(db, user_id, tier, promo.days, commit=False)
    if not grant.applied or grant.until is None:
        db.rollback()
        raise PromoError(
            "already_subscribed", "You're already subscribed at this tier or higher."
        )

    db.add(PromoRedemption(code=promo.code, user_id=user_id, granted_until=grant.until))
    promo.uses = (promo.uses or 0) + 1

    referrer_rewarded = False
    if promo.kind == KIND_REFERRAL and promo.created_by:
        bonus = grant_days(db, promo.created_by, tier, REFERRER_BONUS_DAYS, commit=False)
        referrer_rewarded = bonus.applied

    db.commit()
    return RedeemResult(
        code=promo.code,
        kind=promo.kind,
        tier=tier,
        plan=TIER_PLAN[tier],
        days=promo.days,
        until=grant.until,
        referrer_rewarded=referrer_rewarded,
    )
