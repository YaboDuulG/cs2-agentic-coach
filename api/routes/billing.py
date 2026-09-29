"""Module docstring."""
from fastapi import Depends
from sqlalchemy.orm import Session

from db.database import get_session

"""
Billing sync endpoint — the backend half of the Stripe webhook fan-out.
========================================================================
Stripe's webhook lands on the Next.js server route (which owns the Stripe
SDK and verifies the event signature). That route updates Clerk's display
metadata AND forwards a normalized payload here (shared-secret auth via the
router mount), making the subscriptions table the entitlement authority and
invalidating the in-process entitlement cache — per the constraint that no
request path ever performs a raw Stripe lookup.
"""

from datetime import UTC, datetime
import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Current user's entitlements (the picker and the plan card read this instead
# of Clerk metadata) and promo/referral redemption.
# ---------------------------------------------------------------------------


@router.get("/entitlements", summary="Tier, entitlements and expiry for a user")
async def my_entitlements(request: Request, user_id: str = "", db: Session = Depends(get_session)):
    """Docstring for my_entitlements."""
    from db.models import Subscription  # noqa: PLC0415
    from services.billing import effective_entitlements, resolve_user_tier  # noqa: PLC0415

    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    plan_header = request.headers.get("x-user-plan")
    tier = resolve_user_tier(db, user_id, plan_header)
    ents = effective_entitlements(db, user_id, plan_header)
    sub = db.get(Subscription, user_id)
    now = datetime.now(UTC).replace(tzinfo=None)
    source = "none"
    if sub is not None and sub.season_until and now <= sub.season_until:
        source = "season"
    elif sub is not None and sub.stripe_subscription_id:
        source = "stripe"
    elif sub is not None and (sub.status or "").lower() == "trialing":
        source = "trial"
    return {
        "user_id": user_id,
        "tier": tier.value,
        "entitlements": sorted(e.value for e in ents),
        "status": sub.status if sub else None,
        "current_period_end": (
            sub.current_period_end.isoformat() if sub and sub.current_period_end else None
        ),
        "season": sub.season if sub else None,
        "season_until": sub.season_until.isoformat() if sub and sub.season_until else None,
        "source": source,
    }


@router.get("/seasons", summary="ESEA season calendar for Team pricing")
async def seasons_endpoint(count: int = 3):
    """The purchasable season (current, or next during the off-season gap)
    and the ones after it. Projected seasons are flagged."""
    from services.billing.seasons import TEAM_SEASON_PRICE_USD, to_dict, upcoming  # noqa: PLC0415

    items = upcoming(max(1, min(count, 8)))
    return {"purchasable": to_dict(items[0]), "seasons": [to_dict(s) for s in items],
            "price_usd": TEAM_SEASON_PRICE_USD}


class RedeemRequest(BaseModel):
    """Docstring for RedeemRequest."""
    code: str
    # Computed by the Next.js route from Clerk's createdAt; referral codes
    # only count for new accounts.
    account_age_days: float | None = None


@router.post("/redeem", summary="Redeem a trial or referral code")
async def redeem_code(body: RedeemRequest, user_id: str = "", db: Session = Depends(get_session)):
    """Docstring for redeem_code."""
    from services.billing import PromoError, redeem  # noqa: PLC0415

    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    try:
        result = redeem(
            db, code=body.code, user_id=user_id, account_age_days=body.account_age_days
        )
    except PromoError as e:
        raise HTTPException(status_code=400, detail={"code": e.code, "message": str(e)})
    return {
        "ok": True,
        "code": result.code,
        "kind": result.kind,
        "tier": result.tier.value,
        "plan": result.plan,
        "days": result.days,
        "until": result.until.isoformat(),
        "referrer_rewarded": result.referrer_rewarded,
    }


@router.get("/referral-code", summary="The user's own invite code")
async def referral_code(user_id: str = "", db: Session = Depends(get_session)):
    """Docstring for referral_code."""
    from services.billing import get_or_create_referral_code  # noqa: PLC0415
    from services.billing.promo import REFERRAL_DAYS, REFERRER_BONUS_DAYS  # noqa: PLC0415

    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    row = get_or_create_referral_code(db, user_id)
    return {
        "code": row.code,
        "uses": row.uses,
        "invitee_days": REFERRAL_DAYS,
        "referrer_days": REFERRER_BONUS_DAYS,
        "tier": row.tier,
    }

_VALID_STATUSES = {"active", "trialing", "past_due", "canceled"}


class SubscriptionSync(BaseModel):
    """Docstring for SubscriptionSync."""
    user_id: str
    plan: str = "free"
    status: str = "active"
    stripe_customer_id: str | None = None
    stripe_subscription_id: str | None = None
    current_period_end: int | None = None  # unix seconds
    event: str = ""  # originating Stripe event type, for the audit log
    # A one-time Team purchase for this ESEA season. When set, only the
    # season fields are written; the subscription fields are left alone.
    season: int | None = None


@router.post("/sync", summary="Upsert a subscription from the Stripe webhook fan-out")
async def sync_subscription(body: SubscriptionSync, db: Session = Depends(get_session)):
    """Docstring for sync_subscription."""
    from db.models import Subscription  # noqa: PLC0415
    from services.billing import invalidate_user  # noqa: PLC0415
    from services.billing.entitlements import grace_deadline  # noqa: PLC0415

    if body.season is not None:
        from services.billing import seasons as season_calendar  # noqa: PLC0415

        try:
            s = season_calendar.season(body.season)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"unknown season {body.season}")
        sub = db.get(Subscription, body.user_id)
        if sub is None:
            sub = Subscription(user_id=body.user_id)
            db.add(sub)
        if body.stripe_customer_id:
            sub.stripe_customer_id = body.stripe_customer_id
        until = season_calendar.access_until(s)
        # Renewing early (buying next season while this one runs) extends
        # rather than truncates.
        if sub.season_until is None or until > sub.season_until:
            sub.season = s.number
            sub.season_until = until
        db.commit()
        invalidate_user(body.user_id)
        logger.info(
            f"[Billing] {body.user_id}: team season {s.number} until "
            f"{sub.season_until} (event={body.event or 'n/a'})"
        )
        return {
            "ok": True,
            "user_id": body.user_id,
            "plan": "pro",
            "status": "active",
            "season": sub.season,
            "season_until": sub.season_until.isoformat() if sub.season_until else None,
        }

    status = body.status.lower() if body.status.lower() in _VALID_STATUSES else "active"
    period_end = (
        datetime.fromtimestamp(body.current_period_end, tz=UTC).replace(tzinfo=None)
        if body.current_period_end
        else None
    )

    sub = db.get(Subscription, body.user_id)
    if sub is None:
        sub = Subscription(user_id=body.user_id)
        db.add(sub)
    sub.plan = body.plan.lower()
    sub.status = status
    if body.stripe_customer_id:
        sub.stripe_customer_id = body.stripe_customer_id
    if body.stripe_subscription_id:
        sub.stripe_subscription_id = body.stripe_subscription_id
    if period_end:
        sub.current_period_end = period_end
    # past_due keeps entitlements for the grace window past the period end.
    sub.grace_until = grace_deadline(sub.current_period_end) if status == "past_due" else None
    db.commit()

    invalidate_user(body.user_id)
    logger.info(
        f"[Billing] {body.user_id}: plan={sub.plan} status={status} "
        f"period_end={sub.current_period_end} (event={body.event or 'n/a'})"
    )
    return {"ok": True, "user_id": body.user_id, "plan": sub.plan, "status": status}
