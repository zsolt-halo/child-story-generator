"""Add text_model column to presets table

Revision ID: 006
Revises: 005
Create Date: 2026-03-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '006'
down_revision: Union[str, None] = '005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('presets', sa.Column('text_model', sa.String(60), server_default='gemini-2.5-pro', nullable=False))


def downgrade() -> None:
    op.drop_column('presets', 'text_model')
