"""Add beat_summary column to keyframes table

Revision ID: 004
Revises: 003
Create Date: 2026-03-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '004'
down_revision: Union[str, None] = '003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('keyframes', sa.Column('beat_summary', sa.String(200), server_default='', nullable=False))


def downgrade() -> None:
    op.drop_column('keyframes', 'beat_summary')
