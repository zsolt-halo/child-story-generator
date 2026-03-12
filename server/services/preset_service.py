from __future__ import annotations

import logging

from sqlalchemy import select, update

from src.db.engine import get_async_session_factory
from src.db.models import PresetRow
from server.schemas import PresetDetail

logger = logging.getLogger(__name__)


def _row_to_detail(row: PresetRow) -> PresetDetail:
    return PresetDetail(
        id=str(row.id),
        name=row.name,
        character=row.character,
        narrator=row.narrator,
        style=row.style,
        pages=row.pages,
        language=row.language,
        text_model=row.text_model,
        is_default=row.is_default,
    )


async def list_presets() -> list[PresetDetail]:
    AsyncSession = get_async_session_factory()
    async with AsyncSession() as session:
        result = await session.execute(
            select(PresetRow).order_by(PresetRow.is_default.desc(), PresetRow.created_at)
        )
        return [_row_to_detail(r) for r in result.scalars().all()]


async def get_preset(preset_id: str) -> PresetDetail | None:
    AsyncSession = get_async_session_factory()
    async with AsyncSession() as session:
        from uuid import UUID
        result = await session.execute(
            select(PresetRow).where(PresetRow.id == UUID(preset_id))
        )
        row = result.scalar_one_or_none()
        return _row_to_detail(row) if row else None


async def create_preset(
    name: str,
    character: str,
    narrator: str,
    style: str,
    pages: int,
    language: str | None,
    text_model: str = "gemini-2.5-pro",
    is_default: bool = False,
) -> PresetDetail:
    AsyncSession = get_async_session_factory()
    async with AsyncSession() as session:
        # If this is the default, clear any existing default
        if is_default:
            await session.execute(
                update(PresetRow).where(PresetRow.is_default == True).values(is_default=False)
            )
        row = PresetRow(
            name=name,
            character=character,
            narrator=narrator,
            style=style,
            pages=pages,
            language=language,
            text_model=text_model,
            is_default=is_default,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        logger.info("Created preset: %s (id=%s, default=%s)", name, row.id, is_default)
        return _row_to_detail(row)


async def update_preset(preset_id: str, **kwargs) -> PresetDetail:
    from uuid import UUID
    AsyncSession = get_async_session_factory()
    async with AsyncSession() as session:
        result = await session.execute(
            select(PresetRow).where(PresetRow.id == UUID(preset_id))
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise FileNotFoundError(f"Preset not found: {preset_id}")

        # If setting as default, clear others
        if kwargs.get("is_default"):
            await session.execute(
                update(PresetRow)
                .where(PresetRow.is_default == True, PresetRow.id != row.id)
                .values(is_default=False)
            )

        for key, val in kwargs.items():
            if val is not None and hasattr(row, key):
                setattr(row, key, val)

        await session.commit()
        await session.refresh(row)
        return _row_to_detail(row)


async def delete_preset(preset_id: str) -> None:
    from uuid import UUID
    AsyncSession = get_async_session_factory()
    async with AsyncSession() as session:
        result = await session.execute(
            select(PresetRow).where(PresetRow.id == UUID(preset_id))
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise FileNotFoundError(f"Preset not found: {preset_id}")
        await session.delete(row)
        await session.commit()
        logger.info("Deleted preset: %s", preset_id)
