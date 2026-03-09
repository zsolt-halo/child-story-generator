from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from server.schemas import StoryListItem, StoryUpdate
from server.services.story_service import (
    list_stories, get_story, update_story, delete_story, get_story_dir,
)
from src.utils.io import load_metadata

router = APIRouter(prefix="/api/stories", tags=["stories"])


@router.get("/", response_model=list[StoryListItem])
async def list_all_stories():
    return list_stories()


@router.get("/{slug}")
async def get_story_detail(slug: str):
    try:
        story, image_paths, story_dir = get_story(slug)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Story not found")

    images_dir = story_dir / "images"
    image_urls = {}
    for kf in story.keyframes:
        prefix = "cover" if kf.is_cover else f"page_{kf.page_number:02d}"
        img = images_dir / f"{prefix}.png"
        if img.exists():
            image_urls[kf.page_number] = f"/api/stories/{slug}/images/{prefix}.png"

    backdrops_dir = story_dir / "backdrops"
    backdrop_urls = []
    if backdrops_dir.exists():
        for p in sorted(backdrops_dir.glob("backdrop_*.png")):
            if "_raw" not in p.name:
                backdrop_urls.append(f"/api/stories/{slug}/images/../backdrops/{p.name}")

    metadata = load_metadata(story_dir)

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
        story = update_story(slug, update.title, update.dedication, keyframe_dict, cast_list)
        return {"status": "ok", "story": story.model_dump()}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Story not found")


@router.delete("/{slug}")
async def delete_story_endpoint(slug: str):
    try:
        delete_story(slug)
        return {"status": "ok"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Story not found")


@router.get("/{slug}/images/{filename}")
async def serve_image(slug: str, filename: str):
    try:
        story_dir = get_story_dir(slug)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Story not found")

    file_path = story_dir / "images" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(file_path, media_type="image/png")


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
