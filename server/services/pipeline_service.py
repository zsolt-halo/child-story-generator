from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path

from src.models import BookConfig, Story
from src.utils.config import build_config, load_character, load_style
from src.utils.io import slugify

from server.services.task_manager import task_manager


async def _save(slug: str, story: Story, image_paths: list[str | Path] | None = None, metadata: dict | None = None):
    """Save story to DB via story_service."""
    from server.services.story_service import save_to_db
    await save_to_db(slug, story, image_paths=image_paths, metadata=metadata)


async def _config_from_metadata(slug: str) -> tuple[BookConfig, dict | None]:
    """Load config from DB metadata, falling back to settings.toml defaults."""
    from server.services.story_service import get_metadata
    meta = await get_metadata(slug)
    if meta and meta.get("config"):
        mc = meta["config"]
        config = build_config(
            character=mc.get("character"),
            narrator=mc.get("narrator"),
            style=mc.get("style"),
            pages=mc.get("pages"),
        )
        return config, meta
    return build_config(), meta


async def run_full_pipeline(
    task_id: str,
    notes: str,
    character: str,
    narrator: str,
    style: str,
    pages: int,
    language: str | None,
) -> dict:
    """Run the full pipeline: story → keyframes → translation → illustrations → backdrops → PDF."""
    config = build_config(character=character, narrator=narrator, style=style, pages=pages)
    char = load_character(config.character)
    style_data = load_style(config.style)
    style_desc = style_data["description"]
    style_anchor = style_data.get("anchor", style_desc)

    # Phase 1: Story
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "story", "message": "Generating story..."
    })
    from src.brain.storyteller import generate_story
    title, prose = await asyncio.to_thread(generate_story, notes, char, config, style_desc)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "story",
        "data": {"title": title, "word_count": len(prose.split())},
    })

    # Phase 2: Keyframes
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "keyframes", "message": "Breaking story into pages..."
    })
    from src.brain.keyframer import generate_keyframes
    story = await asyncio.to_thread(generate_keyframes, title, prose, char, config, style_desc)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "keyframes",
        "data": {"page_count": len(story.keyframes)},
    })

    # Save checkpoint with metadata
    output_dir = Path("stories") / slugify(story.title)
    metadata = {
        "notes": notes,
        "config": {
            "character": character,
            "narrator": narrator,
            "style": style,
            "pages": pages,
            "language": language,
        },
        "parent_slug": None,
        "created_at": datetime.now().isoformat(),
    }
    slug = output_dir.name
    await _save(slug, story, metadata=metadata)

    # Phase 2.5: Cast Extraction
    if not story.cast:
        await task_manager.broadcast(task_id, {
            "type": "phase_start", "phase": "cast",
            "message": "Analyzing character cast for consistency...",
        })
        from src.brain.cast_extractor import extract_cast
        story = await asyncio.to_thread(extract_cast, story, char, config)
        await _save(slug, story)
        await task_manager.broadcast(task_id, {
            "type": "phase_complete", "phase": "cast",
            "data": {"cast_count": len(story.cast), "members": [m.model_dump() for m in story.cast]},
        })

    # Phase 2b: Translation
    if language:
        await task_manager.broadcast(task_id, {
            "type": "phase_start", "phase": "translation", "message": f"Translating to {language}..."
        })
        from src.brain.translator import translate_story
        story = await asyncio.to_thread(translate_story, story, language, config)
        await _save(slug, story)
        await task_manager.broadcast(task_id, {
            "type": "phase_complete", "phase": "translation",
            "data": {"translated_title": story.title_translated},
        })

    # Phase 3: Illustrations
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "illustration",
        "message": "Generating illustrations...",
        "data": {"total": len(story.keyframes)},
    })

    from src.artist.generator import (
        build_image_prompt, create_image_client, generate_single_image, upscale_for_print,
    )
    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    client = create_image_client(config)
    image_paths: list[Path] = []

    for i, kf in enumerate(story.keyframes):
        prefix = "cover" if kf.is_cover else f"page_{kf.page_number:02d}"
        final_path = images_dir / f"{prefix}.png"

        if final_path.exists():
            image_paths.append(final_path)
            await task_manager.broadcast(task_id, {
                "type": "image_complete", "page": kf.page_number,
                "is_cover": kf.is_cover, "skipped": True,
                "url": f"/api/stories/{slug}/images/{final_path.name}",
                "progress": i + 1, "total": len(story.keyframes),
            })
            continue

        prompt = build_image_prompt(kf, char, style_anchor, title=story.title, cast=story.cast or None)
        raw_path = images_dir / f"{prefix}_raw.png"

        await asyncio.to_thread(generate_single_image, client, prompt, config.image_model, raw_path)
        await asyncio.to_thread(upscale_for_print, raw_path, final_path)

        image_paths.append(final_path)
        await task_manager.broadcast(task_id, {
            "type": "image_complete", "page": kf.page_number,
            "is_cover": kf.is_cover, "skipped": False,
            "url": f"/api/stories/{slug}/images/{final_path.name}",
            "progress": i + 1, "total": len(story.keyframes),
        })

        if i < len(story.keyframes) - 1:
            await asyncio.sleep(2.0)

    await _save(slug, story, [str(p) for p in image_paths])
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "illustration",
    })

    # Phase 3b: Backdrops
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "backdrops", "message": "Generating backdrops..."
    })
    from src.artist.generator import generate_backdrops
    backdrops_dir = output_dir / "backdrops"
    backdrop_paths = await asyncio.to_thread(generate_backdrops, config, style_anchor, backdrops_dir)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "backdrops",
        "data": {"count": len(backdrop_paths)},
    })

    # Phase 4: PDF
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "pdf", "message": "Rendering PDF..."
    })
    from src.publisher.layout import render_book_pdf
    pdf_path = output_dir / "book.pdf"
    await asyncio.to_thread(render_book_pdf, story, image_paths, pdf_path, backdrop_paths)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "pdf",
    })

    return {"slug": slug, "title": story.title}


