from __future__ import annotations

import asyncio
import logging
import time as _time
from datetime import datetime
from pathlib import Path

from src.models import BookConfig, Story
from src.utils.config import build_config, load_style, async_resolve_character
from src.utils.io import slugify

from server.services.task_manager import task_manager

logger = logging.getLogger(__name__)


async def _save(slug: str, story: Story, image_paths: list[str | Path] | None = None, metadata: dict | None = None):
    """Save story to DB via story_service."""
    from server.services.story_service import save_to_db
    logger.debug("Saving checkpoint: slug=%s images=%s", slug, len(image_paths) if image_paths else 0)
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
    logger.info("run_full_pipeline: task=%s character=%s style=%s pages=%d", task_id, character, style, pages)
    t0 = _time.monotonic()
    config = build_config(character=character, narrator=narrator, style=style, pages=pages)
    char = await async_resolve_character(config.character)
    style_data = load_style(config.style)
    style_desc = style_data["description"]
    style_anchor = style_data.get("anchor", style_desc)

    # Phase 1: Story
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "story", "message": "Generating story..."
    })
    phase_t = _time.monotonic()
    from src.brain.storyteller import generate_story
    title, prose = await asyncio.to_thread(generate_story, notes, char, config, style_desc)
    logger.info("Phase story completed in %.1fs", _time.monotonic() - phase_t)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "story",
        "data": {"title": title, "word_count": len(prose.split())},
    })

    # Phase 2: Keyframes
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "keyframes", "message": "Breaking story into pages..."
    })
    phase_t = _time.monotonic()
    from src.brain.keyframer import generate_keyframes
    story = await asyncio.to_thread(generate_keyframes, title, prose, char, config, style_desc)
    logger.info("Phase keyframes completed in %.1fs", _time.monotonic() - phase_t)
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
    # Always run the dedicated extractor — Gemini's structured output may
    # auto-populate story.cast with low-quality data from the keyframer schema.
    story.cast = []
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

    # Phase 2c: Reference Sheet
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "reference_sheet",
        "message": "Generating character reference sheet...",
    })
    from src.artist.generator import (
        generate_reference_sheet, load_reference_sheet,
        build_image_prompt, create_image_client, generate_single_image, upscale_for_print,
    )
    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    ref_path = await asyncio.to_thread(generate_reference_sheet, char, style_anchor, config, images_dir)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "reference_sheet",
        "data": {"generated": ref_path is not None},
    })

    # Load reference sheet for all subsequent image generation
    ref_bytes = load_reference_sheet(images_dir)

    # Phase 3: Illustrations
    cover_title = story.title_translated or story.title
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "illustration",
        "message": "Generating illustrations...",
        "data": {"total": len(story.keyframes)},
    })

    phase_t = _time.monotonic()
    client = create_image_client(config)
    image_paths: list[Path] = []

    for i, kf in enumerate(story.keyframes):
        prefix = "cover" if kf.is_cover else f"page_{kf.page_number:02d}"
        final_path = images_dir / f"{prefix}.png"

        if final_path.exists():
            image_paths.append(final_path)
            logger.debug("Image %s already exists, skipping", prefix)
            await task_manager.broadcast(task_id, {
                "type": "image_complete", "page": kf.page_number,
                "is_cover": kf.is_cover, "skipped": True,
                "url": f"/api/stories/{slug}/images/{final_path.name}",
                "progress": i + 1, "total": len(story.keyframes),
            })
            continue

        logger.info("Generating image %d/%d: %s", i + 1, len(story.keyframes), prefix)
        prompt = build_image_prompt(kf, char, style_anchor, title=cover_title, cast=story.cast or None)
        raw_path = images_dir / f"{prefix}_raw.png"

        await asyncio.to_thread(generate_single_image, client, prompt, config.image_model, raw_path, reference_image=ref_bytes)
        await asyncio.to_thread(upscale_for_print, raw_path, final_path)

        image_paths.append(final_path)
        await task_manager.broadcast(task_id, {
            "type": "image_complete", "page": kf.page_number,
            "is_cover": kf.is_cover, "skipped": False,
            "url": f"/api/stories/{slug}/images/{final_path.name}",
            "progress": i + 1, "total": len(story.keyframes),
        })

        if i < len(story.keyframes) - 1:
            await asyncio.sleep(5.0)

    logger.info("Phase illustration completed in %.1fs", _time.monotonic() - phase_t)
    await _save(slug, story, [str(p) for p in image_paths])
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "illustration",
    })

    # Phase 3b: Backdrops
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "backdrops", "message": "Generating backdrops..."
    })
    phase_t = _time.monotonic()
    from src.artist.generator import generate_backdrops
    backdrops_dir = output_dir / "backdrops"
    backdrop_paths = await asyncio.to_thread(generate_backdrops, config, style_anchor, backdrops_dir)
    logger.info("Phase backdrops completed in %.1fs", _time.monotonic() - phase_t)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "backdrops",
        "data": {"count": len(backdrop_paths)},
    })

    # Phase 4: PDF
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "pdf", "message": "Rendering PDF..."
    })
    phase_t = _time.monotonic()
    from src.publisher.layout import render_book_pdf
    pdf_path = output_dir / "book.pdf"
    await asyncio.to_thread(render_book_pdf, story, image_paths, pdf_path, backdrop_paths)
    logger.info("Phase pdf completed in %.1fs", _time.monotonic() - phase_t)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "pdf",
    })

    logger.info("Full pipeline completed in %.1fs: slug=%s", _time.monotonic() - t0, slug)
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
    logger.info("run_story_only: task=%s character=%s style=%s", task_id, character, style)
    config = build_config(character=character, narrator=narrator, style=style, pages=pages)
    char = await async_resolve_character(config.character)
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
    # Always run the dedicated extractor (see run_full_pipeline comment)
    story.cast = []
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
    char = await async_resolve_character(config.character)

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
    char = await async_resolve_character(config.character)

    from src.artist.generator import (
        build_image_prompt, create_image_client, generate_single_image, upscale_for_print,
        load_reference_sheet,
    )

    images_dir = story_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    client = create_image_client(config)
    ref_bytes = load_reference_sheet(images_dir)
    cover_title = story.title_translated or story.title

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
            prompt = build_image_prompt(kf, char, style_anchor, title=cover_title, cast=story.cast or None)
            await asyncio.to_thread(generate_single_image, client, prompt, config.image_model, raw_path, reference_image=ref_bytes)
            await asyncio.to_thread(upscale_for_print, raw_path, final_path)

        new_paths.append(final_path)
        await task_manager.broadcast(task_id, {
            "type": "image_complete", "page": kf.page_number,
            "is_cover": kf.is_cover,
            "url": f"/api/stories/{slug}/images/{final_path.name}",
            "progress": i + 1, "total": len(keyframes),
        })

        if i < len(keyframes) - 1:
            await asyncio.sleep(5.0)

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
    """Continue pipeline after cast review: translate → ref sheet → cover variations → STOP.

    The pipeline pauses here for cover selection. After the user picks a cover,
    run_after_cover_selection() finishes with page illustrations → backdrops → PDF.
    """
    logger.info("run_continue_pipeline: task=%s slug=%s", task_id, slug)
    from server.services.story_service import get_story
    story, image_paths, story_dir = await get_story(slug)
    config, meta = await _config_from_metadata(slug)
    style_data = load_style(config.style)
    style_anchor = style_data.get("anchor", style_data["description"])
    char = await async_resolve_character(config.character)
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

    from src.artist.generator import (
        generate_reference_sheet, generate_cover_variations, load_reference_sheet,
    )

    # Phase 2c: Reference Sheet
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "reference_sheet",
        "message": "Generating character reference sheet...",
    })
    images_dir = story_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    ref_path = await asyncio.to_thread(generate_reference_sheet, char, style_anchor, config, images_dir)
    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "reference_sheet",
        "data": {"generated": ref_path is not None},
    })

    # Phase 2d: Cover Variations
    cover_kf = next((kf for kf in story.keyframes if kf.is_cover), None)
    if cover_kf:
        cover_title = story.title_translated or story.title
        ref_bytes = load_reference_sheet(images_dir)

        await task_manager.broadcast(task_id, {
            "type": "phase_start", "phase": "cover_variations",
            "message": "Generating cover options...",
            "data": {"total": 4},
        })

        variation_paths = await asyncio.to_thread(
            generate_cover_variations,
            cover_kf, char, style_anchor, config, images_dir,
            title=cover_title, cast=story.cast or None, count=4,
            reference_image=ref_bytes,
        )

        # Broadcast each variation for the frontend
        cover_variations = []
        for i, vp in enumerate(variation_paths):
            url = f"/api/stories/{slug}/images/{vp.name}"
            cover_variations.append({"index": i + 1, "url": url})
            await task_manager.broadcast(task_id, {
                "type": "cover_variation_complete",
                "index": i + 1,
                "url": url,
            })

        await task_manager.broadcast(task_id, {
            "type": "phase_complete", "phase": "cover_variations",
            "data": {"count": len(variation_paths)},
        })

        return {
            "slug": slug,
            "title": story.title,
            "cover_variations": cover_variations,
        }

    # No cover keyframe — shouldn't happen but fall through
    return {"slug": slug, "title": story.title}


