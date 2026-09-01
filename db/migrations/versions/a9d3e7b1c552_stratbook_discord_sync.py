"""Stratbook state machine + Discord binding + sync outbox (module 3).

Backfills existing TeamPlaybook rows as ACTIVE strats at revision 1 so the
old stratbook content survives the move to versioned strats.

Revision ID: a9d3e7b1c552
Revises: f2b9d0c8a417
Create Date: 2026-09-01
"""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa

revision: str = "a9d3e7b1c552"
down_revision: Union[str, Sequence[str], None] = "f2b9d0c8a417"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STRAT_STATUS = sa.Enum("DRAFT", "IN_REVIEW", "ACTIVE", "ARCHIVED", name="stratstatus")
_OUTBOX_STATUS = sa.Enum("pending", "running", "done", "failed", name="outboxstatus")


def upgrade() -> None:
    """Docstring for upgrade."""
    op.create_table(
        "strats",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "team_id",
            sa.String(36),
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("title", sa.String(128), nullable=False),
        sa.Column("map_name", sa.String(64), nullable=False, index=True),
        sa.Column("side", sa.String(8), nullable=False, server_default="T"),
        sa.Column("buy_type", sa.String(16), nullable=False, server_default="full_buy"),
        sa.Column("status", _STRAT_STATUS, nullable=False, server_default="DRAFT", index=True),
        sa.Column("current_revision_id", sa.Integer(), nullable=True),
        sa.Column("discord_thread_id", sa.String(32), nullable=True, index=True),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "strat_revisions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "strat_id",
            sa.String(36),
            sa.ForeignKey("strats.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("revision_no", sa.Integer(), nullable=False),
        sa.Column("canvas_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("utility_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("author_id", sa.String(64), nullable=False),
        sa.Column("source", sa.String(16), nullable=False, server_default="web"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "team_discord_links",
        sa.Column(
            "team_id",
            sa.String(36),
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("guild_id", sa.String(32), nullable=False, unique=True, index=True),
        sa.Column("channel_id", sa.String(32), nullable=False),
        sa.Column("bound_by", sa.String(64), nullable=False),
        sa.Column("bound_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "sync_outbox",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("status", _OUTBOX_STATUS, nullable=False, server_default="pending", index=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    # Backfill: every TeamPlaybook entry becomes an ACTIVE strat @ revision 1.
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, team_id, map_name, title, playbook_json, created_at FROM team_playbooks")
    ).fetchall()
    for row in rows:
        strat_id = str(uuid.uuid4())
        conn.execute(
            sa.text(
                "INSERT INTO strats (id, team_id, title, map_name, side, buy_type, status,"
                " created_by, created_at, updated_at) VALUES (:id, :team_id, :title, :map_name,"
                " 'T', 'full_buy', 'ACTIVE', 'backfill', :created_at, :created_at)"
            ),
            {
                "id": strat_id,
                "team_id": row.team_id,
                "title": row.title,
                "map_name": row.map_name,
                "created_at": row.created_at,
            },
        )
        conn.execute(
            sa.text(
                "INSERT INTO strat_revisions (strat_id, revision_no, canvas_json, description,"
                " author_id, source, created_at) VALUES (:strat_id, 1, :canvas, '', 'backfill',"
                " 'web', :created_at)"
            ),
            {"strat_id": strat_id, "canvas": row.playbook_json, "created_at": row.created_at},
        )
        conn.execute(
            sa.text(
                "UPDATE strats SET current_revision_id ="
                " (SELECT id FROM strat_revisions WHERE strat_id = :sid AND revision_no = 1)"
                " WHERE id = :sid"
            ),
            {"sid": strat_id},
        )


def downgrade() -> None:
    """Docstring for downgrade."""
    op.drop_table("sync_outbox")
    op.drop_table("team_discord_links")
    op.drop_table("strat_revisions")
    op.drop_table("strats")
    _STRAT_STATUS.drop(op.get_bind(), checkfirst=True)
    _OUTBOX_STATUS.drop(op.get_bind(), checkfirst=True)