async def run_story_only(
    task_id: str,
    notes: str,
    character: str,
    narrator: str,
    style: str,
    pages: int,
    output_slug: str | None = None,
    language: str | None = None,
    parent_slug: str | None = None,
) -> dict:
    """Run Phase 1+2 only (story + keyframes)."""
    config = build_config(character=character, narrator=narrator, style=style, pages=pages)
    char = load_character(config.character)
    style_data = load_style(config.style)
    style_desc = style_data["description"]

    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "story", "message": "Generating story..."
    })
    from src.brain.storyteller import generate_story
    title, prose = await asyncio.to_thread(generate_story, notes, char, config, style_desc)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "story",
        "data": {"title": title, "word_count": len(prose.split())},
    })

    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "keyframes", "message": "Breaking story into pages..."
    })
    from src.brain.keyframer import generate_keyframes
    story = await asyncio.to_thread(generate_keyframes, title, prose, char, config, style_desc)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "keyframes",
        "data": {"page_count": len(story.keyframes)},
    })

    slug = output_slug or slugify(story.title)
    output_dir = Path("stories") / slug
    output_dir.mkdir(parents=True, exist_ok=True)
    metadata = {
        "notes": notes,
        "config": {
            "character": character,
            "narrator": narrator,
            "style": style,
            "pages": pages,
            "language": language,
        },
        "parent_slug": parent_slug,
        "created_at": datetime.now().isoformat(),
    }
    await _save(slug, story, metadata=metadata)

    # Phase 2.5: Cast Extraction
    if not story.cast:
        await task_manager.broadcast(task_id, {
            "type": "phase_start", "phase": "cast",
            "message": "Analyzing character cast for consistency...",
        })
        from src.brain.cast_extractor import extract_cast
        story = await asyncio.to_thread(extract_cast, story, char, config)
        await _save(slug, story)
        await task_manager.broadcast(task_id, {
            "type": "phase_complete", "phase": "cast",
            "data": {
                "cast_count": len(story.cast),
                "members": [m.model_dump() for m in story.cast],
            },
        })

    return {"slug": slug, "title": story.title}


