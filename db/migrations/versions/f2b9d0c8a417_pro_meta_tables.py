"""Pro meta registry tables for the HLTV RAG engine (services/rag_engine).

pro_tournaments / pro_matches / pro_rounds / pro_strat_archetypes.
Demo binaries never land in the DB — URI columns only.

Revision ID: f2b9d0c8a417
Revises: c4a1f0aa9e21
Create Date: 2026-09-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "f2b9d0c8a417"
down_revision: Union[str, Sequence[str], None] = "c4a1f0aa9e21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Docstring for upgrade."""
    op.create_table(
        "pro_tournaments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("hltv_event_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("tier", sa.String(length=1), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("tier IN ('S', 'A')", name="ck_pro_tournaments_tier"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_pro_tournaments_hltv_event_id"), "pro_tournaments", ["hltv_event_id"], unique=True
    )

    op.create_table(
        "pro_matches",
        sa.Column("hltv_match_id", sa.String(length=32), nullable=False),
        sa.Column("tournament_id", sa.Integer(), nullable=False),
        sa.Column("team_a", sa.String(length=128), nullable=False),
        sa.Column("team_b", sa.String(length=128), nullable=False),
        sa.Column("map_name", sa.String(length=64), nullable=False),
        sa.Column("played_at", sa.DateTime(), nullable=True),
        sa.Column("demo_gcs_uri", sa.Text(), nullable=True),
        sa.Column("parsed_gcs_uri", sa.Text(), nullable=True),
        sa.Column("patch_version", sa.String(length=32), nullable=True),
        sa.Column("ingested_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["tournament_id"], ["pro_tournaments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("hltv_match_id"),
    )
    op.create_index(
        op.f("ix_pro_matches_tournament_id"), "pro_matches", ["tournament_id"], unique=False
    )
    op.create_index(
        op.f("ix_pro_matches_ingested_at"), "pro_matches", ["ingested_at"], unique=False
    )

    op.create_table(
        "pro_rounds",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("pro_match_id", sa.String(length=32), nullable=False),
        sa.Column("round_num", sa.Integer(), nullable=False),
        sa.Column("side", sa.String(length=8), nullable=False),
        sa.Column("buy_type", sa.String(length=16), nullable=False),
        sa.Column("round_type", sa.String(length=16), nullable=False),
        sa.Column("winner", sa.String(length=8), nullable=False),
        sa.Column("archetype_label", sa.String(length=128), nullable=False),
        sa.Column("metrics_json", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["pro_match_id"], ["pro_matches.hltv_match_id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_pro_rounds_pro_match_id"), "pro_rounds", ["pro_match_id"], unique=False
    )

    op.create_table(
        "pro_strat_archetypes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("map_name", sa.String(length=64), nullable=False),
        sa.Column("side", sa.String(length=8), nullable=False),
        sa.Column("buy_type", sa.String(length=16), nullable=False),
        sa.Column("round_type", sa.String(length=16), nullable=False),
        sa.Column("team_name", sa.String(length=255), nullable=False),
        sa.Column("patch_version", sa.String(length=32), nullable=True),
        sa.Column("summary_text", sa.Text(), nullable=False),
        sa.Column("metrics_json", sa.Text(), nullable=False),
        sa.Column("qdrant_point_id", sa.String(length=64), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_pro_strat_archetypes_map_name"), "pro_strat_archetypes", ["map_name"], unique=False
    )


def downgrade() -> None:
    """Docstring for downgrade."""
    op.drop_index(op.f("ix_pro_strat_archetypes_map_name"), table_name="pro_strat_archetypes")
    op.drop_table("pro_strat_archetypes")
    op.drop_index(op.f("ix_pro_rounds_pro_match_id"), table_name="pro_rounds")
    op.drop_table("pro_rounds")
    op.drop_index(op.f("ix_pro_matches_ingested_at"), table_name="pro_matches")
    op.drop_index(op.f("ix_pro_matches_tournament_id"), table_name="pro_matches")
    op.drop_table("pro_matches")
    op.drop_index(op.f("ix_pro_tournaments_hltv_event_id"), table_name="pro_tournaments")
    op.drop_table("pro_tournaments")
