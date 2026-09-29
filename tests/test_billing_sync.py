"""
Billing sync endpoint tests — the backend half of the Stripe webhook fan-out.
"""

import os

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"
os.environ.setdefault("LOCAL_MODE", "true")

from fastapi.testclient import TestClient

from api.main import app
from db.database import engine, get_session
from db.models import Base, Subscription
from services.billing.entitlements import _clear_cache

Base.metadata.create_all(engine)
client = TestClient(app)


def _db():
    """Docstring for _db."""
    gen = get_session()
    return next(gen)


def setup_function(_fn):
    """Docstring for setup_function."""
    _clear_cache()
    db = _db()
    db.query(Subscription).delete()
    db.commit()
    db.close()


def test_sync_creates_and_updates_subscription():
    """Docstring for test_sync_creates_and_updates_subscription."""
    r = client.post(
        "/api/billing/sync",
        json={
            "user_id": "u_sync", "plan": "pro", "status": "active",
            "stripe_customer_id": "cus_123", "stripe_subscription_id": "sub_123",
            "current_period_end": 1790000000, "event": "checkout.session.completed",
        },
    )
    assert r.status_code == 200
    db = _db()
    sub = db.get(Subscription, "u_sync")
    assert sub.plan == "pro" and sub.status == "active"
    assert sub.stripe_customer_id == "cus_123"
    assert sub.current_period_end is not None
    db.close()

    # Downgrade event updates in place
    r = client.post(
        "/api/billing/sync",
        json={"user_id": "u_sync", "plan": "free", "status": "canceled",
              "event": "customer.subscription.deleted"},
    )
    assert r.status_code == 200
    db = _db()
    assert db.get(Subscription, "u_sync").status == "canceled"
    db.close()


def test_past_due_sets_grace_window():
    """Docstring for test_past_due_sets_grace_window."""
    client.post(
        "/api/billing/sync",
        json={"user_id": "u_grace", "plan": "basic", "status": "active",
              "current_period_end": 1790000000, "event": "sub.updated"},
    )
    client.post(
        "/api/billing/sync",
        json={"user_id": "u_grace", "plan": "basic", "status": "past_due",
              "event": "invoice.payment_failed"},
    )
    db = _db()
    sub = db.get(Subscription, "u_grace")
    assert sub.status == "past_due"
    assert sub.grace_until is not None
    assert (sub.grace_until - sub.current_period_end).days == 7
    db.close()


def test_team_season_purchase_outranks_and_extends():
    """A one-time season purchase sets the season fields only, wins tier
    resolution until the next season starts, and an early renewal extends."""
    from datetime import datetime

    from services.billing import Tier
    from services.billing.entitlements import tier_from_subscription

    r = client.post(
        "/api/billing/sync",
        json={"user_id": "u_team", "season": 59, "stripe_customer_id": "cus_t",
              "event": "checkout.session.completed"},
    )
    assert r.status_code == 200 and r.json()["season"] == 59
    db = _db()
    sub = db.get(Subscription, "u_team")
    assert sub.season == 59 and sub.season_until == datetime(2027, 1, 4)
    assert sub.plan == "free"  # subscription fields untouched
    assert tier_from_subscription(sub, datetime(2026, 12, 1)) is Tier.TEAM
    assert tier_from_subscription(sub, datetime(2027, 1, 5)) is Tier.FREE
    db.close()

    client.post("/api/billing/sync", json={"user_id": "u_team", "season": 60, "event": "x"})
    db = _db()
    assert db.get(Subscription, "u_team").season_until > datetime(2027, 1, 4)
    db.close()

    # A Solo Pro subscription event afterwards must not clobber the season.
    client.post(
        "/api/billing/sync",
        json={"user_id": "u_team", "plan": "basic", "status": "active",
              "stripe_subscription_id": "sub_x", "event": "customer.subscription.updated"},
    )
    db = _db()
    sub = db.get(Subscription, "u_team")
    assert sub.season == 60 and tier_from_subscription(sub, datetime(2027, 2, 1)) is Tier.TEAM
    db.close()

    r = client.post("/api/billing/sync", json={"user_id": "u_team", "season": 12, "event": "x"})
    assert r.status_code == 400


def test_seasons_endpoint_lists_purchasable_first():
    """Docstring for test_seasons_endpoint_lists_purchasable_first."""
    r = client.get("/api/billing/seasons")
    assert r.status_code == 200
    body = r.json()
    assert body["price_usd"] == 300
    assert body["seasons"][0]["number"] == body["purchasable"]["number"]
    assert body["seasons"][1]["number"] == body["purchasable"]["number"] + 1


def test_invalid_status_defaults_to_active():
    """Docstring for test_invalid_status_defaults_to_active."""
    client.post(
        "/api/billing/sync",
        json={"user_id": "u_bad", "plan": "basic", "status": "weird", "event": "x"},
    )
    db = _db()
    assert db.get(Subscription, "u_bad").status == "active"
    db.close()
