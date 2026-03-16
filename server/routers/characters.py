import asyncio
import io
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from PIL import Image

from server.routers._shared import generate_thumbnail
from server.schemas import (
    CharacterDetail,
    CharacterCreateRequest,
    CharacterUpdateRequest,
    CharacterPolishRequest,
    CharacterPolishResponse,
    TaskResponse,
    FamilyMemberInfo,
    AddFamilyMemberRequest,
    CreateAndLinkFamilyMemberRequest,
    UpdateFamilyLinkRequest,
    ReorderFamilyRequest,
)
from server.services import character_service
from server.services.character_service import CharacterNotFoundError, CharacterConflictError
from server.services.task_manager import task_manager
from src import storage
from src.db.character_repository import CharacterRepository
from src.utils.config import load_character

router = APIRouter(prefix="/api/characters", tags=["characters"])

ALLOWED_WIDTHS = {200, 400, 600, 800}


@router.get("/", response_model=list[CharacterDetail])
async def list_characters():
    return await character_service.list_all_characters()


@router.get("/{id}", response_model=CharacterDetail)
async def get_character(id: str):
    try:
        return await character_service.get_character(id)
    except CharacterNotFoundError as e:
        raise HTTPException(404, str(e))


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
    except CharacterNotFoundError as e:
        raise HTTPException(404, str(e))


@router.delete("/{id}", status_code=204)
async def delete_character(id: str):
    try:
        await character_service.delete_character(id)
    except CharacterNotFoundError as e:
        raise HTTPException(404, str(e))
    except CharacterConflictError as e:
        raise HTTPException(409, str(e))


@router.post("/{id}/duplicate", response_model=CharacterDetail, status_code=201)
async def duplicate_character(id: str):
    """Duplicate a custom character."""
    try:
        return await character_service.duplicate_character(id)
    except CharacterNotFoundError as e:
        raise HTTPException(404, str(e))


@router.post(
    "/duplicate-template/{slug}", response_model=CharacterDetail, status_code=201
)
async def duplicate_template(slug: str):
    """Duplicate a TOML template as a new custom character."""
    try:
        return await character_service.duplicate_template(slug)
    except CharacterNotFoundError as e:
        raise HTTPException(404, str(e))


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
    file_path = character_service._template_char_dir(slug) / "reference_sheet.png"
    if not file_path.exists():
        key = f".characters/{slug}/reference_sheet.png"
        found = await storage.ensure_local(key, file_path)
        if not found:
            raise HTTPException(404, "Reference sheet not found")

    headers = {"Cache-Control": "no-cache"}

    if w is None:
        return FileResponse(file_path, media_type="image/png", headers=headers)

    width = min(ALLOWED_WIDTHS, key=lambda x: abs(x - w))
    thumbs_dir = file_path.parent / ".thumbs"
    thumb_path = thumbs_dir / f"reference_sheet_w{width}.jpg"

    # Invalidate stale thumbnail (source was regenerated after thumbnail was cached)
    if thumb_path.exists() and file_path.stat().st_mtime > thumb_path.stat().st_mtime:
        thumb_path.unlink()

    if not thumb_path.exists():
        thumbs_dir.mkdir(exist_ok=True)
        await asyncio.to_thread(generate_thumbnail, file_path, thumb_path, width)

    return FileResponse(thumb_path, media_type="image/jpeg", headers=headers)


@router.get("/{id}/reference-sheet")
async def serve_reference_sheet(id: str, w: int | None = Query(None)):
    """Serve the reference sheet image for a custom character."""
    try:
        row = await CharacterRepository().async_get_by_id(uuid.UUID(id))
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Character not found")

    file_path = character_service._custom_char_dir(row.id) / "reference_sheet.png"
    if not file_path.exists():
        key = f".characters/{row.id}/reference_sheet.png"
        found = await storage.ensure_local(key, file_path)
        if not found:
            raise HTTPException(404, "Reference sheet not found")

    # no-cache: browser must revalidate (ETag/Last-Modified) on every request,
    # so regenerated ref sheets are never served stale.
    headers = {"Cache-Control": "no-cache"}

    if w is None:
        return FileResponse(file_path, media_type="image/png", headers=headers)

    width = min(ALLOWED_WIDTHS, key=lambda x: abs(x - w))
    thumbs_dir = file_path.parent / ".thumbs"
    thumb_path = thumbs_dir / f"reference_sheet_w{width}.jpg"

    # Invalidate stale thumbnail (source was regenerated after thumbnail was cached)
    if thumb_path.exists() and file_path.stat().st_mtime > thumb_path.stat().st_mtime:
        thumb_path.unlink()

    if not thumb_path.exists():
        thumbs_dir.mkdir(exist_ok=True)
        await asyncio.to_thread(generate_thumbnail, file_path, thumb_path, width)

    return FileResponse(thumb_path, media_type="image/jpeg", headers=headers)


