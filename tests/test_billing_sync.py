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


def test_invalid_status_defaults_to_active():
    """Docstring for test_invalid_status_defaults_to_active."""
    client.post(
        "/api/billing/sync",
        json={"user_id": "u_bad", "plan": "basic", "status": "weird", "event": "x"},
    )
    db = _db()
    assert db.get(Subscription, "u_bad").status == "active"
    db.close()
