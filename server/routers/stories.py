from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from server.routers._shared import generate_thumbnail
from server.schemas import StoryListItem, StoryUpdate
from server.services.story_service import (
    list_stories, get_story, update_story, delete_story, get_story_dir, get_metadata,
    get_db_flags, STORIES_DIR,
)
from src import storage
from src.utils.io import get_static_backdrops, slugify

router = APIRouter(prefix="/api/stories", tags=["stories"])


@router.get("/", response_model=list[StoryListItem])
async def list_all_stories():
    return await list_stories()


@router.get("/{slug}")
async def get_story_detail(slug: str):
    try:
        story, image_paths, story_dir = await get_story(slug)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Story not found")

    images_dir = story_dir / "images"
    image_urls = {}
    for kf in story.keyframes:
        img = images_dir / f"{kf.image_prefix}.png"
        # Check local first; if not found, check if we have image_paths from DB
        if img.exists() or image_paths:
            image_urls[kf.page_number] = f"/api/stories/{slug}/images/{kf.image_prefix}.png"

    backdrop_urls = [
        f"/api/config/backdrops/{p.name}"
        for p in get_static_backdrops(slug)
    ]

    # Check for reference sheet
    ref_sheet_path = images_dir / "reference_sheet.png"
    reference_sheet_url = f"/api/stories/{slug}/images/reference_sheet.png" if ref_sheet_path.exists() else None

    # Check for cover variation files (cover_v1.png, cover_v2.png, ...)
    cover_variation_urls = []
    for i in range(1, 5):
        vp = images_dir / f"cover_v{i}.png"
        if vp.exists():
            cover_variation_urls.append(f"/api/stories/{slug}/images/cover_v{i}.png")

    # Check for per-cast-member reference sheets
    cast_ref_urls: dict[str, str] = {}
    for member in story.cast:
        name_slug = slugify(member.name)
        ref_path = images_dir / f"ref_{name_slug}.png"
        if ref_path.exists():
            cast_ref_urls[member.name] = f"/api/stories/{slug}/images/ref_{name_slug}.png"

    # Video URLs — check local disk, then fall back to MinIO probe when DB says videos exist
    videos_dir = story_dir / "videos"
    video_urls: dict[int, str] = {}
    db_flags = await get_db_flags(slug)
    for kf in story.keyframes:
        vid = videos_dir / f"{kf.image_prefix}.mp4"
        if vid.exists():
            video_urls[kf.page_number] = f"/api/stories/{slug}/videos/{kf.image_prefix}.mp4"
    # If DB says videos exist but none found locally, assume MinIO has them —
    # the serve endpoint will download on demand via ensure_local()
    if not video_urls and db_flags["has_video"]:
        for kf in story.keyframes:
            video_urls[kf.page_number] = f"/api/stories/{slug}/videos/{kf.image_prefix}.mp4"

    metadata = await get_metadata(slug)

    return {
        "slug": slug,
        "story": story.model_dump(),
        "image_urls": image_urls,
        "video_urls": video_urls,
        "backdrop_urls": backdrop_urls,
        "cover_variation_urls": cover_variation_urls,
        "reference_sheet_url": reference_sheet_url,
        "cast_ref_urls": cast_ref_urls,
        "has_pdf": db_flags["has_pdf"] or (story_dir / "book.pdf").exists(),
        "has_screen_pdf": db_flags["has_pdf"] or (story_dir / "book-screen.pdf").exists(),
        "has_spread_pdf": db_flags["has_pdf"] or (story_dir / "book-spreads.pdf").exists(),
        "has_video": db_flags["has_video"] or len(video_urls) > 0,
        "metadata": metadata,
    }


@router.put("/{slug}")
async def update_story_detail(slug: str, update: StoryUpdate):
    try:
        keyframe_dict = None
        if update.keyframes:
            keyframe_dict = {k: v.model_dump(exclude_none=True) for k, v in update.keyframes.items()}
        cast_list = None
        if update.cast is not None:
            cast_list = [c.model_dump() for c in update.cast]
        story = await update_story(slug, update.title, update.dedication, keyframe_dict, cast_list)
        return {"status": "ok", "story": story.model_dump()}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Story not found")


@router.delete("/{slug}")
async def delete_story_endpoint(slug: str):
    try:
        await delete_story(slug)
        return {"status": "ok"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Story not found")


ALLOWED_WIDTHS = {200, 400, 600, 800}


@router.get("/{slug}/images/{filename}")
async def serve_image(slug: str, filename: str, w: int | None = Query(None)):
    story_dir = STORIES_DIR / slug
    file_path = story_dir / "images" / filename

    # Try local first, fall back to MinIO download + cache
    if not file_path.exists():
        key = f"{slug}/images/{filename}"
        found = await storage.ensure_local(key, file_path)
        if not found:
            raise HTTPException(status_code=404, detail="Image not found")

    # No resize requested — serve full image
    if w is None:
        return FileResponse(file_path, media_type="image/png")

    # Clamp to allowed widths
    width = min(ALLOWED_WIDTHS, key=lambda x: abs(x - w))

    # Check for cached thumbnail
    thumbs_dir = story_dir / "images" / ".thumbs"
    stem = file_path.stem
    thumb_path = thumbs_dir / f"{stem}_w{width}.jpg"

    if not thumb_path.exists():
        # Prefer _raw.png (1024x1024) as source if it exists — smaller to decode
        raw_path = file_path.with_name(f"{stem}_raw.png")
        source = raw_path if raw_path.exists() else file_path
        thumbs_dir.mkdir(exist_ok=True)
        await asyncio.to_thread(generate_thumbnail, source, thumb_path, width)

    return FileResponse(thumb_path, media_type="image/jpeg")


@router.get("/{slug}/videos/{filename}")
async def serve_video(slug: str, filename: str):
    story_dir = STORIES_DIR / slug
    file_path = story_dir / "videos" / filename

    if not file_path.exists():
        key = f"{slug}/videos/{filename}"
        found = await storage.ensure_local(key, file_path)
        if not found:
            raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(file_path, media_type="video/mp4")


@router.get("/{slug}/backdrops/{filename}")
async def serve_backdrop(slug: str, filename: str):
    story_dir = STORIES_DIR / slug
    file_path = story_dir / "backdrops" / filename

    if not file_path.exists():
        key = f"{slug}/backdrops/{filename}"
        found = await storage.ensure_local(key, file_path)
        if not found:
            raise HTTPException(status_code=404, detail="Backdrop not found")
    return FileResponse(file_path, media_type="image/png")


@router.get("/{slug}/pdf/{variant}")
async def serve_pdf(slug: str, variant: str):
    story_dir = STORIES_DIR / slug

    filename_map = {
        "print": "book.pdf",
        "screen": "book-screen.pdf",
        "spreads": "book-spreads.pdf",
    }
    filename = filename_map.get(variant)
    if not filename:
        raise HTTPException(status_code=400, detail=f"Unknown variant: {variant}. Use: print, screen, spreads")

    file_path = story_dir / filename
    if not file_path.exists():
        key = f"{slug}/{filename}"
        found = await storage.ensure_local(key, file_path)
        if not found:
            raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(file_path, media_type="application/pdf")