@router.post("/{id}/photo", response_model=CharacterDetail)
async def upload_photo(id: str, file: UploadFile = File(...)):
    """Upload a reference photo for a custom character."""
    try:
        row = await CharacterRepository().async_get_by_id(uuid.UUID(id))
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Character not found")

    # Validate file type
    if file.content_type not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(400, "Only PNG, JPEG, and WebP images are supported")

    # Save photo to character directory (UUID-based path)
    photo_dir = character_service._custom_char_dir(row.id)
    photo_dir.mkdir(parents=True, exist_ok=True)
    photo_path = photo_dir / "photo.png"

    # Convert to PNG via Pillow for consistency
    contents = await file.read()
    img = Image.open(io.BytesIO(contents))
    if img.mode != "RGB":
        img = img.convert("RGB")
    img.save(photo_path, format="PNG")

    # Upload to object storage
    await storage.upload_file(f".characters/{row.id}/photo.png", photo_path)

    # Update DB
    await CharacterRepository().async_set_photo_path(uuid.UUID(id), str(photo_path))

    return await character_service.get_character(id)


@router.get("/{id}/photo")
async def serve_photo(id: str, w: int | None = Query(None)):
    """Serve the reference photo for a custom character."""
    try:
        row = await CharacterRepository().async_get_by_id(uuid.UUID(id))
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Character not found")

    if not row.photo_path:
        raise HTTPException(404, "No photo uploaded")

    file_path = Path(row.photo_path)
    if not file_path.exists():
        key = f".characters/{row.id}/photo.png"
        found = await storage.ensure_local(key, file_path)
        if not found:
            raise HTTPException(404, "Photo file not found")

    headers = {"Cache-Control": "no-cache"}

    if w is None:
        return FileResponse(file_path, media_type="image/png", headers=headers)

    width = min(ALLOWED_WIDTHS, key=lambda x: abs(x - w))
    thumbs_dir = file_path.parent / ".thumbs"
    thumb_path = thumbs_dir / f"photo_w{width}.jpg"

    # Invalidate stale thumbnail (photo was re-uploaded after thumbnail was cached)
    if thumb_path.exists() and file_path.stat().st_mtime > thumb_path.stat().st_mtime:
        thumb_path.unlink()

    if not thumb_path.exists():
        thumbs_dir.mkdir(exist_ok=True)
        await asyncio.to_thread(generate_thumbnail, file_path, thumb_path, width)

    return FileResponse(thumb_path, media_type="image/jpeg", headers=headers)


@router.delete("/{id}/photo", status_code=204)
async def delete_photo(id: str):
    """Remove the reference photo from a custom character."""
    try:
        row = await CharacterRepository().async_get_by_id(uuid.UUID(id))
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Character not found")

    if row.photo_path:
        photo_file = Path(row.photo_path)
        if photo_file.exists():
            photo_file.unlink()
        # Clean up thumbnails
        thumbs_dir = photo_file.parent / ".thumbs"
        if thumbs_dir.exists():
            for f in thumbs_dir.glob("photo_w*"):
                f.unlink()
        # Remove from object storage
        await storage.delete_object(f".characters/{row.id}/photo.png")

    await CharacterRepository().async_set_photo_path(uuid.UUID(id), None)


