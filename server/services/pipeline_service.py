from __future__ import annotations

import asyncio
import logging
import os
import time as _time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from opentelemetry import trace

from src.models import BookConfig, Character, Story
from src.utils.config import build_config, load_style, async_resolve_character
from src.utils.io import slugify, get_static_backdrops

from server.services.task_manager import task_manager
from src import storage

from src.brain.storyteller import generate_story, generate_premise
from src.brain.keyframer import generate_keyframes
from src.brain.cast_extractor import extract_cast, rewrite_cast_visuals
from src.brain.translator import translate_story
from src.artist.generator import (
    generate_reference_sheet, load_reference_sheet,
    generate_cast_reference_sheet, load_cast_reference_sheets,
    generate_cover_variations,
    build_image_prompt, create_image_client, generate_single_image, upscale_for_print,
)
from src.publisher.layout import render_book_pdf

logger = logging.getLogger(__name__)
tracer = trace.get_tracer("starlight.pipeline")


async def _load_character_photo(character_id: str) -> bytes | None:
    """Load photo bytes for a custom character, if available."""
    if not character_id.startswith("custom:"):
        logger.debug("Not a custom character (%s), skipping photo load", character_id)
        return None
    char_uuid = character_id.removeprefix("custom:")
    from src.db.character_repository import CharacterRepository
    row = await CharacterRepository().async_get_by_id(uuid.UUID(char_uuid))
    if not row.photo_path:
        logger.info("Character %s has no photo_path in DB", character_id)
        return None
    photo_file = Path(row.photo_path)
    if not photo_file.exists():
        # Try to fetch from object storage
        char_uuid = character_id.removeprefix("custom:")
        found = await storage.ensure_local(f".characters/{char_uuid}/photo.png", photo_file)
        if not found:
            logger.warning("Character %s photo_path=%s but file does not exist!", character_id, row.photo_path)
            return None
    data = await asyncio.to_thread(photo_file.read_bytes)
    logger.info("Loaded photo for %s: %d bytes from %s", character_id, len(data), row.photo_path)
    return data

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
    family_members: list[tuple[Character, str]] = field(default_factory=list)
    allow_extra_cast: bool = True


async def _save_family_selection(slug: str, family_member_ids: list[str], allow_extra_cast: bool) -> None:
    """Persist selected family IDs and allow_extra_cast flag on the story row."""
    from src.db.engine import get_async_session_factory
    from src.db.models import StoryRow
    from sqlalchemy import select
    async with get_async_session_factory()() as session:
        result = await session.execute(select(StoryRow).where(StoryRow.slug == slug))
        row = result.scalar_one_or_none()
        if row:
            row.selected_family_ids = [uuid.UUID(fid) for fid in family_member_ids]
            row.allow_extra_cast = allow_extra_cast
            await session.commit()


async def _resolve_family_members(family_member_ids: list[str] | None) -> list[tuple[Character, str]]:
    """Resolve family member IDs to (Character, relationship_label) tuples."""
    if not family_member_ids:
        return []
    from src.db.family_repository import FamilyRepository
    return await FamilyRepository().async_resolve_members(
        [uuid.UUID(fid) for fid in family_member_ids]
    )


