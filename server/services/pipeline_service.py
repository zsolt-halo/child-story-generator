from __future__ import annotations

import asyncio
import logging
import time as _time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from opentelemetry import trace

from src.models import BookConfig, Character, Story
from src.utils.config import build_config, load_style, async_resolve_character
from src.utils.io import slugify

from server.services.task_manager import task_manager

logger = logging.getLogger(__name__)
tracer = trace.get_tracer("starlight.pipeline")

# Background task refs to prevent GC of fire-and-forget coroutines
_background_tasks: set[asyncio.Task] = set()


# ---------------------------------------------------------------------------
# Phase timing persistence
# ---------------------------------------------------------------------------

ROLLING_WINDOW = 20  # Number of recent runs to average for ETA


async def _record_phase_timing(phase: str, duration: float):
    """Persist a phase timing record and prune old rows beyond ROLLING_WINDOW."""
    try:
        from src.db.engine import get_async_session_factory
        from src.db.models import PhaseTimingRow
        from sqlalchemy import delete, select
        async with get_async_session_factory()() as session:
            session.add(PhaseTimingRow(phase=phase, duration_seconds=duration))
            await session.flush()
            # Prune: keep only the newest ROLLING_WINDOW rows per phase
            sub = (
                select(PhaseTimingRow.id)
                .where(PhaseTimingRow.phase == phase)
                .order_by(PhaseTimingRow.created_at.desc())
                .offset(ROLLING_WINDOW)
            ).subquery()
            await session.execute(
                delete(PhaseTimingRow).where(PhaseTimingRow.id.in_(select(sub.c.id)))
            )
            await session.commit()
    except Exception:
        logger.debug("Failed to record phase timing for %s", phase, exc_info=True)


async def get_phase_averages() -> dict[str, float]:
    """Return rolling averages of phase durations (last N runs per phase)."""
    from src.db.engine import get_async_session_factory
    from src.db.models import PhaseTimingRow
    from sqlalchemy import func, select

    async with get_async_session_factory()() as session:
        # Subquery: rank each timing row per phase by recency
        sub = (
            select(
                PhaseTimingRow.phase,
                PhaseTimingRow.duration_seconds,
                func.row_number()
                    .over(partition_by=PhaseTimingRow.phase, order_by=PhaseTimingRow.created_at.desc())
                    .label("rn"),
            )
            .subquery()
        )
        # Outer: average only the last ROLLING_WINDOW rows per phase
        stmt = (
            select(sub.c.phase, func.avg(sub.c.duration_seconds))
            .where(sub.c.rn <= ROLLING_WINDOW)
            .group_by(sub.c.phase)
        )
        rows = (await session.execute(stmt)).all()
    return {phase: round(avg, 1) for phase, avg in rows}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


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


@dataclass
class PipelineContext:
    """Resolved config, character, and style for a pipeline run."""
    config: BookConfig
    char: Character
    style_anchor: str
    style_desc: str
    meta: dict | None = None
    language: str | None = None
    story: Story | None = None
    image_paths: list[Path] = field(default_factory=list)
    story_dir: Path | None = None


async def _load_pipeline_context(slug: str) -> PipelineContext:
    """Load config, character, and style from DB metadata for an existing story."""
    from server.services.story_service import get_story
    story, image_paths, story_dir = await get_story(slug)
    config, meta = await _config_from_metadata(slug)
    style_data = load_style(config.style)
    style_anchor = style_data.get("anchor", style_data["description"])
    char = await async_resolve_character(config.character)
    language = meta["config"].get("language") if meta and meta.get("config") else None
    return PipelineContext(
        config=config, char=char, style_anchor=style_anchor,
        style_desc=style_data["description"], meta=meta, language=language,
        story=story, image_paths=image_paths, story_dir=story_dir,
    )


def _record_phase_metric(phase: str, elapsed: float) -> None:
    """Record phase duration metric. No-op when telemetry is unavailable."""
    try:
        from server.telemetry import pipeline_phase_duration
        if pipeline_phase_duration:
            pipeline_phase_duration.record(elapsed, {"phase": phase})
    except ImportError:
        pass


