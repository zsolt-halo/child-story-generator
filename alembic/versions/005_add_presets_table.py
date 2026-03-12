"""Add presets table for auto-generation configuration

Revision ID: 005
Revises: 004
Create Date: 2026-03-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = '005'
down_revision: Union[str, None] = '004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'presets',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('character', sa.String(200), server_default='lana-llama', nullable=False),
        sa.Column('narrator', sa.String(40), server_default='whimsical', nullable=False),
        sa.Column('style', sa.String(40), server_default='digital', nullable=False),
        sa.Column('pages', sa.Integer, server_default='16', nullable=False),
        sa.Column('language', sa.String(40), nullable=True),
        sa.Column('is_default', sa.Boolean, server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('presets')