async def _load_pipeline_context(slug: str) -> PipelineContext:
    """Load config, character, and style from DB metadata for an existing story."""
    from server.services.story_service import get_story
    story, image_paths, story_dir = await get_story(slug)
    config, meta = await _config_from_metadata(slug)
    style_data = load_style(config.style)
    style_anchor = style_data.get("anchor", style_data["description"])
    char = await async_resolve_character(config.character)
    language = meta["config"].get("language") if meta and meta.get("config") else None

    # Resolve family members from story DB row
    family_members: list[tuple[Character, str]] = []
    allow_extra_cast = True
    from src.db.engine import get_async_session_factory
    from src.db.models import StoryRow
    from sqlalchemy import select
    async with get_async_session_factory()() as session:
        result = await session.execute(select(StoryRow).where(StoryRow.slug == slug))
        row = result.scalar_one_or_none()
        if row and row.selected_family_ids:
            family_members = await _resolve_family_members(
                [str(fid) for fid in row.selected_family_ids]
            )
        if row:
            allow_extra_cast = row.allow_extra_cast

    return PipelineContext(
        config=config, char=char, style_anchor=style_anchor,
        style_desc=style_data["description"], meta=meta, language=language,
        story=story, image_paths=image_paths, story_dir=story_dir,
        family_members=family_members, allow_extra_cast=allow_extra_cast,
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


# ---------------------------------------------------------------------------
# Phase execution helpers (shared across pipeline entry points)
# ---------------------------------------------------------------------------


async def _generate_main_ref_sheet(
    task_id: str, slug: str, char: Character, style_anchor: str,
    config: BookConfig, images_dir: Path, photo_bytes: bytes | None,
) -> str | None:
    """Generate main character reference sheet. Returns the ref sheet URL or None."""
    async with _phase(task_id, "reference_sheet", "Generating character reference sheet...") as r:
        ref_path = await asyncio.to_thread(
            generate_reference_sheet, char, style_anchor, config, images_dir, photo_bytes,
        )
        ref_url = f"/api/stories/{slug}/images/reference_sheet.png" if ref_path else None
        r.update(generated=ref_path is not None, url=ref_url)
    return ref_url


async def _generate_cast_ref_sheets(
    task_id: str, slug: str, story: Story, style_anchor: str,
    config: BookConfig, images_dir: Path, *, delete_existing: bool = False,
) -> list[dict]:
    """Generate reference sheets for all cast members.

    Returns a list of ``{"name": ..., "url": ...}`` dicts.
    When *delete_existing* is True, existing ref images are removed first (regen flow).
    """
    if not story.cast:
        return []
    cast_count = len(story.cast)
    verb = "Regenerating" if delete_existing else "Generating"
    cast_ref_urls: list[dict] = []
    async with _phase(task_id, "cast_reference_sheets", f"{verb} {cast_count} cast reference sheets...", total=cast_count) as r:
        for i, member in enumerate(story.cast):
            name_slug = slugify(member.name)
            if delete_existing:
                for suffix in [f"ref_{name_slug}.png", f"ref_{name_slug}_raw.png"]:
                    p = images_dir / suffix
                    if p.exists():
                        p.unlink()
            member_ref_path = await asyncio.to_thread(
                generate_cast_reference_sheet, member, style_anchor, config, images_dir,
            )
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
        r.update(count=cast_count)
    return cast_ref_urls


async def _generate_cover_variations_phase(
    task_id: str, slug: str, story: Story, char: Character,
    style_anchor: str, config: BookConfig, images_dir: Path,
    ref_bytes: bytes | None,
) -> list[dict]:
    """Generate cover variations. Returns list of ``{"index": ..., "url": ...}`` dicts."""
    cover_kf = next((kf for kf in story.keyframes if kf.is_cover), None)
    if not cover_kf:
        return []
    cover_title = story.title_translated or story.title
    cover_variations: list[dict] = []
    async with _phase(task_id, "cover_variations", "Generating cover options...", total=4) as r:
        variation_paths = await asyncio.to_thread(
            generate_cover_variations,
            cover_kf, char, style_anchor, config, images_dir,
            title=cover_title, cast=story.cast or None, count=4,
            reference_image=ref_bytes,
        )
        for i, vp in enumerate(variation_paths):
            url = f"/api/stories/{slug}/images/{vp.name}"
            cover_variations.append({"index": i + 1, "url": url})
            await task_manager.broadcast(task_id, {
                "type": "cover_variation_complete",
                "index": i + 1,
                "url": url,
            })
        r.update(count=len(variation_paths))
    return cover_variations


async def _run_translation_phase(
    task_id: str, slug: str, story: Story, language: str, config: BookConfig,
    image_paths: list[str | Path] | None = None,
) -> Story:
    """Translate the story. Returns the updated Story with translated fields."""
    async with _phase(task_id, "translation", f"Translating to {language}...") as r:
        story = await asyncio.to_thread(translate_story, story, language, config)
        await _save(slug, story, image_paths)
        r.update(translated_title=story.title_translated)
    return story


async def _run_cast_rewrite_and_regen(
    task_id: str, slug: str, ctx: PipelineContext, images_dir: Path,
) -> None:
    """Re-run cast visual rewrite + regenerate all cast reference sheets."""
    if not ctx.story.cast:
        return
    async with _phase(task_id, "cast_rewrite", "Applying cast edits to illustrations...") as r:
        ctx.story = await asyncio.to_thread(rewrite_cast_visuals, ctx.story, ctx.char, ctx.config)
        await _save(slug, ctx.story, [str(p) for p in ctx.image_paths])
        r.update(cast_count=len(ctx.story.cast))
    await _generate_cast_ref_sheets(
        task_id, slug, ctx.story, ctx.style_anchor, ctx.config, images_dir,
        delete_existing=True,
    )


async def _run_illustrations_and_pdf(
    task_id: str, slug: str, story: Story, config: BookConfig,
    char: Character, style_anchor: str, story_dir: Path,
) -> list[Path]:
    """Generate page illustrations and render the PDF. Returns image paths."""
    images_dir = story_dir / "images"
    ref_bytes = load_reference_sheet(images_dir)
    cast_ref_map = load_cast_reference_sheets(images_dir, story.cast) if story.cast else None

    async with _phase(task_id, "illustration", "Generating illustrations...", total=len(story.keyframes)):
        image_paths = await _illustrate_keyframes(
            task_id, slug, story, config, char, style_anchor, images_dir, ref_bytes, cast_ref_map,
        )
    await _save(slug, story, [str(p) for p in image_paths])

    backdrop_paths = get_static_backdrops(slug)
    async with _phase(task_id, "pdf", "Rendering PDF..."):
        pdf_path = story_dir / "book.pdf"
        await asyncio.to_thread(render_book_pdf, story, image_paths, pdf_path, backdrop_paths or None)

    return image_paths


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

        try:
            await asyncio.to_thread(
                generate_single_image, client, prompt, config.image_model, raw_path,
                reference_image=ref_bytes,
                additional_references=additional_refs if additional_refs else None,
            )
            await asyncio.to_thread(upscale_for_print, raw_path, final_path)
        except Exception:
            logger.error("Failed to generate image for %s after all retries — skipping", kf.image_prefix, exc_info=True)
            await task_manager.broadcast(task_id, {
                "type": "image_failed", "page": kf.page_number,
                "is_cover": kf.is_cover,
                "progress": i + 1, "total": len(story.keyframes),
            })
            continue

        image_paths.append(final_path)
        await task_manager.broadcast(task_id, {
            "type": "image_complete", "page": kf.page_number,
            "is_cover": kf.is_cover, "skipped": False,
            "url": f"/api/stories/{slug}/images/{final_path.name}",
            "progress": i + 1, "total": len(story.keyframes),
        })

        # Incremental sync: upload each image to MinIO so pages survive container restarts
        try:
            await storage.upload_file(f"{slug}/images/{final_path.name}", final_path)
            if raw_path.exists():
                await storage.upload_file(f"{slug}/images/{raw_path.name}", raw_path)
        except Exception:
            logger.debug("Incremental sync failed for %s — will sync at end", final_path.name)

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
    family_member_ids: list[str] | None = None,
    allow_extra_cast: bool = True,
) -> dict:
    """Run the full pipeline: story → keyframes → translation → illustrations → PDF."""
    logger.info("run_full_pipeline: task=%s character=%s style=%s pages=%d", task_id, character, style, pages)
    t0 = _time.monotonic()
    span = trace.get_current_span()
    span.set_attribute("pipeline.type", "full")
    config = build_config(character=character, narrator=narrator, style=style, pages=pages, text_model=text_model)
    char = await async_resolve_character(config.character)
    style_data = load_style(config.style)
    style_desc = style_data["description"]
    style_anchor = style_data.get("anchor", style_desc)
    family_members = await _resolve_family_members(family_member_ids)

    # Phase 1: Story
    async with _phase(task_id, "story", "Generating story...") as r:
        title, prose = await asyncio.to_thread(generate_story, notes, char, config, style_desc, family_members=family_members or None)
        r.update(title=title, word_count=len(prose.split()))

    # Phase 2: Keyframes
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

    if family_member_ids:
        await _save_family_selection(slug, family_member_ids, allow_extra_cast)

    # Phase 2.5: Cast Extraction
    story.cast = []
    async with _phase(task_id, "cast", "Analyzing character cast for consistency...") as r:
        story = await asyncio.to_thread(
            extract_cast, story, char, config,
            family_members=family_members or None,
            allow_extra_cast=allow_extra_cast,
        )
        await _save(slug, story)
        r.update(cast_count=len(story.cast), members=[m.model_dump() for m in story.cast])

    # Phase 2b: Translation
    if language:
        story = await _run_translation_phase(task_id, slug, story, language, config)

    # Phase 2c: Reference Sheet
    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    photo_bytes = await _load_character_photo(character)
    await _generate_main_ref_sheet(task_id, slug, char, style_anchor, config, images_dir, photo_bytes)

    # Phase 2d: Cast reference sheets
    await _generate_cast_ref_sheets(task_id, slug, story, style_anchor, config, images_dir)

    # Phase 3-4: Illustrations + PDF
    await _run_illustrations_and_pdf(task_id, slug, story, config, char, style_anchor, output_dir)

    # Sync all assets to object storage
    await storage.sync_directory(output_dir, slug)

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
    family_member_ids: list[str] | None = None,
    allow_extra_cast: bool = True,
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
    family_members = await _resolve_family_members(family_member_ids)

    # Phase 0: Premise — generate synthetic parent notes
    async with _phase(task_id, "premise", "Imagining a story idea...") as r:
        notes = await asyncio.to_thread(generate_premise, char, config, family_members=family_members or None)
        r.update(notes=notes)

    # Phase 1: Story
    async with _phase(task_id, "story", "Generating story...") as r:
        title, prose = await asyncio.to_thread(generate_story, notes, char, config, style_desc, family_members=family_members or None)
        r.update(title=title, word_count=len(prose.split()))

    # Phase 2: Keyframes
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

    if family_member_ids:
        await _save_family_selection(slug, family_member_ids, allow_extra_cast)

    # Phase 2.5: Cast Extraction
    story.cast = []
    async with _phase(task_id, "cast", "Analyzing character cast for consistency...") as r:
        story = await asyncio.to_thread(
            extract_cast, story, char, config,
            family_members=family_members or None,
            allow_extra_cast=allow_extra_cast,
        )
        await _save(slug, story)
        r.update(cast_count=len(story.cast), members=[m.model_dump() for m in story.cast])

    # Phase 2b: Translation
    if language:
        story = await _run_translation_phase(task_id, slug, story, language, config)

    # Phase 2c: Reference Sheet
    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    photo_bytes = await _load_character_photo(character)
    await _generate_main_ref_sheet(task_id, slug, char, style_anchor, config, images_dir, photo_bytes)

    # Phase 2d: Cast reference sheets
    await _generate_cast_ref_sheets(task_id, slug, story, style_anchor, config, images_dir)

    # Phase 2e: Cover Variations — generate + auto-select #1
    import shutil
    try:
        ref_bytes = load_reference_sheet(images_dir)
        await _generate_cover_variations_phase(
            task_id, slug, story, char, style_anchor, config, images_dir, ref_bytes,
        )
        # Auto-select cover #1
        chosen = images_dir / "cover_v1.png"
        chosen_raw = images_dir / "cover_v1_raw.png"
        if chosen.exists():
            shutil.copy2(chosen, images_dir / "cover.png")
        if chosen_raw.exists():
            shutil.copy2(chosen_raw, images_dir / "cover_raw.png")
    except Exception:
        logger.warning("Cover variation generation failed — cover will be generated during illustration phase", exc_info=True)

    # Phase 3-4: Illustrations + PDF
    await _run_illustrations_and_pdf(task_id, slug, story, config, char, style_anchor, output_dir)

    # Sync all assets to object storage
    await storage.sync_directory(output_dir, slug)

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
    family_member_ids: list[str] | None = None,
    allow_extra_cast: bool = True,
) -> dict:
    """Run all pre-illustration phases and pause for unified review.

    Phases: story → keyframes → cast → ref sheets → translation → cover variations → PAUSE.
    After the user reviews everything and picks a cover, call run_after_cover_selection().
    """
    logger.info("run_story_only: task=%s character=%s style=%s", task_id, character, style)
    span = trace.get_current_span()
    span.set_attribute("pipeline.type", "story_only")
    config = build_config(character=character, narrator=narrator, style=style, pages=pages, text_model=text_model)
    char = await async_resolve_character(config.character)
    style_data = load_style(config.style)
    style_desc = style_data["description"]
    style_anchor = style_data.get("anchor", style_desc)
    family_members = await _resolve_family_members(family_member_ids)

    async with _phase(task_id, "story", "Generating story...") as r:
        title, prose = await asyncio.to_thread(generate_story, notes, char, config, style_desc, family_members=family_members or None)
        r.update(title=title, word_count=len(prose.split()))

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

    if family_member_ids:
        await _save_family_selection(slug, family_member_ids, allow_extra_cast)

    # Phase 2.5: Cast Extraction
    story.cast = []
    async with _phase(task_id, "cast", "Analyzing character cast for consistency...") as r:
        story = await asyncio.to_thread(
            extract_cast, story, char, config,
            family_members=family_members or None,
            allow_extra_cast=allow_extra_cast,
        )
        await _save(slug, story)
        r.update(cast_count=len(story.cast), members=[m.model_dump() for m in story.cast])

    # Phase 2c: Main character reference sheet
    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    photo_bytes = await _load_character_photo(character)
    ref_url = await _generate_main_ref_sheet(task_id, slug, char, style_anchor, config, images_dir, photo_bytes)

    # Phase 2d: Cast reference sheets
    cast_ref_urls = await _generate_cast_ref_sheets(task_id, slug, story, style_anchor, config, images_dir)

    # Phase 2b: Translation (if language configured)
    if language:
        story = await _run_translation_phase(task_id, slug, story, language, config)

    # Phase 2e: Cover Variations
    ref_bytes = load_reference_sheet(images_dir)
    cover_variations = await _generate_cover_variations_phase(
        task_id, slug, story, char, style_anchor, config, images_dir, ref_bytes,
    )

    # Sync ref sheets + cover variations to object storage
    await storage.sync_directory(output_dir, slug)

    return {
        "slug": slug,
        "title": story.title,
        "has_keyframes": True,
        "cast_count": len(story.cast),
        "cast_ref_urls": cast_ref_urls,
        "reference_sheet_url": ref_url,
        "cover_variations": cover_variations,
    }


