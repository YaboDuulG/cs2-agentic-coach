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

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

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


@router.post("/sync", summary="Upsert a subscription from the Stripe webhook fan-out")
async def sync_subscription(body: SubscriptionSync, db: Session = Depends(get_session)):
    """Docstring for sync_subscription."""
    from db.models import Subscription  # noqa: PLC0415
    from services.billing import invalidate_user  # noqa: PLC0415
    from services.billing.entitlements import grace_deadline  # noqa: PLC0415

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
