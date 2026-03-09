from fastapi import APIRouter, HTTPException

from server.schemas import (
    CharacterDetail,
    CharacterCreateRequest,
    CharacterUpdateRequest,
    CharacterPolishRequest,
    CharacterPolishResponse,
)
from server.services import character_service

router = APIRouter(prefix="/api/characters", tags=["characters"])


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