async def run_cast_extraction(task_id: str, slug: str) -> dict:
    """Run cast extraction on an existing story, then generate reference sheets."""
    ctx = await _load_pipeline_context(slug)

    ctx.story.cast = []
    async with _phase(task_id, "cast", "Analyzing character cast for consistency...") as r:
        ctx.story = await asyncio.to_thread(
            extract_cast, ctx.story, ctx.char, ctx.config,
            family_members=ctx.family_members or None,
            allow_extra_cast=ctx.allow_extra_cast,
        )
        await _save(slug, ctx.story, [str(p) for p in ctx.image_paths])
        r.update(cast_count=len(ctx.story.cast), members=[m.model_dump() for m in ctx.story.cast])

    # Phase 2c: Main character reference sheet
    images_dir = ctx.story_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    photo_bytes = await _load_character_photo(ctx.config.character)
    ref_url = await _generate_main_ref_sheet(task_id, slug, ctx.char, ctx.style_anchor, ctx.config, images_dir, photo_bytes)

    # Phase 2d: Cast reference sheets
    cast_ref_urls = await _generate_cast_ref_sheets(task_id, slug, ctx.story, ctx.style_anchor, ctx.config, images_dir)

    # Sync ref sheets to object storage
    await storage.sync_directory(images_dir, f"{slug}/images")

    return {
        "slug": slug,
        "cast_count": len(ctx.story.cast),
        "cast_ref_urls": cast_ref_urls,
        "reference_sheet_url": ref_url,
    }


