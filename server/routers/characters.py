import asyncio
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from server.schemas import (
    CharacterDetail,
    CharacterCreateRequest,
    CharacterUpdateRequest,
    CharacterPolishRequest,
    CharacterPolishResponse,
    TaskResponse,
)
from server.services import character_service
from server.services.task_manager import task_manager

router = APIRouter(prefix="/api/characters", tags=["characters"])

ALLOWED_WIDTHS = {200, 400, 600, 800}


def _generate_thumbnail(source: Path, dest: Path, width: int):
    """Resize an image to the given width (preserving aspect ratio) and save as JPEG."""
    from PIL import Image
    with Image.open(source) as img:
        ratio = width / img.width
        height = round(img.height * ratio)
        resized = img.resize((width, height), Image.LANCZOS)
        resized = resized.convert("RGB")
        resized.save(dest, "JPEG", quality=82, optimize=True)


@router.get("/", response_model=list[CharacterDetail])
async def list_characters():
    return await character_service.list_all_characters()


@router.get("/{id}", response_model=CharacterDetail)
async def get_character(id: str):
    try:
        return await character_service.get_character(id)
    except FileNotFoundError:
        raise HTTPException(404, "Character not found")


@router.post("/", response_model=CharacterDetail, status_code=201)
async def create_character(req: CharacterCreateRequest):
    data = req.model_dump()
    try:
        return await character_service.create_character(data)
    except Exception as e:
        raise HTTPException(400, str(e))


@router.put("/{id}", response_model=CharacterDetail)
async def update_character(id: str, req: CharacterUpdateRequest):
    data = {k: v for k, v in req.model_dump().items() if v is not None}
    try:
        return await character_service.update_character(id, data)
    except FileNotFoundError:
        raise HTTPException(404, "Character not found")


@router.delete("/{id}", status_code=204)
async def delete_character(id: str):
    try:
        await character_service.delete_character(id)
    except FileNotFoundError:
        raise HTTPException(404, "Character not found")
    except ValueError as e:
        raise HTTPException(409, str(e))


@router.post("/{id}/duplicate", response_model=CharacterDetail, status_code=201)
async def duplicate_character(id: str):
    """Duplicate a custom character."""
    try:
        return await character_service.duplicate_character(id)
    except FileNotFoundError:
        raise HTTPException(404, "Character not found")


@router.post(
    "/duplicate-template/{slug}", response_model=CharacterDetail, status_code=201
)
async def duplicate_template(slug: str):
    """Duplicate a TOML template as a new custom character."""
    try:
        return await character_service.duplicate_template(slug)
    except FileNotFoundError:
        raise HTTPException(404, f"Template not found: {slug}")


@router.post("/polish", response_model=CharacterPolishResponse)
async def polish_character(req: CharacterPolishRequest):
    try:
        return await character_service.polish_character(
            req.name, req.child_name, req.rough_description
        )
    except Exception as e:
        raise HTTPException(500, f"Polish failed: {e}")


@router.get("/template/{slug}/reference-sheet")
async def serve_template_reference_sheet(slug: str, w: int | None = Query(None)):
    """Serve the reference sheet image for a TOML template character."""
    file_path = Path(f"characters/{slug}/reference_sheet.png")
    if not file_path.exists():
        raise HTTPException(404, "Reference sheet not found")

    if w is None:
        return FileResponse(file_path, media_type="image/png")

    width = min(ALLOWED_WIDTHS, key=lambda x: abs(x - w))
    thumbs_dir = file_path.parent / ".thumbs"
    thumb_path = thumbs_dir / f"reference_sheet_w{width}.jpg"

    if not thumb_path.exists():
        thumbs_dir.mkdir(exist_ok=True)
        await asyncio.to_thread(_generate_thumbnail, file_path, thumb_path, width)

    return FileResponse(thumb_path, media_type="image/jpeg")


@router.get("/{id}/reference-sheet")
async def serve_reference_sheet(id: str, w: int | None = Query(None)):
    """Serve the reference sheet image for a custom character."""
    from src.db.character_repository import CharacterRepository

    try:
        row = await CharacterRepository().async_get_by_id(uuid.UUID(id))
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Character not found")

    file_path = Path(f"characters/{row.slug}/reference_sheet.png")
    if not file_path.exists():
        raise HTTPException(404, "Reference sheet not found")

    if w is None:
        return FileResponse(file_path, media_type="image/png")

    width = min(ALLOWED_WIDTHS, key=lambda x: abs(x - w))
    thumbs_dir = file_path.parent / ".thumbs"
    thumb_path = thumbs_dir / f"reference_sheet_w{width}.jpg"

    if not thumb_path.exists():
        thumbs_dir.mkdir(exist_ok=True)
        await asyncio.to_thread(_generate_thumbnail, file_path, thumb_path, width)

    return FileResponse(thumb_path, media_type="image/jpeg")


@router.post("/{identifier}/generate-reference-sheet", response_model=TaskResponse)
async def generate_reference_sheet(identifier: str):
    """Start async generation of a character reference sheet.

    ``identifier`` can be a UUID (custom character) or a template slug.
    """
    # Determine the slug and pipeline identifier
    if _looks_like_uuid(identifier):
        from src.db.character_repository import CharacterRepository
        try:
            row = await CharacterRepository().async_get_by_id(uuid.UUID(identifier))
        except (FileNotFoundError, ValueError):
            raise HTTPException(404, "Character not found")
        slug = row.slug
        pipeline_id = f"custom:{identifier}"
    else:
        # Template slug — validate it exists
        from src.utils.config import load_character
        try:
            load_character(identifier)
        except FileNotFoundError:
            raise HTTPException(404, f"Template not found: {identifier}")
        slug = identifier
        pipeline_id = identifier

    task_id = task_manager.create_task(
        character_service.generate_character_reference_sheet,
        pipeline_id,
        slug,
        exclusive=True,
    )
    return TaskResponse(task_id=task_id)


def _looks_like_uuid(value: str) -> bool:
    """Check if a string looks like a UUID."""
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False
