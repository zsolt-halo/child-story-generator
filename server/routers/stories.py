from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from server.schemas import StoryListItem, StoryUpdate
from server.services.story_service import (
    list_stories, get_story, update_story, delete_story, get_story_dir, get_metadata,
)

router = APIRouter(prefix="/api/stories", tags=["stories"])


def _generate_thumbnail(source: Path, dest: Path, width: int):
    """Resize an image to the given width (preserving aspect ratio) and save as JPEG."""
    from PIL import Image
    with Image.open(source) as img:
        ratio = width / img.width
        height = round(img.height * ratio)
        resized = img.resize((width, height), Image.LANCZOS)
        resized = resized.convert("RGB")
        resized.save(dest, "JPEG", quality=82, optimize=True)


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
        if img.exists():
            image_urls[kf.page_number] = f"/api/stories/{slug}/images/{kf.image_prefix}.png"

    from src.utils.io import discover_backdrops
    backdrop_urls = [
        f"/api/stories/{slug}/images/../backdrops/{p.name}"
        for p in discover_backdrops(story_dir)
    ]

    metadata = await get_metadata(slug)

    return {
        "slug": slug,
        "story": story.model_dump(),
        "image_urls": image_urls,
        "backdrop_urls": backdrop_urls,
        "has_pdf": (story_dir / "book.pdf").exists(),
        "has_screen_pdf": (story_dir / "book-screen.pdf").exists(),
        "has_spread_pdf": (story_dir / "book-spreads.pdf").exists(),
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
    try:
        story_dir = get_story_dir(slug)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Story not found")

    file_path = story_dir / "images" / filename
    if not file_path.exists():
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
        await asyncio.to_thread(_generate_thumbnail, source, thumb_path, width)

    return FileResponse(thumb_path, media_type="image/jpeg")


@router.get("/{slug}/backdrops/{filename}")
async def serve_backdrop(slug: str, filename: str):
    try:
        story_dir = get_story_dir(slug)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Story not found")

    file_path = story_dir / "backdrops" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Backdrop not found")
    return FileResponse(file_path, media_type="image/png")


@router.get("/{slug}/pdf/{variant}")
async def serve_pdf(slug: str, variant: str):
    try:
        story_dir = get_story_dir(slug)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Story not found")

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
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(file_path, media_type="application/pdf")