async def run_translate(task_id: str, slug: str, language: str) -> dict:
    """Run translation on an existing story."""
    ctx = await _load_pipeline_context(slug)

    async with _phase(task_id, "translation", f"Translating to {language}...") as r:
        ctx.story = await asyncio.to_thread(translate_story, ctx.story, language, ctx.config)
        await _save(slug, ctx.story, [str(p) for p in ctx.image_paths])
        r.update(translated_title=ctx.story.title_translated)

    return {"slug": slug, "translated_title": ctx.story.title_translated}


async def run_illustrate(task_id: str, slug: str, page_number: int | None = None) -> dict:
    """Run illustration on an existing story. If page_number given, regenerate only that page."""
    ctx = await _load_pipeline_context(slug)

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

    # Sync illustrations to object storage
    await storage.sync_directory(images_dir, f"{slug}/images")

    return {"slug": slug, "images_generated": len(new_paths)}


async def run_regenerate_cast_ref_sheet(task_id: str, slug: str, member_name: str) -> dict:
    """Regenerate a single cast member's reference sheet."""
    ctx = await _load_pipeline_context(slug)
    member = next((m for m in ctx.story.cast if m.name == member_name), None)
    if not member:
        raise ValueError(f"Cast member '{member_name}' not found")

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

    # Sync updated ref sheet to object storage
    for suffix in [f"ref_{name_slug}.png", f"ref_{name_slug}_raw.png"]:
        p = images_dir / suffix
        if p.exists():
            await storage.upload_file(f"{slug}/images/{suffix}", p)

    return {"slug": slug, "name": member_name, "url": url}


