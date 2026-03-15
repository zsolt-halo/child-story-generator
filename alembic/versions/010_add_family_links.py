"""Add family_links table and family selection columns to stories

Revision ID: 010
Revises: 009
Create Date: 2026-03-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ARRAY

# revision identifiers, used by Alembic.
revision: str = '010'
down_revision: Union[str, None] = '009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'family_links',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('character_id', UUID(as_uuid=True), sa.ForeignKey('characters.id', ondelete='CASCADE'), nullable=False),
        sa.Column('member_id', UUID(as_uuid=True), sa.ForeignKey('characters.id', ondelete='CASCADE'), nullable=False),
        sa.Column('relationship_label', sa.String(100), nullable=False),
        sa.Column('sort_order', sa.Integer, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('character_id', 'member_id', name='uq_family_link'),
    )

    op.add_column(
        'stories',
        sa.Column('selected_family_ids', ARRAY(UUID(as_uuid=True)), nullable=True),
    )
    op.add_column(
        'stories',
        sa.Column('allow_extra_cast', sa.Boolean, server_default='true', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('stories', 'allow_extra_cast')
    op.drop_column('stories', 'selected_family_ids')
    op.drop_table('family_links')