@asynccontextmanager
async def _phase(task_id: str, phase: str, message: str, **extra_data):
    """Broadcast phase_start/phase_complete and log timing."""
    start_event: dict = {"type": "phase_start", "phase": phase, "message": message}
    if extra_data:
        start_event["data"] = extra_data
    await task_manager.broadcast(task_id, start_event)
    t = _time.monotonic()
    result: dict = {}
    with tracer.start_as_current_span(
        f"pipeline.{phase}",
        attributes={"pipeline.task_id": task_id, "pipeline.phase": phase},
    ) as span:
        yield result  # caller can set result["data"] for the complete event
        elapsed = _time.monotonic() - t
        span.set_attribute("pipeline.elapsed", round(elapsed, 1))
    logger.info("Phase %s completed in %.1fs", phase, elapsed)
    complete_event: dict = {"type": "phase_complete", "phase": phase, "elapsed": round(elapsed, 1)}
    if result:
        complete_event["data"] = result
    await task_manager.broadcast(task_id, complete_event)
    # Record timing for future ETA estimation (fire-and-forget)
    task = asyncio.create_task(_record_phase_timing(phase, elapsed))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    _record_phase_metric(phase, elapsed)


async def _illustrate_keyframes(
    task_id: str,
    slug: str,
    story: Story,
    config: BookConfig,
    char: Character,
    style_anchor: str,
    images_dir: Path,
    ref_bytes: bytes | None = None,
    cast_ref_map: dict[str, bytes] | None = None,
) -> list[Path]:
    """Generate illustrations for all keyframes with SSE progress. Returns image paths."""
    from src.artist.generator import (
        build_image_prompt, create_image_client, generate_single_image, upscale_for_print,
    )

    cover_title = story.title_translated or story.title
    client = create_image_client(config)
    image_paths: list[Path] = []

    for i, kf in enumerate(story.keyframes):
        final_path = images_dir / f"{kf.image_prefix}.png"

        if final_path.exists():
            image_paths.append(final_path)
            logger.debug("Image %s already exists, skipping", kf.image_prefix)
            await task_manager.broadcast(task_id, {
                "type": "image_complete", "page": kf.page_number,
                "is_cover": kf.is_cover, "skipped": True,
                "url": f"/api/stories/{slug}/images/{final_path.name}",
                "progress": i + 1, "total": len(story.keyframes),
            })
            continue

        # Collect per-page cast reference images for members appearing on this page
        additional_refs: list[bytes] = []
        if cast_ref_map and story.cast:
            for m in story.cast:
                if kf.page_number in m.appears_on_pages:
                    member_slug = slugify(m.name)
                    if member_slug in cast_ref_map:
                        additional_refs.append(cast_ref_map[member_slug])

        logger.info("Generating image %d/%d: %s", i + 1, len(story.keyframes), kf.image_prefix)
        prompt = build_image_prompt(kf, char, style_anchor, title=cover_title, cast=story.cast or None)
        raw_path = images_dir / f"{kf.image_prefix}_raw.png"

        await asyncio.to_thread(
            generate_single_image, client, prompt, config.image_model, raw_path,
            reference_image=ref_bytes,
            additional_references=additional_refs if additional_refs else None,
        )
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

    return image_paths


