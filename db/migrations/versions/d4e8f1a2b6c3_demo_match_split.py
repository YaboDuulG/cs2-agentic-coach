"""Option B: split demos (shared artifact) from matches (per-user analysis).

Executed as a DATA RESET (scripts/reset_option_b.py), not an in-place
migration — the pre-split tables are dropped and recreated on the new schema
while the data was disposable. This revision records the change in the chain;
its upgrade() mirrors the reset so a fresh alembic-driven database lands on
the same schema create_all produces.

Revision ID: d4e8f1a2b6c3
Revises: b7f4d2e8a901
Create Date: 2026-09-04
"""

from collections.abc import Sequence
from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = "d4e8f1a2b6c3"
down_revision: Union[str, Sequence[str], None] = "b7f4d2e8a901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DROPPED = [
    "jobs",
    "kills",
    "grenades",
    "rounds",
    "first_contacts",
    "trajectories",
    "damages",
    "flash_events",
    "round_features",
    "matches",
    "demos",
]


def upgrade() -> None:
    """Drop the pre-split tables and rebuild from the current models."""
    for table in _DROPPED:
        op.execute(sa.text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))

    # Recreate from the ORM definitions — single source of truth for the new
    # schema (db/models.py: Demo, Match, event tables keyed by demo_id, Job
    # with kind-dependent demo_id/match_id targets).
    from db.models import Base  # noqa: PLC0415

    bind = op.get_bind()
    Base.metadata.create_all(bind)


def downgrade() -> None:
    """Docstring for downgrade."""
    raise NotImplementedError("The demo/match split reset is one-way.")