async def run_cast_extraction(task_id: str, slug: str) -> dict:
    """Run cast extraction on an existing story."""
    from server.services.story_service import get_story
    story, image_paths, story_dir = await get_story(slug)
    config, _ = await _config_from_metadata(slug)
    char = load_character(config.character)

    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "cast",
        "message": "Analyzing character cast for consistency...",
    })
    from src.brain.cast_extractor import extract_cast
    # Clear existing cast to force re-extraction
    story.cast = []
    story = await asyncio.to_thread(extract_cast, story, char, config)
    await _save(slug, story, [str(p) for p in image_paths])
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "cast",
        "data": {"cast_count": len(story.cast), "members": [m.model_dump() for m in story.cast]},
    })

    return {"slug": slug, "cast_count": len(story.cast)}


async def run_translate(task_id: str, slug: str, language: str) -> dict:
    """Run translation on an existing story."""
    from server.services.story_service import get_story
    story, image_paths, story_dir = await get_story(slug)
    config, _ = await _config_from_metadata(slug)

    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "translation", "message": f"Translating to {language}..."
    })
    from src.brain.translator import translate_story
    story = await asyncio.to_thread(translate_story, story, language, config)
    await _save(slug, story, [str(p) for p in image_paths])
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "translation",
        "data": {"translated_title": story.title_translated},
    })

    return {"slug": slug, "translated_title": story.title_translated}


async def run_illustrate(task_id: str, slug: str, page_number: int | None = None) -> dict:
    """Run illustration on an existing story. If page_number given, regenerate only that page."""
    from server.services.story_service import get_story
    story, image_paths, story_dir = await get_story(slug)
    config, _ = await _config_from_metadata(slug)
    style_data = load_style(config.style)
    style_anchor = style_data.get("anchor", style_data["description"])
    char = load_character(config.character)

    from src.artist.generator import (
        build_image_prompt, create_image_client, generate_single_image, upscale_for_print,
    )

    images_dir = story_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    client = create_image_client(config)

    keyframes = story.keyframes
    if page_number is not None:
        keyframes = [kf for kf in story.keyframes if kf.page_number == page_number]
        if not keyframes:
            raise ValueError(f"Page {page_number} not found")

    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "illustration",
        "message": "Generating illustrations...",
        "data": {"total": len(keyframes)},
    })

    new_paths = []
    for i, kf in enumerate(keyframes):
        prefix = "cover" if kf.is_cover else f"page_{kf.page_number:02d}"
        final_path = images_dir / f"{prefix}.png"
        raw_path = images_dir / f"{prefix}_raw.png"

        # Delete existing to force regeneration
        if page_number is not None:
            for p in [final_path, raw_path]:
                if p.exists():
                    p.unlink()

        if not final_path.exists():
            prompt = build_image_prompt(kf, char, style_anchor, title=story.title, cast=story.cast or None)
            await asyncio.to_thread(generate_single_image, client, prompt, config.image_model, raw_path)
            await asyncio.to_thread(upscale_for_print, raw_path, final_path)

        new_paths.append(final_path)
        await task_manager.broadcast(task_id, {
            "type": "image_complete", "page": kf.page_number,
            "is_cover": kf.is_cover,
            "url": f"/api/stories/{slug}/images/{final_path.name}",
            "progress": i + 1, "total": len(keyframes),
        })

        if i < len(keyframes) - 1:
            await asyncio.sleep(2.0)

    # Update image_paths in DB
    if page_number is None:
        await _save(slug, story, [str(p) for p in new_paths])

    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "illustration",
    })

    return {"slug": slug, "images_generated": len(new_paths)}


async def run_backdrops(task_id: str, slug: str) -> dict:
    """Generate backdrops for an existing story."""
    from server.services.story_service import get_story_dir
    story_dir = get_story_dir(slug)
    config, _ = await _config_from_metadata(slug)
    style_data = load_style(config.style)
    style_anchor = style_data.get("anchor", style_data["description"])

    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "backdrops", "message": "Generating backdrops..."
    })
    from src.artist.generator import generate_backdrops
    backdrops_dir = story_dir / "backdrops"
    backdrop_paths = await asyncio.to_thread(generate_backdrops, config, style_anchor, backdrops_dir)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "backdrops",
        "data": {"count": len(backdrop_paths)},
    })

    return {"slug": slug, "backdrop_count": len(backdrop_paths)}


