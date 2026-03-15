"""Add age column to characters table

Revision ID: 011
Revises: 010
Create Date: 2026-03-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '011'
down_revision: Union[str, None] = '010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('characters', sa.Column('age', sa.String(40), nullable=True))


def downgrade() -> None:
    op.drop_column('characters', 'age')
