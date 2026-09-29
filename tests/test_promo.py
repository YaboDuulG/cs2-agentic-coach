"""
Promo codes: trial minting, redemption rules, referral rewards, and the
trialing-expiry fix in the entitlement layer.
"""

from datetime import UTC, datetime, timedelta
import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL_TEST"] = "sqlite:///:memory:"

from db.models import Base, PromoCode, PromoRedemption, Subscription
from services.billing import (
    Entitlement,
    PromoError,
    Tier,
    create_trial_codes,
    effective_entitlements,
    get_or_create_referral_code,
    grant_days,
    redeem,
    resolve_user_tier,
)
from services.billing.entitlements import _clear_cache, tier_from_subscription
from services.billing.promo import REFERRER_BONUS_DAYS, normalize_code


def _utcnow() -> datetime:
    """Naive UTC, matching the subscriptions table."""
    return datetime.now(UTC).replace(tzinfo=None)


@pytest.fixture()
def db():
    """Docstring for db."""
    _clear_cache()
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    _clear_cache()


class TestMinting:
    """Docstring for TestMinting."""

    def test_trial_codes_are_unique_and_readable(self, db):
        """Docstring for test_trial_codes_are_unique_and_readable."""
        rows = create_trial_codes(db, count=20)
        codes = {r.code for r in rows}
        assert len(codes) == 20
        for c in codes:
            assert c.startswith("TRIAL-") and len(c) == len("TRIAL-XXXX-XXXX")
            assert not set("ILO01") & set(c[6:])
        assert all(r.max_uses == 1 and r.days == 7 and r.tier == "SOLO_PRO" for r in rows)
        assert rows[0].expires_at is not None

    def test_referral_code_is_one_per_user(self, db):
        """Docstring for test_referral_code_is_one_per_user."""
        a = get_or_create_referral_code(db, "u1")
        b = get_or_create_referral_code(db, "u1")
        assert a.code == b.code and a.code.startswith("REF-")
        assert a.max_uses is None and a.expires_at is None

    def test_normalize(self):
        """Docstring for test_normalize."""
        assert normalize_code("  ref-ab cd12 ") == "REF-ABCD12"
        assert normalize_code("ref=REF-ABCD12") == "REF-ABCD12"


class TestTrialRedemption:
    """Docstring for TestTrialRedemption."""

    def test_grants_seven_days_of_solo_pro(self, db):
        """Docstring for test_grants_seven_days_of_solo_pro."""
        code = create_trial_codes(db, count=1)[0].code
        result = redeem(db, code=code, user_id="u1")
        assert result.tier is Tier.SOLO_PRO and result.plan == "basic"
        sub = db.get(Subscription, "u1")
        assert sub.status == "trialing"
        assert abs((sub.current_period_end - _utcnow()) - timedelta(days=7)) < timedelta(
            minutes=1
        )
        assert Entitlement.FULL_COACHING in effective_entitlements(db, "u1", None)
        assert db.get(PromoCode, code).uses == 1

    def test_single_use_code_is_exhausted(self, db):
        """Docstring for test_single_use_code_is_exhausted."""
        code = create_trial_codes(db, count=1)[0].code
        redeem(db, code=code, user_id="u1")
        with pytest.raises(PromoError) as e:
            redeem(db, code=code, user_id="u2")
        assert e.value.code == "exhausted"

    def test_same_user_cannot_redeem_twice(self, db):
        """Docstring for test_same_user_cannot_redeem_twice."""
        code = create_trial_codes(db, count=1, max_uses=None)[0].code
        redeem(db, code=code, user_id="u1")
        with pytest.raises(PromoError) as e:
            redeem(db, code=code, user_id="u1")
        assert e.value.code == "already_redeemed"

    def test_expired_and_unknown(self, db):
        """Docstring for test_expired_and_unknown."""
        row = create_trial_codes(db, count=1)[0]
        row.expires_at = _utcnow() - timedelta(days=1)
        db.commit()
        with pytest.raises(PromoError) as e:
            redeem(db, code=row.code, user_id="u1")
        assert e.value.code == "expired"
        with pytest.raises(PromoError) as e2:
            redeem(db, code="TRIAL-NOPE-NOPE", user_id="u1")
        assert e2.value.code == "invalid"

    def test_two_trials_stack(self, db):
        """Docstring for test_two_trials_stack."""
        a, b = create_trial_codes(db, count=2)
        first = redeem(db, code=a.code, user_id="u1")
        second = redeem(db, code=b.code, user_id="u1")
        assert abs((second.until - first.until) - timedelta(days=7)) < timedelta(minutes=1)

    def test_paying_subscriber_is_not_downgraded(self, db):
        """Docstring for test_paying_subscriber_is_not_downgraded."""
        db.add(
            Subscription(
                user_id="u1",
                plan="pro",
                status="active",
                stripe_subscription_id="sub_123",
                current_period_end=_utcnow() + timedelta(days=20),
            )
        )
        db.commit()
        code = create_trial_codes(db, count=1)[0].code
        with pytest.raises(PromoError) as e:
            redeem(db, code=code, user_id="u1")
        assert e.value.code == "already_subscribed"
        sub = db.get(Subscription, "u1")
        assert sub.plan == "pro" and sub.status == "active"
        assert db.get(PromoCode, code).uses == 0

    def test_team_trial_grants_team(self, db):
        """Docstring for test_team_trial_grants_team."""
        code = create_trial_codes(db, count=1, tier=Tier.TEAM, days=14)[0].code
        result = redeem(db, code=code, user_id="u1")
        assert result.tier is Tier.TEAM and result.days == 14
        assert Entitlement.TEAM_SCOUTING in effective_entitlements(db, "u1", None)


