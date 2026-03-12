from fastapi import APIRouter, HTTPException

from server.schemas import PresetDetail, PresetCreateRequest, PresetUpdateRequest
from server.services import preset_service

router = APIRouter(prefix="/api/presets", tags=["presets"])


@router.get("/", response_model=list[PresetDetail])
async def list_presets():
    return await preset_service.list_presets()


@router.get("/{preset_id}", response_model=PresetDetail)
async def get_preset(preset_id: str):
    preset = await preset_service.get_preset(preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail="Preset not found")
    return preset


@router.post("/", response_model=PresetDetail, status_code=201)
async def create_preset(req: PresetCreateRequest):
    return await preset_service.create_preset(
        name=req.name,
        character=req.character,
        narrator=req.narrator,
        style=req.style,
        pages=req.pages,
        language=req.language,
        text_model=req.text_model,
        is_default=req.is_default,
    )


@router.put("/{preset_id}", response_model=PresetDetail)
async def update_preset(preset_id: str, req: PresetUpdateRequest):
    try:
        updates = req.model_dump(exclude_none=True)
        return await preset_service.update_preset(preset_id, **updates)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Preset not found")


@router.delete("/{preset_id}", status_code=204)
async def delete_preset(preset_id: str):
    try:
        await preset_service.delete_preset(preset_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Preset not found")