async def run_full_pipeline(
    task_id: str,
    notes: str,
    character: str,
    narrator: str,
    style: str,
    pages: int,
    language: str | None,
    text_model: str | None = None,
) -> dict:
    """Run the full pipeline: story → keyframes → translation → illustrations → backdrops → PDF."""
    logger.info("run_full_pipeline: task=%s character=%s style=%s pages=%d", task_id, character, style, pages)
    t0 = _time.monotonic()
    span = trace.get_current_span()
    span.set_attribute("pipeline.type", "full")
    config = build_config(character=character, narrator=narrator, style=style, pages=pages, text_model=text_model)
    char = await async_resolve_character(config.character)
    style_data = load_style(config.style)
    style_desc = style_data["description"]
    style_anchor = style_data.get("anchor", style_desc)

    # Phase 1: Story
    from src.brain.storyteller import generate_story
    async with _phase(task_id, "story", "Generating story...") as r:
        title, prose = await asyncio.to_thread(generate_story, notes, char, config, style_desc)
        r.update(title=title, word_count=len(prose.split()))

    # Phase 2: Keyframes
    from src.brain.keyframer import generate_keyframes
    async with _phase(task_id, "keyframes", "Breaking story into pages...") as r:
        story = await asyncio.to_thread(generate_keyframes, title, prose, char, config, style_desc)
        r.update(page_count=len(story.keyframes))

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
    from src.brain.cast_extractor import extract_cast
    story.cast = []
    async with _phase(task_id, "cast", "Analyzing character cast for consistency...") as r:
        story = await asyncio.to_thread(extract_cast, story, char, config)
        await _save(slug, story)
        r.update(cast_count=len(story.cast), members=[m.model_dump() for m in story.cast])

    # Phase 2b: Translation
    if language:
        from src.brain.translator import translate_story
        async with _phase(task_id, "translation", f"Translating to {language}...") as r:
            story = await asyncio.to_thread(translate_story, story, language, config)
            await _save(slug, story)
            r.update(translated_title=story.title_translated)

    # Phase 2c: Reference Sheet
    from src.artist.generator import (
        generate_reference_sheet, load_reference_sheet,
        generate_cast_reference_sheet, load_cast_reference_sheets,
    )
    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    async with _phase(task_id, "reference_sheet", "Generating character reference sheet...") as r:
        ref_path = await asyncio.to_thread(generate_reference_sheet, char, style_anchor, config, images_dir)
        r.update(generated=ref_path is not None, url=f"/api/stories/{slug}/images/reference_sheet.png" if ref_path else None)

    # Phase 2d: Cast reference sheets
    if story.cast:
        cast_count = len(story.cast)
        async with _phase(task_id, "cast_reference_sheets", f"Generating {cast_count} cast reference sheets...", total=cast_count) as r:
            for i, member in enumerate(story.cast):
                await asyncio.to_thread(
                    generate_cast_reference_sheet, member, style_anchor, config, images_dir,
                )
                name_slug = slugify(member.name)
                await task_manager.broadcast(task_id, {
                    "type": "cast_ref_complete",
                    "name": member.name,
                    "url": f"/api/stories/{slug}/images/ref_{name_slug}.png",
                    "progress": i + 1,
                    "total": cast_count,
                })
                if i < cast_count - 1:
                    await asyncio.sleep(5.0)
            r.update(count=cast_count)

    ref_bytes = load_reference_sheet(images_dir)
    cast_ref_map = load_cast_reference_sheets(images_dir, story.cast) if story.cast else None

    # Phase 3: Illustrations
    async with _phase(task_id, "illustration", "Generating illustrations...", total=len(story.keyframes)):
        image_paths = await _illustrate_keyframes(
            task_id, slug, story, config, char, style_anchor, images_dir, ref_bytes, cast_ref_map,
        )
    await _save(slug, story, [str(p) for p in image_paths])

    # Phase 3b: Backdrops
    from src.artist.generator import generate_backdrops
    backdrops_dir = output_dir / "backdrops"
    async with _phase(task_id, "backdrops", "Generating backdrops...") as r:
        backdrop_paths = await asyncio.to_thread(generate_backdrops, config, style_anchor, backdrops_dir)
        r.update(count=len(backdrop_paths))

    # Phase 4: PDF
    from src.publisher.layout import render_book_pdf
    async with _phase(task_id, "pdf", "Rendering PDF..."):
        pdf_path = output_dir / "book.pdf"
        await asyncio.to_thread(render_book_pdf, story, image_paths, pdf_path, backdrop_paths)

    logger.info("Full pipeline completed in %.1fs: slug=%s", _time.monotonic() - t0, slug)
    return {"slug": slug, "title": story.title}


