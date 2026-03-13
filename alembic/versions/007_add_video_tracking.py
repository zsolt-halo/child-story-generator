"""Add has_video columns for animation tracking

Revision ID: 007
Revises: 006
Create Date: 2026-03-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '007'
down_revision: Union[str, None] = '006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('stories', sa.Column('has_video', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('keyframes', sa.Column('has_video', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('keyframes', 'has_video')
    op.drop_column('stories', 'has_video')
