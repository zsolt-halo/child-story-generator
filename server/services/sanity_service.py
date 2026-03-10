from __future__ import annotations

import asyncio
import json
import logging
import shutil
from pathlib import Path

from src.brain.client import generate_multimodal
from src.utils.config import build_config, load_character, load_style
from server.schemas import SanityCheckResult, SanityIssue
from server.services.task_manager import task_manager

logger = logging.getLogger(__name__)

_SANITY_SYSTEM_PROMPT = """\
You are an illustration quality checker for a children's picture book.
You compare a generated illustration against its intended description and flag discrepancies.

Analyze the image and check for:
1. **Color mismatches** — described colors not matching the image (e.g., "blue scarf" but red in image)
2. **Missing elements** — objects/items described but absent from the image
3. **Character inconsistencies** — wrong accessories, missing visual constants, wrong features
4. **Composition issues** — key scene elements not matching the description
5. **Text in image** — unwanted text/letters appearing in what should be a text-free illustration (unless it's a cover)

For each issue found, categorize severity:
- `trivial`: Can be fixed by tweaking the image prompt (wrong color, minor missing detail)
- `major`: Fundamental composition problem requiring user review

Respond in JSON format:
{
  "status": "pass" | "trivial" | "major",
  "issues": [
    {
      "category": "color_mismatch" | "missing_element" | "character_inconsistency" | "composition" | "unwanted_text",
      "severity": "trivial" | "major",
      "description": "Brief description of the issue",
      "auto_fixable": true | false
    }
  ],
  "suggested_visual_description": "If there are trivial issues, provide a corrected visual description that addresses them. Otherwise null."
}"""


async def check_single_page(
    slug: str,
    page_number: int,
) -> SanityCheckResult:
    """Run sanity check on a single page's illustration."""
    from server.services.story_service import get_story, get_metadata

    story_dir = Path("stories") / slug
    story, image_paths, _ = await get_story(slug)
    meta = await get_metadata(slug)
    config_meta = meta.get("config", {}) if meta else {}
    config = build_config(
        character=config_meta.get("character"),
        narrator=config_meta.get("narrator"),
        style=config_meta.get("style"),
        pages=config_meta.get("pages"),
    ) if config_meta else build_config()
    char = load_character(config.character)

    kf = next((k for k in story.keyframes if k.page_number == page_number), None)
    if not kf:
        raise ValueError(f"Page {page_number} not found")

    prefix = "cover" if kf.is_cover else f"page_{kf.page_number:02d}"
    image_path = story_dir / "images" / f"{prefix}.png"
    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    image_bytes = image_path.read_bytes()

    # Build cast context for secondary characters on this page
    cast_context = ""
    if story.cast:
        relevant = [m for m in story.cast if kf.page_number in m.appears_on_pages]
        if relevant:
            cast_lines = "\n".join(
                f"  - {m.name} ({m.species}): {m.visual_description}, {m.visual_constants}"
                for m in relevant
            )
            cast_context = f"\n\nSecondary characters on this page:\n{cast_lines}"

    text_prompt = f"""Check this children's book illustration against its description.

Page {kf.page_number} {"(COVER)" if kf.is_cover else ""}
Page text: {kf.page_text}
Visual description: {kf.visual_description}
Mood: {kf.mood}

Character visual constants: {char.visual.description}, {char.visual.constants}{cast_context}

Analyze the image and report any discrepancies."""

    raw = await asyncio.to_thread(
        generate_multimodal, config, _SANITY_SYSTEM_PROMPT, image_bytes, text_prompt
    )

    # Parse JSON response
    try:
        # Strip markdown code fences if present
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1]
            cleaned = cleaned.rsplit("```", 1)[0]
        data = json.loads(cleaned)
    except (json.JSONDecodeError, IndexError):
        return SanityCheckResult(
            page_number=page_number,
            status="pass",
            issues=[],
        )

    issues = [
        SanityIssue(
            category=issue.get("category", "unknown"),
            severity=issue.get("severity", "trivial"),
            description=issue.get("description", ""),
            auto_fixable=issue.get("auto_fixable", False),
        )
        for issue in data.get("issues", [])
    ]

    return SanityCheckResult(
        page_number=page_number,
        status=data.get("status", "pass"),
        issues=issues,
        suggested_visual_description=data.get("suggested_visual_description"),
    )