async def run_auto_pipeline(
    task_id: str,
    character: str,
    narrator: str,
    style: str,
    pages: int,
    language: str | None,
    text_model: str | None = None,
) -> dict:
    """Surprise Me: generate a premise then run the full pipeline end-to-end."""
    logger.info("run_auto_pipeline: task=%s character=%s style=%s pages=%d", task_id, character, style, pages)
    t0 = _time.monotonic()
    span = trace.get_current_span()
    span.set_attribute("pipeline.type", "auto")
    config = build_config(character=character, narrator=narrator, style=style, pages=pages, text_model=text_model)
    char = await async_resolve_character(config.character)
    style_data = load_style(config.style)
    style_desc = style_data["description"]
    style_anchor = style_data.get("anchor", style_desc)

    # Phase 0: Premise — generate synthetic parent notes
    from src.brain.storyteller import generate_premise
    async with _phase(task_id, "premise", "Imagining a story idea...") as r:
        notes = await asyncio.to_thread(generate_premise, char, config)
        r.update(notes=notes)

    # Phase 1: Story
    from src.brain.storyteller import generate_story
    async with _phase(task_id, "story", "Generating story...") as r:
        title, prose = await asyncio.to_thread(generate_story, notes, char, config, style_desc)
        r.update(title=title, word_count=len(prose.split()))

    # Phase 2: Keyframes
    from src.brain.keyframer import generate_keyframes
    async with _phase(task_id, "keyframes", "Breaking story into pages...") as r:
        story = await asyncio.to_thread(generate_keyframes, title, prose, char, config, style_desc)
        r.update(page_count=len(story.keyframes))

    # Save checkpoint with metadata
    output_dir = Path("stories") / slugify(story.title)
    metadata = {
        "notes": f"[auto] {notes}",
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
    from src.brain.cast_extractor import extract_cast
    story.cast = []
    async with _phase(task_id, "cast", "Analyzing character cast for consistency...") as r:
        story = await asyncio.to_thread(extract_cast, story, char, config)
        await _save(slug, story)
        r.update(cast_count=len(story.cast), members=[m.model_dump() for m in story.cast])

    # Phase 2b: Translation
    if language:
        from src.brain.translator import translate_story
        async with _phase(task_id, "translation", f"Translating to {language}...") as r:
            story = await asyncio.to_thread(translate_story, story, language, config)
            await _save(slug, story)
            r.update(translated_title=story.title_translated)

    # Phase 2c: Reference Sheet
    from src.artist.generator import (
        generate_reference_sheet, load_reference_sheet,
        generate_cast_reference_sheet, load_cast_reference_sheets,
    )
    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    async with _phase(task_id, "reference_sheet", "Generating character reference sheet...") as r:
        ref_path = await asyncio.to_thread(generate_reference_sheet, char, style_anchor, config, images_dir)
        r.update(generated=ref_path is not None, url=f"/api/stories/{slug}/images/reference_sheet.png" if ref_path else None)

    # Phase 2d: Cast reference sheets
    if story.cast:
        cast_count = len(story.cast)
        async with _phase(task_id, "cast_reference_sheets", f"Generating {cast_count} cast reference sheets...", total=cast_count) as r:
            for i, member in enumerate(story.cast):
                await asyncio.to_thread(
                    generate_cast_reference_sheet, member, style_anchor, config, images_dir,
                )
                name_slug = slugify(member.name)
                await task_manager.broadcast(task_id, {
                    "type": "cast_ref_complete",
                    "name": member.name,
                    "url": f"/api/stories/{slug}/images/ref_{name_slug}.png",
                    "progress": i + 1,
                    "total": cast_count,
                })
                if i < cast_count - 1:
                    await asyncio.sleep(5.0)
            r.update(count=cast_count)

    ref_bytes = load_reference_sheet(images_dir)
    cast_ref_map = load_cast_reference_sheets(images_dir, story.cast) if story.cast else None

    # Phase 3: Illustrations
    async with _phase(task_id, "illustration", "Generating illustrations...", total=len(story.keyframes)):
        image_paths = await _illustrate_keyframes(
            task_id, slug, story, config, char, style_anchor, images_dir, ref_bytes, cast_ref_map,
        )
    await _save(slug, story, [str(p) for p in image_paths])

    # Phase 3b: Backdrops
    from src.artist.generator import generate_backdrops
    backdrops_dir = output_dir / "backdrops"
    async with _phase(task_id, "backdrops", "Generating backdrops...") as r:
        backdrop_paths = await asyncio.to_thread(generate_backdrops, config, style_anchor, backdrops_dir)
        r.update(count=len(backdrop_paths))

    # Phase 4: PDF
    from src.publisher.layout import render_book_pdf
    async with _phase(task_id, "pdf", "Rendering PDF..."):
        pdf_path = output_dir / "book.pdf"
        await asyncio.to_thread(render_book_pdf, story, image_paths, pdf_path, backdrop_paths)

    logger.info("Auto pipeline completed in %.1fs: slug=%s", _time.monotonic() - t0, slug)
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
    text_model: str | None = None,
) -> dict:
    """Run Phase 1+2 only (story + keyframes)."""
    logger.info("run_story_only: task=%s character=%s style=%s", task_id, character, style)
    span = trace.get_current_span()
    span.set_attribute("pipeline.type", "story_only")
    config = build_config(character=character, narrator=narrator, style=style, pages=pages, text_model=text_model)
    char = await async_resolve_character(config.character)
    style_data = load_style(config.style)
    style_desc = style_data["description"]

    from src.brain.storyteller import generate_story
    async with _phase(task_id, "story", "Generating story...") as r:
        title, prose = await asyncio.to_thread(generate_story, notes, char, config, style_desc)
        r.update(title=title, word_count=len(prose.split()))

    from src.brain.keyframer import generate_keyframes
    async with _phase(task_id, "keyframes", "Breaking story into pages...") as r:
        story = await asyncio.to_thread(generate_keyframes, title, prose, char, config, style_desc)
        r.update(page_count=len(story.keyframes))

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

    return {"slug": slug, "title": story.title, "has_keyframes": True}


