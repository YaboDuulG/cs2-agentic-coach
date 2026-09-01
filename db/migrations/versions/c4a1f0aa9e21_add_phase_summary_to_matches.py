"""Add matches.phase_summary_json (GameStateGate strip report).

Revision ID: c4a1f0aa9e21
Revises: 8b072a51f688
Create Date: 2026-09-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c4a1f0aa9e21"
down_revision: Union[str, Sequence[str], None] = "8b072a51f688"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Docstring for upgrade."""
    op.add_column("matches", sa.Column("phase_summary_json", sa.Text(), nullable=True))


def downgrade() -> None:
    """Docstring for downgrade."""
    op.drop_column("matches", "phase_summary_json")
