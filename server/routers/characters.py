import asyncio
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

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
    file_path = character_service._template_char_dir(slug) / "reference_sheet.png"
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

    file_path = character_service._custom_char_dir(row.id) / "reference_sheet.png"
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


@router.post("/{id}/photo", response_model=CharacterDetail)
async def upload_photo(id: str, file: UploadFile = File(...)):
    """Upload a reference photo for a custom character."""
    from src.db.character_repository import CharacterRepository

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
    from PIL import Image
    import io
    contents = await file.read()
    img = Image.open(io.BytesIO(contents))
    if img.mode != "RGB":
        img = img.convert("RGB")
    img.save(photo_path, format="PNG")

    # Update DB
    await CharacterRepository().async_set_photo_path(uuid.UUID(id), str(photo_path))

    return await character_service.get_character(id)


@router.get("/{id}/photo")
async def serve_photo(id: str, w: int | None = Query(None)):
    """Serve the reference photo for a custom character."""
    from src.db.character_repository import CharacterRepository

    try:
        row = await CharacterRepository().async_get_by_id(uuid.UUID(id))
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Character not found")

    if not row.photo_path:
        raise HTTPException(404, "No photo uploaded")

    file_path = Path(row.photo_path)
    if not file_path.exists():
        raise HTTPException(404, "Photo file not found")

    if w is None:
        return FileResponse(file_path, media_type="image/png")

    width = min(ALLOWED_WIDTHS, key=lambda x: abs(x - w))
    thumbs_dir = file_path.parent / ".thumbs"
    thumb_path = thumbs_dir / f"photo_w{width}.jpg"

    if not thumb_path.exists():
        thumbs_dir.mkdir(exist_ok=True)
        await asyncio.to_thread(_generate_thumbnail, file_path, thumb_path, width)

    return FileResponse(thumb_path, media_type="image/jpeg")


@router.delete("/{id}/photo", status_code=204)
async def delete_photo(id: str):
    """Remove the reference photo from a custom character."""
    from src.db.character_repository import CharacterRepository

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

    await CharacterRepository().async_set_photo_path(uuid.UUID(id), None)


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