async def run_cast_extraction(task_id: str, slug: str) -> dict:
    """Run cast extraction on an existing story, then generate reference sheets."""
    ctx = await _load_pipeline_context(slug)
    from src.brain.cast_extractor import extract_cast

    ctx.story.cast = []
    async with _phase(task_id, "cast", "Analyzing character cast for consistency...") as r:
        ctx.story = await asyncio.to_thread(extract_cast, ctx.story, ctx.char, ctx.config)
        await _save(slug, ctx.story, [str(p) for p in ctx.image_paths])
        r.update(cast_count=len(ctx.story.cast), members=[m.model_dump() for m in ctx.story.cast])

    # Phase 2c: Main character reference sheet
    from src.artist.generator import (
        generate_reference_sheet, generate_cast_reference_sheet,
    )
    images_dir = ctx.story_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    ref_url = None
    async with _phase(task_id, "reference_sheet", "Generating main character reference sheet...") as r:
        ref_path = await asyncio.to_thread(
            generate_reference_sheet, ctx.char, ctx.style_anchor, ctx.config, images_dir,
        )
        ref_url = f"/api/stories/{slug}/images/reference_sheet.png" if ref_path else None
        r.update(generated=ref_path is not None, url=ref_url)

    # Phase 2d: Per-cast-member reference sheets
    cast_ref_urls: list[dict] = []
    if ctx.story.cast:
        cast_count = len(ctx.story.cast)
        async with _phase(task_id, "cast_reference_sheets", f"Generating {cast_count} cast reference sheets...", total=cast_count) as r:
            for i, member in enumerate(ctx.story.cast):
                member_ref_path = await asyncio.to_thread(
                    generate_cast_reference_sheet, member, ctx.style_anchor, ctx.config, images_dir,
                )
                name_slug = slugify(member.name)
                url = f"/api/stories/{slug}/images/ref_{name_slug}.png" if member_ref_path else None
                cast_ref_urls.append({"name": member.name, "url": url})
                await task_manager.broadcast(task_id, {
                    "type": "cast_ref_complete",
                    "name": member.name,
                    "url": url,
                    "progress": i + 1,
                    "total": cast_count,
                })
                if i < cast_count - 1:
                    await asyncio.sleep(5.0)
            r.update(count=len(cast_ref_urls))

    return {
        "slug": slug,
        "cast_count": len(ctx.story.cast),
        "cast_ref_urls": cast_ref_urls,
        "reference_sheet_url": ref_url,
    }


