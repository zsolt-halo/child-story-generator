from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from src.utils.config import CHARACTERS_DIR, CONFIGS_DIR, load_character, load_style
from src.brain.prompts import NARRATOR_PERSONAS
from server.schemas import CharacterInfo, StyleInfo, NarratorInfo

router = APIRouter(prefix="/api/config", tags=["config"])

PREVIEW_DIR = CONFIGS_DIR / "style_previews"
ALLOWED_PREVIEW_WIDTHS = [200, 400, 600, 800]


def _generate_preview_thumb(source: Path, dest: Path, width: int):
    from PIL import Image
    with Image.open(source) as img:
        ratio = width / img.width
        height = round(img.height * ratio)
        resized = img.resize((width, height), Image.LANCZOS)
        resized = resized.convert("RGB")
        resized.save(dest, "JPEG", quality=82, optimize=True)


@router.get("/characters", response_model=list[CharacterInfo])
async def list_characters():
    if not CHARACTERS_DIR.exists():
        return []

    characters = []
    for path in sorted(CHARACTERS_DIR.glob("*.toml")):
        try:
            char = load_character(path.stem)
            characters.append(CharacterInfo(
                name=char.name,
                slug=path.stem,
                child_name=char.child_name,
                description=char.visual.description,
                constants=char.visual.constants,
            ))
        except Exception:
            continue
    return characters


@router.get("/characters/{name}", response_model=CharacterInfo)
async def get_character(name: str):
    try:
        char = load_character(name)
        return CharacterInfo(
            name=char.name,
            slug=name,
            child_name=char.child_name,
            description=char.visual.description,
            constants=char.visual.constants,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Character not found: {name}")


@router.get("/styles", response_model=list[StyleInfo])
async def list_styles():
    import tomllib

    styles_path = CONFIGS_DIR / "styles.toml"
    if not styles_path.exists():
        return []

    with open(styles_path, "rb") as f:
        data = tomllib.load(f)

    results = []
    for name, style in data.items():
        preview_path = PREVIEW_DIR / f"{name}.png"
        preview_url = f"/api/config/style-preview/{name}" if preview_path.exists() else None
        results.append(StyleInfo(name=name, description=style["description"], preview_url=preview_url))
    return results


@router.get("/style-preview/{style_name}")
async def serve_style_preview(style_name: str, w: int | None = Query(None)):
    preview_path = PREVIEW_DIR / f"{style_name}.png"
    if not preview_path.exists():
        raise HTTPException(status_code=404, detail="Style preview not found")

    if w is None:
        return FileResponse(preview_path, media_type="image/png")

    width = min(ALLOWED_PREVIEW_WIDTHS, key=lambda x: abs(x - w))
    thumbs_dir = PREVIEW_DIR / ".thumbs"
    thumb_path = thumbs_dir / f"{style_name}_w{width}.jpg"

    if not thumb_path.exists():
        thumbs_dir.mkdir(exist_ok=True)
        await asyncio.to_thread(_generate_preview_thumb, preview_path, thumb_path, width)

    return FileResponse(thumb_path, media_type="image/jpeg")


@router.get("/phase-averages")
async def get_phase_averages():
    """Return rolling averages of pipeline phase durations for ETA estimation."""
    from server.services.pipeline_service import get_phase_averages as _get
    return await _get()


@router.get("/narrators", response_model=list[NarratorInfo])
async def list_narrators():
    return [
        NarratorInfo(
            name=persona["name"],
            slug=key,
            description=persona["instruction"],
            example=persona["example"],
        )
        for key, persona in NARRATOR_PERSONAS.items()
    ]