async def run_continue_pipeline(task_id: str, slug: str, cast_edited: bool = False) -> dict:
    """Continue pipeline after cast review: translate → ref sheet → cover variations → STOP.

    The pipeline pauses here for cover selection. After the user picks a cover,
    run_after_cover_selection() finishes with page illustrations → PDF.
    """
    logger.info("run_continue_pipeline: task=%s slug=%s cast_edited=%s", task_id, slug, cast_edited)
    span = trace.get_current_span()
    span.set_attribute("pipeline.type", "continue")
    span.set_attribute("pipeline.slug", slug)
    ctx = await _load_pipeline_context(slug)

    images_dir = ctx.story_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    # Re-run cast rewrite + regen if the user edited the cast during review
    if cast_edited:
        await _run_cast_rewrite_and_regen(task_id, slug, ctx, images_dir)

    # Phase 2b: Translation (if language configured and not already done)
    if ctx.language and not ctx.story.title_translated:
        ctx.story = await _run_translation_phase(
            task_id, slug, ctx.story, ctx.language, ctx.config,
            [str(p) for p in ctx.image_paths],
        )

    # Phase 2d: Cover Variations (ref sheet already generated during cast extraction)
    ref_bytes = load_reference_sheet(images_dir)
    cover_variations = await _generate_cover_variations_phase(
        task_id, slug, ctx.story, ctx.char, ctx.style_anchor, ctx.config, images_dir, ref_bytes,
    )

    if cover_variations:
        await storage.sync_directory(images_dir, f"{slug}/images")

    return {
        "slug": slug,
        "title": ctx.story.title,
        "cover_variations": cover_variations,
    }


