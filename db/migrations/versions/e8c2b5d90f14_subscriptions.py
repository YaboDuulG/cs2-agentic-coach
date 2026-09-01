"""Subscriptions table — Stripe-backed plan authority (module 4).

Revision ID: e8c2b5d90f14
Revises: a9d3e7b1c552
Create Date: 2026-09-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e8c2b5d90f14"
down_revision: Union[str, Sequence[str], None] = "a9d3e7b1c552"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Docstring for upgrade."""
    op.create_table(
        "subscriptions",
        sa.Column("user_id", sa.String(64), primary_key=True),
        sa.Column("stripe_customer_id", sa.String(64), nullable=True, unique=True, index=True),
        sa.Column("stripe_subscription_id", sa.String(64), nullable=True),
        sa.Column("plan", sa.String(16), nullable=False, server_default="free"),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("current_period_end", sa.DateTime(), nullable=True),
        sa.Column("grace_until", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    """Docstring for downgrade."""
    op.drop_table("subscriptions")
