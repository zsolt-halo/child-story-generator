"""Initial schema: stories, keyframes, cast_members

Revision ID: 001
Revises:
Create Date: 2026-03-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ARRAY

# revision identifiers, used by Alembic.
revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'stories',
        sa.Column('id', UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('slug', sa.String(80), unique=True, nullable=False),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('dedication', sa.Text, server_default=''),
        sa.Column('title_translated', sa.String(500)),
        sa.Column('dedication_translated', sa.Text),
        sa.Column('notes', sa.Text),
        sa.Column('parent_slug', sa.String(80)),
        sa.Column('character', sa.String(80), server_default='lana-llama'),
        sa.Column('narrator', sa.String(40), server_default='whimsical'),
        sa.Column('style', sa.String(40), server_default='digital'),
        sa.Column('pages', sa.Integer, server_default='16'),
        sa.Column('language', sa.String(40)),
        sa.Column('has_images', sa.Boolean, server_default=sa.text('false')),
        sa.Column('has_pdf', sa.Boolean, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    op.create_table(
        'keyframes',
        sa.Column('id', UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('story_id', UUID(as_uuid=True), sa.ForeignKey('stories.id', ondelete='CASCADE'), nullable=False),
        sa.Column('page_number', sa.Integer, nullable=False),
        sa.Column('page_text', sa.Text, nullable=False),
        sa.Column('visual_description', sa.Text, nullable=False),
        sa.Column('mood', sa.String(100), nullable=False),
        sa.Column('is_cover', sa.Boolean, server_default=sa.text('false')),
        sa.Column('page_text_translated', sa.Text),
        sa.Column('has_image', sa.Boolean, server_default=sa.text('false')),
        sa.UniqueConstraint('story_id', 'page_number'),
    )

    op.create_table(
        'cast_members',
        sa.Column('id', UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('story_id', UUID(as_uuid=True), sa.ForeignKey('stories.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(200)),
        sa.Column('role', sa.String(200)),
        sa.Column('species', sa.String(200)),
        sa.Column('visual_description', sa.Text),
        sa.Column('visual_constants', sa.Text),
        sa.Column('appears_on_pages', ARRAY(sa.Integer)),
    )


def downgrade() -> None:
    op.drop_table('cast_members')
    op.drop_table('keyframes')
    op.drop_table('stories')