async def check_all_pages(task_id: str, slug: str) -> dict:
    """Run sanity check on all illustrations."""
    logger.info("Running sanity check on all pages: %s", slug)
    from server.services.story_service import get_story

    story_dir = Path("stories") / slug
    story, _, _ = await get_story(slug)

    results = []
    total = len(story.keyframes)

    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "sanity_check",
        "message": "Checking illustrations...",
        "data": {"total": total},
    })

    for i, kf in enumerate(story.keyframes):
        prefix = "cover" if kf.is_cover else f"page_{kf.page_number:02d}"
        image_path = story_dir / "images" / f"{prefix}.png"
        if not image_path.exists():
            continue

        try:
            result = await check_single_page(slug, kf.page_number)
            results.append(result.model_dump())
        except Exception as e:
            results.append({
                "page_number": kf.page_number,
                "status": "error",
                "issues": [],
                "error": str(e),
            })

        await task_manager.broadcast(task_id, {
            "type": "sanity_progress",
            "page": kf.page_number,
            "progress": i + 1,
            "total": total,
            "result": results[-1],
        })

    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "sanity_check",
    })

    return {"slug": slug, "results": results}


async def auto_fix_page(task_id: str, slug: str, page_number: int) -> dict:
    """Auto-fix a flagged illustration by updating the visual description and regenerating."""
    logger.info("Auto-fixing page %d of %s", page_number, slug)
    from server.services.story_service import get_story, save_to_db, get_metadata

    # First run sanity check to get the suggested fix
    result = await check_single_page(slug, page_number)
    if not result.suggested_visual_description:
        raise ValueError("No auto-fix suggestion available for this page")

    story, image_paths, story_dir = await get_story(slug)
    meta = await get_metadata(slug)
    config_meta = meta.get("config", {}) if meta else {}
    config = build_config(
        character=config_meta.get("character"),
        narrator=config_meta.get("narrator"),
        style=config_meta.get("style"),
        pages=config_meta.get("pages"),
    ) if config_meta else build_config()
    char = load_character(config.character)
    style_data = load_style(config.style)
    style_anchor = style_data.get("anchor", style_data["description"])

    kf = next((k for k in story.keyframes if k.page_number == page_number), None)
    if not kf:
        raise ValueError(f"Page {page_number} not found")

    # Archive old image
    prefix = "cover" if kf.is_cover else f"page_{kf.page_number:02d}"
    images_dir = story_dir / "images"
    old_image = images_dir / f"{prefix}.png"
    if old_image.exists():
        archive_path = images_dir / f"{prefix}_before_fix.png"
        shutil.copy2(old_image, archive_path)
        old_image.unlink()
        # Also remove raw
        raw = images_dir / f"{prefix}_raw.png"
        if raw.exists():
            raw.unlink()

    # Update visual description
    kf.visual_description = result.suggested_visual_description
    await save_to_db(slug, story, [str(p) for p in image_paths])

    await task_manager.broadcast(task_id, {
        "type": "phase_start", "phase": "auto_fix",
        "message": f"Regenerating page {page_number}...",
    })

    # Regenerate
    from src.artist.generator import (
        build_image_prompt, create_image_client, generate_single_image, upscale_for_print,
    )
    client = create_image_client(config)
    prompt = build_image_prompt(kf, char, style_anchor, title=story.title, cast=story.cast or None)
    raw_path = images_dir / f"{prefix}_raw.png"
    final_path = images_dir / f"{prefix}.png"

    await asyncio.to_thread(generate_single_image, client, prompt, config.image_model, raw_path)
    await asyncio.to_thread(upscale_for_print, raw_path, final_path)

    await task_manager.broadcast(task_id, {
        "type": "phase_complete", "phase": "auto_fix",
        "data": {
            "page": page_number,
            "new_url": f"/api/stories/{slug}/images/{final_path.name}",
            "before_url": f"/api/stories/{slug}/images/{prefix}_before_fix.png",
        },
    })

    # Re-run sanity check on the new image
    new_result = await check_single_page(slug, page_number)

    return {
        "slug": slug,
        "page_number": page_number,
        "new_visual_description": result.suggested_visual_description,
        "sanity_result": new_result.model_dump(),
    }