async def run_after_cover_selection(task_id: str, slug: str, choice: int) -> dict:
    """Continue pipeline after cover selection: copy cover → page illustrations → backdrops → PDF."""
    logger.info("run_after_cover_selection: task=%s slug=%s choice=%d", task_id, slug, choice)
    import shutil
    from server.services.story_service import get_story
    story, existing_image_paths, story_dir = await get_story(slug)
    config, _ = await _config_from_metadata(slug)
    style_data = load_style(config.style)
    style_anchor = style_data.get("anchor", style_data["description"])
    char = await async_resolve_character(config.character)

    images_dir = story_dir / "images"

    # Copy chosen cover variation to cover.png
    chosen_path = images_dir / f"cover_v{choice}.png"
    chosen_raw = images_dir / f"cover_v{choice}_raw.png"
    cover_final = images_dir / "cover.png"
    cover_raw = images_dir / "cover_raw.png"

    if chosen_path.exists():
        shutil.copy2(chosen_path, cover_final)
    if chosen_raw.exists():
        shutil.copy2(chosen_raw, cover_raw)

    from src.artist.generator import (
        build_image_prompt, create_image_client, generate_single_image, upscale_for_print,
        load_reference_sheet,
    )

    ref_bytes = load_reference_sheet(images_dir)
    cover_title = story.title_translated or story.title

    # Phase 3: Page Illustrations (cover.png already exists, will be skipped)
    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "illustration",
        "message": "Generating illustrations...",
        "data": {"total": len(story.keyframes)},
    })

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

        prompt = build_image_prompt(kf, char, style_anchor, title=cover_title, cast=story.cast or None)
        raw_path = images_dir / f"{prefix}_raw.png"

        await asyncio.to_thread(generate_single_image, client, prompt, config.image_model, raw_path, reference_image=ref_bytes)
        await asyncio.to_thread(upscale_for_print, raw_path, final_path)

        new_image_paths.append(final_path)
        await task_manager.broadcast(task_id, {
            "type": "image_complete", "page": kf.page_number,
            "is_cover": kf.is_cover, "skipped": False,
            "url": f"/api/stories/{slug}/images/{final_path.name}",
            "progress": i + 1, "total": len(story.keyframes),
        })

        if i < len(story.keyframes) - 1:
            await asyncio.sleep(5.0)

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