class TestReferral:
    """Docstring for TestReferral."""

    def test_new_user_and_referrer_both_get_a_week(self, db):
        """Docstring for test_new_user_and_referrer_both_get_a_week."""
        ref = get_or_create_referral_code(db, "alice")
        result = redeem(db, code=ref.code, user_id="bob", account_age_days=0.5)
        assert result.kind == "referral" and result.referrer_rewarded
        assert resolve_user_tier(db, "bob", None) is Tier.SOLO_PRO
        assert resolve_user_tier(db, "alice", None) is Tier.SOLO_PRO
        alice = db.get(Subscription, "alice")
        assert abs(
            (alice.current_period_end - _utcnow()) - timedelta(days=REFERRER_BONUS_DAYS)
        ) < timedelta(minutes=1)
        assert db.query(PromoRedemption).count() == 1

    def test_own_code_rejected(self, db):
        """Docstring for test_own_code_rejected."""
        ref = get_or_create_referral_code(db, "alice")
        with pytest.raises(PromoError) as e:
            redeem(db, code=ref.code, user_id="alice", account_age_days=0)
        assert e.value.code == "own_code"

    def test_old_account_rejected(self, db):
        """Docstring for test_old_account_rejected."""
        ref = get_or_create_referral_code(db, "alice")
        with pytest.raises(PromoError) as e:
            redeem(db, code=ref.code, user_id="bob", account_age_days=30)
        assert e.value.code == "not_new"

    def test_only_one_referral_per_user(self, db):
        """Docstring for test_only_one_referral_per_user."""
        a = get_or_create_referral_code(db, "alice")
        c = get_or_create_referral_code(db, "carol")
        redeem(db, code=a.code, user_id="bob", account_age_days=1)
        with pytest.raises(PromoError) as e:
            redeem(db, code=c.code, user_id="bob", account_age_days=1)
        assert e.value.code == "referral_used"

    def test_paying_referrer_keeps_stripe_row(self, db):
        """Docstring for test_paying_referrer_keeps_stripe_row."""
        db.add(
            Subscription(
                user_id="alice",
                plan="basic",
                status="active",
                stripe_subscription_id="sub_1",
                current_period_end=_utcnow() + timedelta(days=10),
            )
        )
        db.commit()
        ref = get_or_create_referral_code(db, "alice")
        result = redeem(db, code=ref.code, user_id="bob", account_age_days=1)
        assert result.referrer_rewarded is False
        assert db.get(Subscription, "alice").status == "active"


class TestTrialingExpiry:
    """Docstring for TestTrialingExpiry."""

    def test_expired_trial_falls_back_to_free(self, db):
        """A promo trial has no Stripe event to end it; period_end must rule."""
        grant_days(db, "u1", Tier.SOLO_PRO, 7)
        sub = db.get(Subscription, "u1")
        assert tier_from_subscription(sub) is Tier.SOLO_PRO
        later = _utcnow() + timedelta(days=8)
        assert tier_from_subscription(sub, later) is Tier.FREE

    def test_stripe_trial_without_period_end_still_counts(self, db):
        """Docstring for test_stripe_trial_without_period_end_still_counts."""
        sub = Subscription(user_id="u2", plan="pro", status="trialing", current_period_end=None)
        assert tier_from_subscription(sub) is Tier.TEAM