@router.post("/{identifier}/generate-reference-sheet", response_model=TaskResponse)
async def generate_reference_sheet(identifier: str):
    """Start async generation of a character reference sheet.

    ``identifier`` can be a UUID (custom character) or a template slug.
    """
    # Determine the slug and pipeline identifier
    if _looks_like_uuid(identifier):
        try:
            row = await CharacterRepository().async_get_by_id(uuid.UUID(identifier))
        except (FileNotFoundError, ValueError):
            raise HTTPException(404, "Character not found")
        slug = row.slug
        pipeline_id = f"custom:{identifier}"
    else:
        # Template slug — validate it exists
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


@router.post("/{id}/refine-reference-sheet", response_model=TaskResponse)
async def refine_reference_sheet(
    id: str,
    photo: UploadFile | None = File(None),
    visual_constants: str | None = Form(None),
    color_palette: str | None = Form(None),
):
    """Regenerate a reference sheet with optional overrides (new photo, constants, palette).

    Overrides are used for generation only — the character record is NOT modified.
    The frontend persists accepted changes via the normal update/upload endpoints.
    """
    import json as _json

    if not _looks_like_uuid(id):
        raise HTTPException(400, "Refine is only available for custom characters")

    try:
        row = await CharacterRepository().async_get_by_id(uuid.UUID(id))
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Character not found")

    # Build overrides dict
    overrides: dict = {}
    if visual_constants is not None:
        overrides["visual_constants"] = visual_constants
    if color_palette is not None:
        try:
            overrides["color_palette"] = _json.loads(color_palette)
        except _json.JSONDecodeError:
            raise HTTPException(422, "color_palette must be a JSON array of strings")

    # Save temp photo if provided
    if photo:
        content = await photo.read()
        try:
            img = Image.open(io.BytesIO(content)).convert("RGB")
        except Exception:
            raise HTTPException(422, "Invalid image file")

        char_dir = Path("stories/.characters") / id
        char_dir.mkdir(parents=True, exist_ok=True)
        temp_path = char_dir / "photo_refine_temp.png"
        await asyncio.to_thread(img.save, temp_path, "PNG")
        overrides["temp_photo_path"] = str(temp_path)

    slug = row.slug
    pipeline_id = f"custom:{id}"

    task_id = task_manager.create_task(
        character_service.generate_character_reference_sheet,
        pipeline_id,
        slug,
        overrides=overrides,
        exclusive=True,
    )
    return TaskResponse(task_id=task_id)


# ---------------------------------------------------------------------------
# Family tree endpoints
# ---------------------------------------------------------------------------


@router.get("/{id}/family", response_model=list[FamilyMemberInfo])
async def list_family(id: str):
    """List all family members for a character."""
    try:
        return await character_service.get_family_tree(id)
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/{id}/family", response_model=FamilyMemberInfo, status_code=201)
async def add_family_member(id: str, req: AddFamilyMemberRequest):
    """Link an existing character as a family member."""
    try:
        return await character_service.add_family_member(id, req.member_id, req.relationship_label)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/{id}/family/create", response_model=FamilyMemberInfo, status_code=201)
async def create_and_link_family_member(id: str, req: CreateAndLinkFamilyMemberRequest):
    """Create a new character and link it as a family member."""
    try:
        return await character_service.create_and_link_family_member(
            id, req.character.model_dump(), req.relationship_label,
        )
    except Exception as e:
        raise HTTPException(400, str(e))


@router.put("/{id}/family/{link_id}", response_model=FamilyMemberInfo)
async def update_family_link(id: str, link_id: str, req: UpdateFamilyLinkRequest):
    """Update a family link's label or sort order."""
    data = {k: v for k, v in req.model_dump().items() if v is not None}
    try:
        return await character_service.update_family_link(link_id, data)
    except FileNotFoundError:
        raise HTTPException(404, "Family link not found")


@router.delete("/{id}/family/{link_id}", status_code=204)
async def remove_family_member(id: str, link_id: str):
    """Remove a family link."""
    await character_service.remove_family_member(link_id)


@router.put("/{id}/family/reorder", response_model=list[FamilyMemberInfo])
async def reorder_family(id: str, req: ReorderFamilyRequest):
    """Reorder family members."""
    return await character_service.reorder_family(id, req.ordered_member_ids)


def _looks_like_uuid(value: str) -> bool:
    """Check if a string looks like a UUID."""
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False
