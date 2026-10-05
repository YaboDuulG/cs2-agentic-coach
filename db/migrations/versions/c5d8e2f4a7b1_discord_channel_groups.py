"""Discord channel groups: one channel per map.

team_discord_links gains category_id (the bound channel group); the new
team_discord_channels table caches which channel of that group stands for
which map; team_discord_ingest_cursors remembers where `/strat ingest` got to
in each channel.

Revision ID: c5d8e2f4a7b1
Revises: a1c7e9b3d5f2
Create Date: 2026-10-02
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c5d8e2f4a7b1"
down_revision: Union[str, Sequence[str], None] = "a1c7e9b3d5f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Docstring for upgrade."""
    op.add_column("team_discord_links", sa.Column("category_id", sa.String(32), nullable=True))
    op.create_table(
        "team_discord_channels",
        sa.Column("channel_id", sa.String(32), primary_key=True),
        sa.Column(
            "team_id",
            sa.String(36),
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("map_name", sa.String(64), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_team_discord_channels_team_id", "team_discord_channels", ["team_id"])
    op.create_index("ix_team_discord_channels_map_name", "team_discord_channels", ["map_name"])
    op.create_table(
        "team_discord_ingest_cursors",
        sa.Column("channel_id", sa.String(32), primary_key=True),
        sa.Column(
            "team_id",
            sa.String(36),
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("last_message_id", sa.String(32), nullable=True),
        sa.Column("last_run_at", sa.DateTime, nullable=True),
        sa.Column("messages_read", sa.Integer, nullable=False, server_default="0"),
        sa.Column("strategies_saved", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_index(
        "ix_team_discord_ingest_cursors_team_id", "team_discord_ingest_cursors", ["team_id"]
    )


def downgrade() -> None:
    """Docstring for downgrade."""
    op.drop_index("ix_team_discord_ingest_cursors_team_id", table_name="team_discord_ingest_cursors")
    op.drop_table("team_discord_ingest_cursors")
    op.drop_index("ix_team_discord_channels_map_name", table_name="team_discord_channels")
    op.drop_index("ix_team_discord_channels_team_id", table_name="team_discord_channels")
    op.drop_table("team_discord_channels")
    op.drop_column("team_discord_links", "category_id")