async def run_approve_pipeline(task_id: str, slug: str, choice: int, cast_edited: bool = False) -> dict:
    """Unified approve: optionally re-process cast edits, then continue to illustrations + PDF.

    This handles the case where the user edited cast fields during review.
    It runs cast rewrite + ref sheet regeneration, then passes through to cover selection + illustrations.
    """
    logger.info("run_approve_pipeline: task=%s slug=%s choice=%d cast_edited=%s", task_id, slug, choice, cast_edited)
    span = trace.get_current_span()
    span.set_attribute("pipeline.type", "approve")
    ctx = await _load_pipeline_context(slug)

    images_dir = ctx.story_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    if cast_edited:
        await _run_cast_rewrite_and_regen(task_id, slug, ctx, images_dir)

    return await run_after_cover_selection(task_id, slug, choice)


async def run_after_cover_selection(task_id: str, slug: str, choice: int) -> dict:
    """Continue pipeline after cover selection: copy cover → page illustrations → PDF."""
    logger.info("run_after_cover_selection: task=%s slug=%s choice=%d", task_id, slug, choice)
    span = trace.get_current_span()
    span.set_attribute("pipeline.type", "after_cover_selection")
    span.set_attribute("pipeline.slug", slug)
    span.set_attribute("pipeline.cover_choice", choice)
    import shutil
    ctx = await _load_pipeline_context(slug)

    images_dir = ctx.story_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    # Generate cover variations if they don't exist (auto-resume after crash)
    chosen_path = images_dir / f"cover_v{choice}.png"
    if not chosen_path.exists():
        cover_kf = next((kf for kf in ctx.story.keyframes if kf.is_cover), None)
        if cover_kf:
            # Ensure reference sheet exists
            photo_bytes = await _load_character_photo(ctx.config.character)
            await asyncio.to_thread(
                generate_reference_sheet, ctx.char, ctx.style_anchor, ctx.config, images_dir, photo_bytes,
            )
            ref_for_cover = load_reference_sheet(images_dir)
            try:
                await _generate_cover_variations_phase(
                    task_id, slug, ctx.story, ctx.char, ctx.style_anchor, ctx.config, images_dir, ref_for_cover,
                )
            except Exception:
                logger.warning("Cover generation failed during resume — continuing without cover", exc_info=True)

    # Copy chosen cover variation to cover.png
    chosen_raw = images_dir / f"cover_v{choice}_raw.png"
    cover_final = images_dir / "cover.png"
    cover_raw = images_dir / "cover_raw.png"

    if chosen_path.exists():
        shutil.copy2(chosen_path, cover_final)
    if chosen_raw.exists():
        shutil.copy2(chosen_raw, cover_raw)

    # Phase 3-4: Illustrations + PDF
    await _run_illustrations_and_pdf(task_id, slug, ctx.story, ctx.config, ctx.char, ctx.style_anchor, ctx.story_dir)

    # Sync all assets to object storage
    await storage.sync_directory(ctx.story_dir, slug)

    return {"slug": slug, "title": ctx.story.title}