async def run_translate(task_id: str, slug: str, language: str) -> dict:
    """Run translation on an existing story."""
    ctx = await _load_pipeline_context(slug)
    from src.brain.translator import translate_story

    async with _phase(task_id, "translation", f"Translating to {language}...") as r:
        ctx.story = await asyncio.to_thread(translate_story, ctx.story, language, ctx.config)
        await _save(slug, ctx.story, [str(p) for p in ctx.image_paths])
        r.update(translated_title=ctx.story.title_translated)

    return {"slug": slug, "translated_title": ctx.story.title_translated}


async def run_illustrate(task_id: str, slug: str, page_number: int | None = None) -> dict:
    """Run illustration on an existing story. If page_number given, regenerate only that page."""
    ctx = await _load_pipeline_context(slug)
    from src.artist.generator import (
        build_image_prompt, create_image_client, generate_single_image, upscale_for_print,
        load_reference_sheet, load_cast_reference_sheets,
    )

    images_dir = ctx.story_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    client = create_image_client(ctx.config)
    ref_bytes = load_reference_sheet(images_dir)
    cast_ref_map = load_cast_reference_sheets(images_dir, ctx.story.cast) if ctx.story.cast else None
    cover_title = ctx.story.title_translated or ctx.story.title

    keyframes = ctx.story.keyframes
    if page_number is not None:
        keyframes = [kf for kf in ctx.story.keyframes if kf.page_number == page_number]
        if not keyframes:
            raise ValueError(f"Page {page_number} not found")

    async with _phase(task_id, "illustration", "Generating illustrations...", total=len(keyframes)):
        new_paths = []
        for i, kf in enumerate(keyframes):
            final_path = images_dir / f"{kf.image_prefix}.png"
            raw_path = images_dir / f"{kf.image_prefix}_raw.png"

            # Delete existing to force regeneration
            if page_number is not None:
                for p in [final_path, raw_path]:
                    if p.exists():
                        p.unlink()

            # Collect per-page cast reference images
            additional_refs: list[bytes] = []
            if cast_ref_map and ctx.story.cast:
                for m in ctx.story.cast:
                    if kf.page_number in m.appears_on_pages:
                        member_slug = slugify(m.name)
                        if member_slug in cast_ref_map:
                            additional_refs.append(cast_ref_map[member_slug])

            if not final_path.exists():
                prompt = build_image_prompt(kf, ctx.char, ctx.style_anchor, title=cover_title, cast=ctx.story.cast or None)
                await asyncio.to_thread(
                    generate_single_image, client, prompt, ctx.config.image_model, raw_path,
                    reference_image=ref_bytes,
                    additional_references=additional_refs if additional_refs else None,
                )
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

    if page_number is None:
        await _save(slug, ctx.story, [str(p) for p in new_paths])

    return {"slug": slug, "images_generated": len(new_paths)}


async def run_regenerate_cast_ref_sheet(task_id: str, slug: str, member_name: str) -> dict:
    """Regenerate a single cast member's reference sheet."""
    ctx = await _load_pipeline_context(slug)
    member = next((m for m in ctx.story.cast if m.name == member_name), None)
    if not member:
        raise ValueError(f"Cast member '{member_name}' not found")

    from src.artist.generator import generate_cast_reference_sheet
    images_dir = ctx.story_dir / "images"
    name_slug = slugify(member_name)

    # Delete existing files to force regeneration
    for suffix in [f"ref_{name_slug}.png", f"ref_{name_slug}_raw.png"]:
        p = images_dir / suffix
        if p.exists():
            p.unlink()

    async with _phase(task_id, "cast_reference_sheets", f"Regenerating reference sheet for {member_name}...") as r:
        ref_path = await asyncio.to_thread(
            generate_cast_reference_sheet, member, ctx.style_anchor, ctx.config, images_dir,
        )
        url = f"/api/stories/{slug}/images/ref_{name_slug}.png" if ref_path else None
        await task_manager.broadcast(task_id, {
            "type": "cast_ref_complete",
            "name": member_name,
            "url": url,
        })
        r.update(name=member_name, url=url, generated=ref_path is not None)

    return {"slug": slug, "name": member_name, "url": url}


