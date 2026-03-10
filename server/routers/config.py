from fastapi import APIRouter, HTTPException

from src.utils.config import CHARACTERS_DIR, load_character, load_style
from src.brain.prompts import NARRATOR_PERSONAS
from server.schemas import CharacterInfo, StyleInfo, NarratorInfo

router = APIRouter(prefix="/api/config", tags=["config"])


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
    from src.utils.config import CONFIGS_DIR

    styles_path = CONFIGS_DIR / "styles.toml"
    if not styles_path.exists():
        return []

    with open(styles_path, "rb") as f:
        data = tomllib.load(f)

    return [
        StyleInfo(name=name, description=style["description"])
        for name, style in data.items()
    ]


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
