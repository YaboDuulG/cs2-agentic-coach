"""Telemetry v2: map_zones, damages, flash_events, round_features.

Revision ID: b7f4d2e8a901
Revises: e8c2b5d90f14
Create Date: 2026-09-02
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b7f4d2e8a901"
down_revision: Union[str, Sequence[str], None] = "e8c2b5d90f14"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Docstring for upgrade."""
    op.create_table(
        "map_zones",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("map_name", sa.String(64), nullable=False, index=True),
        sa.Column("zone_key", sa.String(64), nullable=False),
        sa.Column("display_name", sa.String(64), nullable=False),
        sa.Column("min_x", sa.Float(), nullable=False),
        sa.Column("min_y", sa.Float(), nullable=False),
        sa.Column("max_x", sa.Float(), nullable=False),
        sa.Column("max_y", sa.Float(), nullable=False),
        sa.Column("z_floor", sa.Float(), nullable=True),
        sa.Column("tag", sa.String(16), nullable=False, server_default=""),
        sa.UniqueConstraint("map_name", "zone_key"),
    )
    op.create_table(
        "damages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "match_id",
            sa.String(36),
            sa.ForeignKey("matches.match_id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("round_num", sa.Integer(), nullable=False),
        sa.Column("tick", sa.Integer(), nullable=False),
        sa.Column("attacker_steamid", sa.String(32), nullable=True),
        sa.Column("victim_steamid", sa.String(32), nullable=True),
        sa.Column("weapon", sa.String(32), nullable=False, server_default=""),
        sa.Column("hp_damage", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("armor_damage", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hitgroup", sa.String(16), nullable=False, server_default=""),
        sa.Column("is_utility", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "flash_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "match_id",
            sa.String(36),
            sa.ForeignKey("matches.match_id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("round_num", sa.Integer(), nullable=False),
        sa.Column("tick", sa.Integer(), nullable=False),
        sa.Column("thrower_steamid", sa.String(32), nullable=True),
        sa.Column("blinded_steamid", sa.String(32), nullable=True),
        sa.Column("blind_duration", sa.Float(), nullable=False, server_default="0"),
        sa.Column("is_teammate", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "round_features",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "match_id",
            sa.String(36),
            sa.ForeignKey("matches.match_id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("round_num", sa.Integer(), nullable=False),
        sa.Column("side_focus", sa.String(4), nullable=False),
        sa.Column("opening_duel_won", sa.Boolean(), nullable=True),
        sa.Column("opening_zone", sa.String(64), nullable=True),
        sa.Column("opening_flash_assist", sa.Boolean(), nullable=True),
        sa.Column("util_damage", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("enemy_blind_seconds", sa.Float(), nullable=False, server_default="0"),
        sa.Column("team_blind_seconds", sa.Float(), nullable=False, server_default="0"),
        sa.Column("smoke_coverage_score", sa.Float(), nullable=True),
        sa.Column("trade_success_rate", sa.Float(), nullable=True),
        sa.Column("avg_trade_window_s", sa.Float(), nullable=True),
        sa.Column("exec_sync_score", sa.Float(), nullable=True),
        sa.Column("archetype_label", sa.String(128), nullable=True),
        sa.UniqueConstraint("match_id", "round_num", "side_focus"),
    )


def downgrade() -> None:
    """Docstring for downgrade."""
    for t in ("round_features", "flash_events", "damages", "map_zones"):
        op.drop_table(t)
