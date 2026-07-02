"""add_linked_accounts_table

Revision ID: e2a98e14bd86
Revises: 090962b1b256
Create Date: 2026-07-01 04:38:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e2a98e14bd86'
down_revision: Union[str, Sequence[str], None] = '090962b1b256'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create linked_accounts table for Steam/FACEIT OAuth account linking."""
    op.create_table(
        'linked_accounts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.String(length=64), nullable=False),
        sa.Column('provider', sa.String(length=32), nullable=False),
        sa.Column('provider_user_id', sa.String(length=64), nullable=False),
        sa.Column('access_token', sa.Text(), nullable=True),
        sa.Column('refresh_token', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_linked_accounts_user_id'),
        'linked_accounts',
        ['user_id'],
        unique=False,
    )


def downgrade() -> None:
    """Drop linked_accounts table."""
    op.drop_index(op.f('ix_linked_accounts_user_id'), table_name='linked_accounts')
    op.drop_table('linked_accounts')
