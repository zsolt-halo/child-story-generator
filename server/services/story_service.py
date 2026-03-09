import shutil
from datetime import datetime
from pathlib import Path

from src.models import Story, CastMember
from src.utils.io import load_checkpoint, save_checkpoint, load_metadata, CHECKPOINT_FILE
from server.schemas import StoryListItem


STORIES_DIR = Path("stories")


def list_stories() -> list[StoryListItem]:
    """Scan stories directory and return metadata for each story."""
    items = []
    if not STORIES_DIR.exists():
        return items

    for story_dir in sorted(STORIES_DIR.iterdir()):
        checkpoint = story_dir / CHECKPOINT_FILE
        if not checkpoint.exists():
            continue

        try:
            story, image_paths = load_checkpoint(story_dir)
        except Exception:
            continue

        images_dir = story_dir / "images"
        has_images = images_dir.exists() and any(images_dir.glob("*.png"))
        has_pdf = (story_dir / "book.pdf").exists()

        cover_url = None
        cover_kf = next((kf for kf in story.keyframes if kf.is_cover), None)
        if cover_kf:
            cover_path = images_dir / "cover.png"
            if cover_path.exists():
                cover_url = f"/api/stories/{story_dir.name}/images/cover.png"

        created_at = None
        try:
            created_at = datetime.fromtimestamp(checkpoint.stat().st_mtime).isoformat()
        except Exception:
            pass

        meta = load_metadata(story_dir)
        parent_slug = meta.get("parent_slug") if meta else None

        items.append(StoryListItem(
            slug=story_dir.name,
            title=story.title,
            page_count=len(story.keyframes),
            has_images=has_images,
            has_pdf=has_pdf,
            cover_url=cover_url,
            created_at=created_at,
            title_translated=story.title_translated,
            parent_slug=parent_slug,
        ))

    return items


def get_story(slug: str) -> tuple[Story, list[Path], Path]:
    """Load a story by slug. Returns (story, image_paths, story_dir)."""
    story_dir = STORIES_DIR / slug
    if not (story_dir / CHECKPOINT_FILE).exists():
        raise FileNotFoundError(f"Story not found: {slug}")
    story, image_paths = load_checkpoint(story_dir)
    return story, image_paths, story_dir


def update_story(
    slug: str,
    title: str | None,
    dedication: str | None,
    keyframe_updates: dict[int, dict] | None,
    cast_updates: list[dict] | None = None,
) -> Story:
    """Update story fields and save."""
    story, image_paths, story_dir = get_story(slug)

    if title is not None:
        story.title = title
    if dedication is not None:
        story.dedication = dedication
    if keyframe_updates:
        for kf in story.keyframes:
            if kf.page_number in keyframe_updates:
                updates = keyframe_updates[kf.page_number]
                if "page_text" in updates and updates["page_text"] is not None:
                    kf.page_text = updates["page_text"]
                if "visual_description" in updates and updates["visual_description"] is not None:
                    kf.visual_description = updates["visual_description"]
                if "mood" in updates and updates["mood"] is not None:
                    kf.mood = updates["mood"]
    if cast_updates is not None:
        story.cast = [CastMember(**c) for c in cast_updates]

    save_checkpoint(story_dir, story, [str(p) for p in image_paths])
    return story


def delete_story(slug: str):
    """Delete a story directory."""
    story_dir = STORIES_DIR / slug
    if not story_dir.exists():
        raise FileNotFoundError(f"Story not found: {slug}")
    shutil.rmtree(story_dir)


def get_story_dir(slug: str) -> Path:
    """Get path to a story directory."""
    story_dir = STORIES_DIR / slug
    if not story_dir.exists():
        raise FileNotFoundError(f"Story not found: {slug}")
    return story_dir


def branch_story(source_slug: str, new_config: dict, start_from: str) -> tuple[str, Path, str]:
    """Clone a story with new config. Returns (new_slug, new_dir, notes).

    start_from: "full" = regenerate everything, "illustration" = keep story, new illustrations.
    """
    from src.utils.io import slugify

    story, image_paths, source_dir = get_story(source_slug)
    meta = load_metadata(source_dir)
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
        save_checkpoint(new_dir, branched_story, metadata=new_metadata)
    else:
        # "full" — empty story placeholder, will be regenerated
        # We need a minimal story to have a valid checkpoint
        # Actually for full, we don't save a checkpoint — the pipeline will create it
        pass

    return new_slug, new_dir, notes
