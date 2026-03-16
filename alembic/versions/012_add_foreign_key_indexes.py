"""Add indexes on foreign key columns for query performance

PostgreSQL does not auto-create indexes on FK columns. These indexes
speed up the selectin loads used by story detail and character pages.

Revision ID: 012
Revises: 011
Create Date: 2026-03-16

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '012'
down_revision: Union[str, None] = '011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_keyframes_story_id', 'keyframes', ['story_id'])
    op.create_index('ix_cast_members_story_id', 'cast_members', ['story_id'])
    op.create_index('ix_family_links_character_id', 'family_links', ['character_id'])
    op.create_index('ix_family_links_member_id', 'family_links', ['member_id'])


def downgrade() -> None:
    op.drop_index('ix_family_links_member_id', 'family_links')
    op.drop_index('ix_family_links_character_id', 'family_links')
    op.drop_index('ix_cast_members_story_id', 'cast_members')
    op.drop_index('ix_keyframes_story_id', 'keyframes')