def _resolve_animation_mode() -> str:
    """Determine animation mode: local, remote, or auto-detect."""
    from src.animator.generator import WAN_PYTHON
    mode = os.environ.get("ANIMATION_MODE", "auto")
    if mode == "auto":
        return "local" if Path(WAN_PYTHON).exists() else "remote"
    return mode


async def run_animate(task_id: str, slug: str) -> dict:
    """Generate animated video clips — dispatches to local or remote mode."""
    mode = _resolve_animation_mode()
    logger.info("run_animate: task=%s slug=%s mode=%s", task_id, slug, mode)
    if mode == "local":
        return await _run_animate_local(task_id, slug)
    else:
        return await _run_animate_remote(task_id, slug)


async def _run_animate_local(task_id: str, slug: str) -> dict:
    """Run animation locally via Wan 2.2 subprocess."""
    span = trace.get_current_span()
    span.set_attribute("pipeline.type", "animate")
    span.set_attribute("pipeline.slug", slug)
    span.set_attribute("pipeline.animation_mode", "local")
    ctx = await _load_pipeline_context(slug)

    if not ctx.image_paths:
        raise ValueError("Story has no illustrations — generate images first")

    from src.animator.generator import generate_all_clips

    async def _on_progress(idx, total, output_path, skipped):
        kf = ctx.story.keyframes[idx]
        prefix = kf.image_prefix
        await task_manager.broadcast(task_id, {
            "type": "video_complete",
            "page": kf.page_number,
            "progress": idx + 1,
            "total": total,
            "url": f"/api/stories/{slug}/videos/{prefix}.mp4",
            "skipped": skipped,
        })

    loop = asyncio.get_event_loop()

    def sync_on_progress(idx, total, output_path, skipped):
        future = asyncio.run_coroutine_threadsafe(
            _on_progress(idx, total, output_path, skipped), loop
        )
        future.result(timeout=10)

    async with _phase(task_id, "animation", "Generating animations...", total=len(ctx.story.keyframes)):
        clip_paths = await asyncio.to_thread(
            generate_all_clips,
            ctx.story_dir,
            ctx.story.keyframes,
            on_progress=sync_on_progress,
        )

    # Sync videos to object storage
    await storage.sync_directory(ctx.story_dir / "videos", f"{slug}/videos")

    await _update_video_db(slug, clip_paths)
    return {"slug": slug, "clips_generated": len(clip_paths)}


