"""Promo codes (trial + referral) and per-season Team purchases.

Revision ID: a1c7e9b3d5f2
Revises: d4e8f1a2b6c3
Create Date: 2026-09-29
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a1c7e9b3d5f2"
down_revision: Union[str, Sequence[str], None] = "d4e8f1a2b6c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Docstring for upgrade."""
    op.create_table(
        "promo_codes",
        sa.Column("code", sa.String(32), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("tier", sa.String(16), nullable=False, server_default="SOLO_PRO"),
        sa.Column("days", sa.Integer(), nullable=False, server_default="7"),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("uses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.String(64), nullable=True, index=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("note", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "promo_redemptions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "code", sa.String(32), sa.ForeignKey("promo_codes.code"), nullable=False, index=True
        ),
        sa.Column("user_id", sa.String(64), nullable=False, index=True),
        sa.Column("redeemed_at", sa.DateTime(), nullable=False),
        sa.Column("granted_until", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("code", "user_id", name="uq_promo_redemption"),
    )
    # Team tier is a flat fee per ESEA season, independent of the Stripe
    # subscription columns (services/billing/seasons.py).
    op.add_column("subscriptions", sa.Column("season", sa.Integer(), nullable=True))
    op.add_column("subscriptions", sa.Column("season_until", sa.DateTime(), nullable=True))
    # Per-call Gemini metering (services/billing/metering.py).
    op.create_table(
        "llm_usage",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, index=True),
        sa.Column("match_id", sa.String(36), nullable=True, index=True),
        sa.Column("team_id", sa.String(36), nullable=True, index=True),
        sa.Column("user_id", sa.String(64), nullable=True, index=True),
        sa.Column("purpose", sa.String(16), nullable=False, server_default="coach"),
        sa.Column("model", sa.String(48), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cached_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    """Docstring for downgrade."""
    op.drop_table("llm_usage")
    op.drop_column("subscriptions", "season_until")
    op.drop_column("subscriptions", "season")
    op.drop_table("promo_redemptions")
    op.drop_table("promo_codes")
