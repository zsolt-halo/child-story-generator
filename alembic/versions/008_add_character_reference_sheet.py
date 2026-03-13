"""Add has_reference_sheet column to characters table

Revision ID: 008
Revises: 007
Create Date: 2026-03-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '008'
down_revision: Union[str, None] = '007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'characters',
        sa.Column('has_reference_sheet', sa.Boolean, server_default=sa.text('false'), nullable=False),
    )


def downgrade() -> None:
    op.drop_column('characters', 'has_reference_sheet')
