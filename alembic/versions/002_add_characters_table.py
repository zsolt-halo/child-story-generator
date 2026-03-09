"""Add characters table and widen stories.character column

Revision ID: 002
Revises: 001
Create Date: 2026-03-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ARRAY

# revision identifiers, used by Alembic.
revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'characters',
        sa.Column('id', UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('slug', sa.String(200), unique=True, nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('child_name', sa.String(200), nullable=False),
        sa.Column('traits', ARRAY(sa.String)),
        sa.Column('speech_style', sa.Text),
        sa.Column('visual_desc', sa.Text),
        sa.Column('visual_const', sa.Text),
        sa.Column('color_palette', ARRAY(sa.String)),
        sa.Column('rules_always', sa.Text),
        sa.Column('rules_never', sa.Text),
        sa.Column('is_template', sa.Boolean, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    # Widen stories.character from String(80) to String(200) to accommodate
    # "custom:<uuid>" identifiers for DB-stored characters.
    op.alter_column(
        'stories',
        'character',
        existing_type=sa.String(80),
        type_=sa.String(200),
        existing_server_default='lana-llama',
    )


def downgrade() -> None:
    op.alter_column(
        'stories',
        'character',
        existing_type=sa.String(200),
        type_=sa.String(80),
        existing_server_default='lana-llama',
    )
    op.drop_table('characters')