async def run_backdrops(task_id: str, slug: str) -> dict:
    """Generate backdrops for an existing story."""
    ctx = await _load_pipeline_context(slug)
    from src.artist.generator import generate_backdrops

    async with _phase(task_id, "backdrops", "Generating backdrops...") as r:
        backdrops_dir = ctx.story_dir / "backdrops"
        backdrop_paths = await asyncio.to_thread(generate_backdrops, ctx.config, ctx.style_anchor, backdrops_dir)
        r.update(count=len(backdrop_paths))

    return {"slug": slug, "backdrop_count": len(backdrop_paths)}


async def run_continue_pipeline(task_id: str, slug: str, cast_edited: bool = False) -> dict:
    """Continue pipeline after cast review: translate → ref sheet → cover variations → STOP.

    The pipeline pauses here for cover selection. After the user picks a cover,
    run_after_cover_selection() finishes with page illustrations → backdrops → PDF.
    """
    logger.info("run_continue_pipeline: task=%s slug=%s cast_edited=%s", task_id, slug, cast_edited)
    span = trace.get_current_span()
    span.set_attribute("pipeline.type", "continue")
    span.set_attribute("pipeline.slug", slug)
    ctx = await _load_pipeline_context(slug)

    images_dir = ctx.story_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    # Phase 2.5b: Re-run cast rewrite only if the user actually edited the cast
    # during review. This avoids an unnecessary Gemini API call when approving unchanged.
    if cast_edited and ctx.story.cast:
        from src.brain.cast_extractor import rewrite_cast_visuals
        async with _phase(task_id, "cast_rewrite", "Applying cast edits to illustrations...") as r:
            ctx.story = await asyncio.to_thread(rewrite_cast_visuals, ctx.story, ctx.char, ctx.config)
            await _save(slug, ctx.story, [str(p) for p in ctx.image_paths])
            r.update(cast_count=len(ctx.story.cast))

    # Phase 2b-regen: Regenerate all cast reference sheets when cast was edited
    if cast_edited and ctx.story.cast:
        from src.artist.generator import generate_cast_reference_sheet
        cast_count = len(ctx.story.cast)
        async with _phase(task_id, "cast_reference_sheets", f"Regenerating {cast_count} cast reference sheets...", total=cast_count) as r:
            regen_count = 0
            for i, member in enumerate(ctx.story.cast):
                name_slug = slugify(member.name)
                # Delete existing to force regeneration
                for suffix in [f"ref_{name_slug}.png", f"ref_{name_slug}_raw.png"]:
                    p = images_dir / suffix
                    if p.exists():
                        p.unlink()
                member_ref_path = await asyncio.to_thread(
                    generate_cast_reference_sheet, member, ctx.style_anchor, ctx.config, images_dir,
                )
                if member_ref_path:
                    regen_count += 1
                    url = f"/api/stories/{slug}/images/ref_{name_slug}.png"
                    await task_manager.broadcast(task_id, {
                        "type": "cast_ref_complete",
                        "name": member.name,
                        "url": url,
                        "progress": i + 1,
                        "total": cast_count,
                    })
                if i < cast_count - 1:
                    await asyncio.sleep(5.0)
            r.update(regenerated=regen_count)

    # Phase 2b: Translation (if language configured and not already done)
    if ctx.language and not ctx.story.title_translated:
        from src.brain.translator import translate_story
        async with _phase(task_id, "translation", f"Translating to {ctx.language}...") as r:
            ctx.story = await asyncio.to_thread(translate_story, ctx.story, ctx.language, ctx.config)
            await _save(slug, ctx.story, [str(p) for p in ctx.image_paths])
            r.update(translated_title=ctx.story.title_translated)

    from src.artist.generator import (
        generate_cover_variations, load_reference_sheet,
    )

    # Phase 2d: Cover Variations (ref sheet already generated during cast extraction)
    cover_kf = next((kf for kf in ctx.story.keyframes if kf.is_cover), None)
    if cover_kf:
        cover_title = ctx.story.title_translated or ctx.story.title
        ref_bytes = load_reference_sheet(images_dir)

        async with _phase(task_id, "cover_variations", "Generating cover options...", total=4) as r:
            variation_paths = await asyncio.to_thread(
                generate_cover_variations,
                cover_kf, ctx.char, ctx.style_anchor, ctx.config, images_dir,
                title=cover_title, cast=ctx.story.cast or None, count=4,
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
            r.update(count=len(variation_paths))

        return {
            "slug": slug,
            "title": ctx.story.title,
            "cover_variations": cover_variations,
        }

    # No cover keyframe — shouldn't happen but fall through
    return {"slug": slug, "title": ctx.story.title}


async def run_after_cover_selection(task_id: str, slug: str, choice: int) -> dict:
    """Continue pipeline after cover selection: copy cover → page illustrations → backdrops → PDF."""
    logger.info("run_after_cover_selection: task=%s slug=%s choice=%d", task_id, slug, choice)
    span = trace.get_current_span()
    span.set_attribute("pipeline.type", "after_cover_selection")
    span.set_attribute("pipeline.slug", slug)
    span.set_attribute("pipeline.cover_choice", choice)
    import shutil
    ctx = await _load_pipeline_context(slug)

    images_dir = ctx.story_dir / "images"

    # Copy chosen cover variation to cover.png
    chosen_path = images_dir / f"cover_v{choice}.png"
    chosen_raw = images_dir / f"cover_v{choice}_raw.png"
    cover_final = images_dir / "cover.png"
    cover_raw = images_dir / "cover_raw.png"

    if chosen_path.exists():
        shutil.copy2(chosen_path, cover_final)
    if chosen_raw.exists():
        shutil.copy2(chosen_raw, cover_raw)

    from src.artist.generator import load_reference_sheet, load_cast_reference_sheets
    ref_bytes = load_reference_sheet(images_dir)
    cast_ref_map = load_cast_reference_sheets(images_dir, ctx.story.cast) if ctx.story.cast else None

    # Phase 3: Page Illustrations (cover.png already exists, will be skipped)
    async with _phase(task_id, "illustration", "Generating illustrations...", total=len(ctx.story.keyframes)):
        new_image_paths = await _illustrate_keyframes(
            task_id, slug, ctx.story, ctx.config, ctx.char, ctx.style_anchor, images_dir, ref_bytes, cast_ref_map,
        )
    await _save(slug, ctx.story, [str(p) for p in new_image_paths])

    # Phase 3b: Backdrops
    from src.artist.generator import generate_backdrops
    async with _phase(task_id, "backdrops", "Generating backdrops...") as r:
        backdrops_dir = ctx.story_dir / "backdrops"
        backdrop_paths = await asyncio.to_thread(generate_backdrops, ctx.config, ctx.style_anchor, backdrops_dir)
        r.update(count=len(backdrop_paths))

    # Phase 4: PDF
    from src.publisher.layout import render_book_pdf
    async with _phase(task_id, "pdf", "Rendering PDF..."):
        pdf_path = ctx.story_dir / "book.pdf"
        await asyncio.to_thread(render_book_pdf, ctx.story, new_image_paths, pdf_path, backdrop_paths)

    return {"slug": slug, "title": ctx.story.title}


async def run_pdf(task_id: str, slug: str) -> dict:
    """Render PDFs for an existing story."""
    ctx = await _load_pipeline_context(slug)
    from src.utils.io import discover_backdrops
    backdrop_paths = discover_backdrops(ctx.story_dir)

    from src.publisher.layout import render_book_pdf
    async with _phase(task_id, "pdf", "Rendering PDF..."):
        pdf_path = ctx.story_dir / "book.pdf"
        await asyncio.to_thread(render_book_pdf, ctx.story, ctx.image_paths, pdf_path, backdrop_paths or None)

    return {"slug": slug}
