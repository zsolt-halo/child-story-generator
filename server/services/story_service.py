from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

from src.models import Story, CastMember
from src.db.repository import StoryRepository
from server.schemas import StoryListItem


STORIES_DIR = Path("stories")
_repo = StoryRepository()


async def list_stories() -> list[StoryListItem]:
    """Return metadata for each story from the database."""
    items = await _repo.async_list()
    return [StoryListItem(**item) for item in items]


async def get_story(slug: str) -> tuple[Story, list[Path], Path]:
    """Load a story by slug. Returns (story, image_paths, story_dir)."""
    story, image_paths = await _repo.async_get(slug)
    story_dir = STORIES_DIR / slug
    return story, image_paths, story_dir


async def update_story(
    slug: str,
    title: str | None,
    dedication: str | None,
    keyframe_updates: dict[int, dict] | None,
    cast_updates: list[dict] | None = None,
) -> Story:
    """Update story fields and save."""
    return await _repo.async_update(
        slug,
        title=title,
        dedication=dedication,
        keyframe_updates=keyframe_updates,
        cast_updates=cast_updates,
    )


async def delete_story(slug: str):
    """Delete a story from DB and disk."""
    await _repo.async_delete(slug)
    story_dir = STORIES_DIR / slug
    if story_dir.exists():
        shutil.rmtree(story_dir)


def get_story_dir(slug: str) -> Path:
    """Get path to a story directory."""
    story_dir = STORIES_DIR / slug
    if not story_dir.exists():
        raise FileNotFoundError(f"Story not found: {slug}")
    return story_dir


async def save_to_db(
    slug: str,
    story: Story,
    image_paths: list[str | Path] | None = None,
    metadata: dict | None = None,
) -> None:
    """Save/update a story in the database (async wrapper for pipeline use)."""
    await _repo.async_save(slug, story, image_paths=image_paths, metadata=metadata)


async def get_metadata(slug: str) -> dict | None:
    """Load metadata for a story from the database."""
    return await _repo.async_get_metadata(slug)


async def branch_story(source_slug: str, new_config: dict, start_from: str) -> tuple[str, Path, str]:
    """Clone a story with new config. Returns (new_slug, new_dir, notes).

    start_from: "full" = regenerate everything, "illustration" = keep story, new illustrations.
    """
    from src.utils.io import slugify

    story, image_paths, source_dir = await get_story(source_slug)
    meta = await get_metadata(source_slug)
    if not meta or not meta.get("notes"):
        raise ValueError("Source story has no metadata/notes — cannot branch")

    notes = meta["notes"]

    # Generate branch slug from the changed config value
    diff_keys = []
    old_cfg = meta.get("config", {})
    for key in ("style", "narrator", "character"):
        if new_config.get(key) and new_config[key] != old_cfg.get(key):
            diff_keys.append(new_config[key])
    suffix = "-".join(diff_keys) if diff_keys else "branch"

    base_slug = f"{source_slug}-{suffix}"
    new_slug = base_slug
    counter = 2
    while (STORIES_DIR / new_slug).exists():
        new_slug = f"{base_slug}-{counter}"
        counter += 1

    new_dir = STORIES_DIR / new_slug
    new_dir.mkdir(parents=True, exist_ok=True)

    new_metadata = {
        "notes": notes,
        "config": {
            "character": new_config.get("character", old_cfg.get("character", "lana-llama")),
            "narrator": new_config.get("narrator", old_cfg.get("narrator", "whimsical")),
            "style": new_config.get("style", old_cfg.get("style", "digital")),
            "pages": new_config.get("pages", old_cfg.get("pages", 16)),
            "language": new_config.get("language", old_cfg.get("language")),
        },
        "parent_slug": source_slug,
        "created_at": datetime.now().isoformat(),
    }

    if start_from == "illustration":
        # Copy story data but not images
        branched_story = story.model_copy(deep=True)
        # Clear translations if language changed
        new_lang = new_config.get("language")
        old_lang = old_cfg.get("language")
        if new_lang != old_lang:
            branched_story.title_translated = None
            branched_story.dedication_translated = None
            for kf in branched_story.keyframes:
                kf.page_text_translated = None
        await save_to_db(new_slug, branched_story, metadata=new_metadata)
    else:
        # "full" — the pipeline will create the DB entry
        pass

    return new_slug, new_dir, notes