async def run_continue_pipeline(task_id: str, slug: str) -> dict:
    """Continue pipeline after cast review: translate → illustrate → backdrops → PDF."""
    from server.services.story_service import get_story
    story, image_paths, story_dir = await get_story(slug)
    config, meta = await _config_from_metadata(slug)
    style_data = load_style(config.style)
    style_anchor = style_data.get("anchor", style_data["description"])
    char = load_character(config.character)
    language = meta["config"].get("language") if meta and meta.get("config") else None

    # Phase 2b: Translation (if language configured and not already done)
    if language and not story.title_translated:
        await task_manager.broadcast(task_id, {
            "type": "phase_start", "phase": "translation",
            "message": f"Translating to {language}...",
        })
        from src.brain.translator import translate_story
        story = await asyncio.to_thread(translate_story, story, language, config)
        await _save(slug, story, [str(p) for p in image_paths])
        await task_manager.broadcast(task_id, {
            "type": "phase_complete", "phase": "translation",
            "data": {"translated_title": story.title_translated},
        })

    # Phase 3: Illustrations
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "illustration",
        "message": "Generating illustrations...",
        "data": {"total": len(story.keyframes)},
    })

    from src.artist.generator import (
        build_image_prompt, create_image_client, generate_single_image, upscale_for_print,
    )
    images_dir = story_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    client = create_image_client(config)
    new_image_paths: list[Path] = []

    for i, kf in enumerate(story.keyframes):
        prefix = "cover" if kf.is_cover else f"page_{kf.page_number:02d}"
        final_path = images_dir / f"{prefix}.png"

        if final_path.exists():
            new_image_paths.append(final_path)
            await task_manager.broadcast(task_id, {
                "type": "image_complete", "page": kf.page_number,
                "is_cover": kf.is_cover, "skipped": True,
                "url": f"/api/stories/{slug}/images/{final_path.name}",
                "progress": i + 1, "total": len(story.keyframes),
            })
            continue

        prompt = build_image_prompt(kf, char, style_anchor, title=story.title, cast=story.cast or None)
        raw_path = images_dir / f"{prefix}_raw.png"

        await asyncio.to_thread(generate_single_image, client, prompt, config.image_model, raw_path)
        await asyncio.to_thread(upscale_for_print, raw_path, final_path)

        new_image_paths.append(final_path)
        await task_manager.broadcast(task_id, {
            "type": "image_complete", "page": kf.page_number,
            "is_cover": kf.is_cover, "skipped": False,
            "url": f"/api/stories/{slug}/images/{final_path.name}",
            "progress": i + 1, "total": len(story.keyframes),
        })

        if i < len(story.keyframes) - 1:
            await asyncio.sleep(2.0)

    await _save(slug, story, [str(p) for p in new_image_paths])
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "illustration",
    })

    # Phase 3b: Backdrops
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "backdrops", "message": "Generating backdrops..."
    })
    from src.artist.generator import generate_backdrops
    backdrops_dir = story_dir / "backdrops"
    backdrop_paths = await asyncio.to_thread(generate_backdrops, config, style_anchor, backdrops_dir)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "backdrops",
        "data": {"count": len(backdrop_paths)},
    })

    # Phase 4: PDF
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "pdf", "message": "Rendering PDF..."
    })
    from src.publisher.layout import render_book_pdf
    pdf_path = story_dir / "book.pdf"
    await asyncio.to_thread(render_book_pdf, story, new_image_paths, pdf_path, backdrop_paths)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "pdf",
    })

    return {"slug": slug, "title": story.title}


async def run_pdf(task_id: str, slug: str) -> dict:
    """Render PDFs for an existing story."""
    from server.services.story_service import get_story
    story, image_paths, story_dir = await get_story(slug)

    # Discover backdrops
    backdrops_dir = story_dir / "backdrops"
    backdrop_paths = sorted(backdrops_dir.glob("backdrop_*.png")) if backdrops_dir.exists() else []
    backdrop_paths = [p for p in backdrop_paths if "_raw" not in p.name]

    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "pdf", "message": "Rendering PDF..."
    })
    from src.publisher.layout import render_book_pdf
    pdf_path = story_dir / "book.pdf"
    await asyncio.to_thread(render_book_pdf, story, image_paths, pdf_path, backdrop_paths or None)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "pdf",
    })

    return {"slug": slug}