async def _run_animate_remote(task_id: str, slug: str) -> dict:
    """Run animation via remote GPU worker (pull-based queue)."""
    from server.services.animation_queue import (
        AnimationQueue, AnimationJob, set_active_queue,
    )
    from src.animator.generator import build_animation_prompt

    span = trace.get_current_span()
    span.set_attribute("pipeline.type", "animate")
    span.set_attribute("pipeline.slug", slug)
    span.set_attribute("pipeline.animation_mode", "remote")
    ctx = await _load_pipeline_context(slug)

    if not ctx.image_paths:
        raise ValueError("Story has no illustrations — generate images first")

    images_dir = ctx.story_dir / "images"
    videos_dir = ctx.story_dir / "videos"
    videos_dir.mkdir(parents=True, exist_ok=True)

    # Track completed count for progress
    completed = {"count": 0}

    async def on_job_complete(job: AnimationJob, video_path: Path | None):
        completed["count"] += 1
        kf = next((k for k in ctx.story.keyframes if k.image_prefix == job.image_prefix), None)
        page = kf.page_number if kf else job.page_number
        await task_manager.broadcast(task_id, {
            "type": "video_complete",
            "page": page,
            "progress": completed["count"],
            "total": queue.total,
            "url": f"/api/stories/{slug}/videos/{job.image_prefix}.mp4",
            "skipped": video_path is None,
        })

    queue = AnimationQueue(slug=slug, task_id=task_id, on_complete=on_job_complete)

    # Populate jobs for each keyframe
    for kf in ctx.story.keyframes:
        video_path = videos_dir / f"{kf.image_prefix}.mp4"
        image_path = images_dir / f"{kf.image_prefix}.png"

        if video_path.exists():
            # Already done — broadcast skip immediately
            completed["count"] += 1
            await task_manager.broadcast(task_id, {
                "type": "video_complete",
                "page": kf.page_number,
                "progress": completed["count"],
                "total": len(ctx.story.keyframes),
                "url": f"/api/stories/{slug}/videos/{kf.image_prefix}.mp4",
                "skipped": True,
            })
            continue

        if not image_path.exists():
            logger.warning("Image %s not found, skipping animation", kf.image_prefix)
            completed["count"] += 1
            await task_manager.broadcast(task_id, {
                "type": "video_complete",
                "page": kf.page_number,
                "progress": completed["count"],
                "total": len(ctx.story.keyframes),
                "url": f"/api/stories/{slug}/videos/{kf.image_prefix}.mp4",
                "skipped": True,
            })
            continue

        queue.add_job(AnimationJob(
            job_id=uuid.uuid4().hex[:12],
            slug=slug,
            page_number=kf.page_number,
            image_prefix=kf.image_prefix,
            prompt=build_animation_prompt(kf),
        ))

    if queue.total == 0:
        # All clips already exist
        return {"slug": slug, "clips_generated": 0}

    # Activate queue so worker can poll
    await set_active_queue(queue)

    # Start stale-job watchdog
    watchdog_task = asyncio.create_task(_stale_job_watchdog(queue))

    try:
        async with _phase(task_id, "animation", "Waiting for remote GPU worker...", total=len(ctx.story.keyframes)):
            finished = await queue.wait_all(timeout=14400)
            if not finished:
                logger.error("Animation timed out for slug=%s", slug)
                raise TimeoutError("Animation timed out after 4 hours")
    finally:
        watchdog_task.cancel()
        await set_active_queue(None)

    # Collect completed video paths
    clip_paths = [
        videos_dir / f"{kf.image_prefix}.mp4"
        for kf in ctx.story.keyframes
        if (videos_dir / f"{kf.image_prefix}.mp4").exists()
    ]

    # Sync videos to object storage
    videos_dir = ctx.story_dir / "videos"
    await storage.sync_directory(videos_dir, f"{slug}/videos")

    await _update_video_db(slug, clip_paths)
    return {"slug": slug, "clips_generated": len(clip_paths)}


async def _stale_job_watchdog(queue: AnimationQueue) -> None:
    """Periodically re-queue jobs stuck in assigned status (worker crash recovery)."""
    try:
        while not queue.is_all_done():
            await asyncio.sleep(60)
            requeued = await queue.requeue_stale()
            if requeued:
                logger.warning("Watchdog re-queued %d stale jobs", requeued)
    except asyncio.CancelledError:
        pass


async def _update_video_db(slug: str, clip_paths: list[Path]) -> None:
    """Update DB: mark keyframes and story as having video."""
    from src.db.engine import get_async_session_factory
    from src.db.models import StoryRow
    from sqlalchemy import select as sa_select

    async with get_async_session_factory()() as session:
        result = await session.execute(
            sa_select(StoryRow).where(StoryRow.slug == slug)
        )
        row = result.scalar_one_or_none()
        if row:
            video_prefixes = {p.stem for p in clip_paths}
            for kf_row in row.keyframes:
                prefix = "cover" if kf_row.is_cover else f"page_{kf_row.page_number:02d}"
                if prefix in video_prefixes:
                    kf_row.has_video = True
            row.has_video = any(kf.has_video for kf in row.keyframes)
            await session.commit()


async def run_pdf(task_id: str, slug: str) -> dict:
    """Render PDFs for an existing story."""
    ctx = await _load_pipeline_context(slug)
    backdrop_paths = get_static_backdrops(slug)

    async with _phase(task_id, "pdf", "Rendering PDF..."):
        pdf_path = ctx.story_dir / "book.pdf"
        await asyncio.to_thread(render_book_pdf, ctx.story, ctx.image_paths, pdf_path, backdrop_paths or None)

    return {"slug": slug}
