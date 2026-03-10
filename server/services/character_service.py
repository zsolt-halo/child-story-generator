from __future__ import annotations

import logging
import uuid

from src.models import Character, CharacterPersonality, CharacterVisual, CharacterStoryRules
from src.utils.config import CHARACTERS_DIR, load_character
from src.db.character_repository import CharacterRepository

logger = logging.getLogger(__name__)
_repo = CharacterRepository()


def _row_to_dict(row) -> dict:
    """Convert a CharacterRow to an API-friendly dict."""
    return {
        "id": str(row.id),
        "slug": row.slug,
        "name": row.name,
        "child_name": row.child_name,
        "personality": {
            "traits": row.traits or [],
            "speech_style": row.speech_style or "",
        },
        "visual": {
            "description": row.visual_desc or "",
            "constants": row.visual_const or "",
            "color_palette": row.color_palette or [],
        },
        "story_rules": {
            "always": row.rules_always or "",
            "never": row.rules_never or "",
        },
        "is_template": False,
        "pipeline_id": f"custom:{row.id}",
    }


def _toml_to_dict(slug: str, char: Character) -> dict:
    """Convert a TOML-loaded Character to an API-friendly dict."""
    d = char.model_dump()
    d.update(id=None, slug=slug, is_template=True, pipeline_id=slug)
    return d


async def list_all_characters() -> list[dict]:
    """Merge TOML templates + DB custom characters."""
    results = []

    # TOML templates
    if CHARACTERS_DIR.exists():
        for path in sorted(CHARACTERS_DIR.glob("*.toml")):
            try:
                char = load_character(path.stem)
                results.append(_toml_to_dict(path.stem, char))
            except Exception:
                continue

    # DB custom characters
    db_rows = await _repo.async_list_all()
    for row in db_rows:
        results.append(_row_to_dict(row))

    return results


async def get_character(id: str) -> dict:
    """Get a single character by UUID string."""
    row = await _repo.async_get_by_id(uuid.UUID(id))
    return _row_to_dict(row)


async def create_character(data: dict) -> dict:
    """Create a new custom character from request data."""
    logger.info("Creating character: %s (slug=%s)", data.get("name"), data.get("slug"))
    char = Character(
        name=data["name"],
        child_name=data["child_name"],
        personality=CharacterPersonality(**data["personality"]),
        visual=CharacterVisual(**data["visual"]),
        story_rules=CharacterStoryRules(**data["story_rules"]),
    )
    row = await _repo.async_create(char, data["slug"])
    return _row_to_dict(row)


async def update_character(id: str, data: dict) -> dict:
    """Update a custom character."""
    # Get current row to fill in any fields not provided
    current = await _repo.async_get_by_id(uuid.UUID(id))

    char = Character(
        name=data.get("name", current.name),
        child_name=data.get("child_name", current.child_name),
        personality=CharacterPersonality(
            **(data.get("personality") or {
                "traits": current.traits or [],
                "speech_style": current.speech_style or "",
            })
        ),
        visual=CharacterVisual(
            **(data.get("visual") or {
                "description": current.visual_desc or "",
                "constants": current.visual_const or "",
                "color_palette": current.color_palette or [],
            })
        ),
        story_rules=CharacterStoryRules(
            **(data.get("story_rules") or {
                "always": current.rules_always or "",
                "never": current.rules_never or "",
            })
        ),
    )
    slug = data.get("slug", current.slug)
    updated = await _repo.async_update(uuid.UUID(id), char, slug)
    return _row_to_dict(updated)


async def delete_character(id: str) -> None:
    """Delete a custom character. Rejects if referenced by stories."""
    logger.info("Deleting character: %s", id)
    from src.db.engine import get_async_session_factory
    from src.db.models import StoryRow
    from sqlalchemy import select

    AsyncSession = get_async_session_factory()
    async with AsyncSession() as session:
        ref_pattern = f"custom:{id}"
        result = await session.execute(
            select(StoryRow.slug).where(StoryRow.character == ref_pattern).limit(1)
        )
        referencing = result.scalar_one_or_none()
        if referencing is not None:
            raise ValueError(
                f"Cannot delete: character is used by story '{referencing}'"
            )

    await _repo.async_delete(uuid.UUID(id))


async def duplicate_character(id: str) -> dict:
    """Duplicate a custom character as a new custom character."""
    source = await get_character(id)

    new_slug = f"{source['slug']}-copy"
    try:
        await _repo.async_get_by_slug(new_slug)
        import time
        new_slug = f"{source['slug']}-{int(time.time()) % 10000}"
    except FileNotFoundError:
        pass

    data = {
        "slug": new_slug,
        "name": f"{source['name']} (copy)",
        "child_name": source["child_name"],
        "personality": source["personality"],
        "visual": source["visual"],
        "story_rules": source["story_rules"],
    }
    return await create_character(data)


async def duplicate_template(slug: str) -> dict:
    """Duplicate a TOML template as a new custom character."""
    char = load_character(slug)
    data = char.model_dump()
    data["slug"] = f"{slug}-custom"
    return await create_character(data)


async def polish_character(
    name: str, child_name: str, rough_description: str
) -> dict:
    """Use Gemini to polish a rough character concept into full details."""
    logger.info("Polishing character: %s", name)
    import asyncio

    from src.brain.prompts import build_character_polish_prompt
    from src.brain.client import generate_structured
    from src.models import BookConfig

    config = BookConfig()
    system_prompt = build_character_polish_prompt()
    user_prompt = (
        f"Character name: {name}\n"
        f"Child's name: {child_name}\n"
        f"Description: {rough_description}"
    )

    result = await asyncio.to_thread(
        generate_structured,
        config,
        system_prompt,
        user_prompt,
        Character,
        max_tokens=4096,
    )

    d = result.model_dump()
    return {k: d[k] for k in ("personality", "visual", "story_rules")}
