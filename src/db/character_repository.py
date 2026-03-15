from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from src.db.engine import get_async_session_factory
from src.db.models import CharacterRow
from src.models import Character, CharacterPersonality, CharacterVisual, CharacterStoryRules


# ---------------------------------------------------------------------------
# Conversion helpers
# ---------------------------------------------------------------------------


def _row_to_character(row: CharacterRow) -> Character:
    """Convert a flat CharacterRow into a nested Pydantic Character."""
    return Character(
        name=row.name,
        child_name=row.child_name,
        personality=CharacterPersonality(
            traits=row.traits or [],
            speech_style=row.speech_style or "",
        ),
        visual=CharacterVisual(
            description=row.visual_desc or "",
            constants=row.visual_const or "",
            color_palette=row.color_palette or [],
        ),
        story_rules=CharacterStoryRules(
            always=row.rules_always or "",
            never=row.rules_never or "",
        ),
    )


def _character_to_row(char: Character, slug: str, is_template: bool = False) -> CharacterRow:
    """Convert a nested Pydantic Character into a flat CharacterRow."""
    return CharacterRow(
        slug=slug,
        name=char.name,
        child_name=char.child_name,
        traits=char.personality.traits,
        speech_style=char.personality.speech_style,
        visual_desc=char.visual.description,
        visual_const=char.visual.constants,
        color_palette=char.visual.color_palette,
        rules_always=char.story_rules.always,
        rules_never=char.story_rules.never,
        is_template=is_template,
    )


# ---------------------------------------------------------------------------
# Repository
# ---------------------------------------------------------------------------


class CharacterRepository:
    """Async data access for characters."""

    async def async_list_all(self) -> list[CharacterRow]:
        """Return all character rows, newest first."""
        AsyncSession = get_async_session_factory()
        async with AsyncSession() as session:
            result = await session.execute(
                select(CharacterRow).order_by(CharacterRow.created_at.desc())
            )
            return list(result.scalars().all())

    async def async_get_by_id(self, id: uuid.UUID) -> CharacterRow:
        """Load a character row by UUID."""
        AsyncSession = get_async_session_factory()
        async with AsyncSession() as session:
            result = await session.execute(
                select(CharacterRow).where(CharacterRow.id == id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                raise FileNotFoundError(f"Character not found: {id}")
            return row

    async def async_get_by_slug(self, slug: str) -> CharacterRow:
        """Load a character row by slug."""
        AsyncSession = get_async_session_factory()
        async with AsyncSession() as session:
            result = await session.execute(
                select(CharacterRow).where(CharacterRow.slug == slug)
            )
            row = result.scalar_one_or_none()
            if row is None:
                raise FileNotFoundError(f"Character not found: {slug}")
            return row

    async def async_create(self, char: Character, slug: str) -> CharacterRow:
        """Insert a new character and return the row."""
        AsyncSession = get_async_session_factory()
        async with AsyncSession() as session:
            row = _character_to_row(char, slug)
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return row

    async def async_update(self, id: uuid.UUID, char: Character, slug: str) -> CharacterRow:
        """Update an existing character by UUID and return the updated row."""
        AsyncSession = get_async_session_factory()
        async with AsyncSession() as session:
            result = await session.execute(
                select(CharacterRow).where(CharacterRow.id == id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                raise FileNotFoundError(f"Character not found: {id}")

            row.slug = slug
            row.name = char.name
            row.child_name = char.child_name
            row.traits = char.personality.traits
            row.speech_style = char.personality.speech_style
            row.visual_desc = char.visual.description
            row.visual_const = char.visual.constants
            row.color_palette = char.visual.color_palette
            row.rules_always = char.story_rules.always
            row.rules_never = char.story_rules.never
            row.updated_at = datetime.now(timezone.utc)

            await session.commit()
            await session.refresh(row)
            return row

    async def async_delete(self, id: uuid.UUID) -> None:
        """Delete a character by UUID."""
        AsyncSession = get_async_session_factory()
        async with AsyncSession() as session:
            result = await session.execute(
                select(CharacterRow).where(CharacterRow.id == id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                raise FileNotFoundError(f"Character not found: {id}")
            await session.delete(row)
            await session.commit()

    async def async_set_has_reference_sheet(self, char_id: uuid.UUID, value: bool = True) -> None:
        """Update the has_reference_sheet flag for a character."""
        AsyncSession = get_async_session_factory()
        async with AsyncSession() as session:
            row = await session.get(CharacterRow, char_id)
            if row:
                row.has_reference_sheet = value
                await session.commit()

    async def async_set_photo_path(self, char_id: uuid.UUID, path: str | None) -> None:
        """Set or clear the photo_path for a character."""
        AsyncSession = get_async_session_factory()
        async with AsyncSession() as session:
            row = await session.get(CharacterRow, char_id)
            if row:
                row.photo_path = path
                await session.commit()

