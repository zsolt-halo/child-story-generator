import logging
import uuid
import tomllib
from pathlib import Path

from src.models import BookConfig, Character, CharacterPersonality, CharacterStoryRules, CharacterVisual

logger = logging.getLogger(__name__)

CONFIGS_DIR = Path(__file__).parent.parent.parent / "configs"
CHARACTERS_DIR = CONFIGS_DIR / "characters"


def load_settings() -> dict:
    settings_path = CONFIGS_DIR / "settings.toml"
    if not settings_path.exists():
        return {}
    with open(settings_path, "rb") as f:
        return tomllib.load(f)


def load_character(name: str) -> Character:
    path = CHARACTERS_DIR / f"{name}.toml"
    if not path.exists():
        raise FileNotFoundError(f"Character config not found: {path}")
    with open(path, "rb") as f:
        data = tomllib.load(f)

    c = data["character"]
    return Character(
        name=c["name"],
        child_name=c["child_name"],
        personality=CharacterPersonality(**c["personality"]),
        visual=CharacterVisual(**c["visual"]),
        story_rules=CharacterStoryRules(**c["story_rules"]),
    )


def load_style(name: str) -> dict:
    styles_path = CONFIGS_DIR / "styles.toml"
    if not styles_path.exists():
        raise FileNotFoundError(f"Styles config not found: {styles_path}")
    with open(styles_path, "rb") as f:
        data = tomllib.load(f)
    if name not in data:
        raise ValueError(f"Unknown style '{name}'. Available: {list(data.keys())}")
    return data[name]


def build_config(**overrides) -> BookConfig:
    settings = load_settings()
    defaults = settings.get("defaults", {})
    merged = {**defaults, **{k: v for k, v in overrides.items() if v is not None}}
    return BookConfig(**merged)


def resolve_character(identifier: str) -> Character:
    """Resolve a character from either DB (custom:<uuid>) or TOML config.

    If *identifier* starts with ``custom:``, the trailing UUID is used to look
    up the character from the database via ``CharacterRepository`` (sync).
    Otherwise the identifier is treated as a TOML config name and passed to
    ``load_character``.
    """
    if identifier.startswith("custom:"):
        char_id = uuid.UUID(identifier.removeprefix("custom:"))
        from src.db.character_repository import CharacterRepository
        char = CharacterRepository().get_by_id(char_id)
        logger.debug("Resolved character %s → %s (DB)", identifier, char.name)
        return char
    char = load_character(identifier)
    logger.debug("Resolved character %s → %s (TOML)", identifier, char.name)
    return char


async def async_resolve_character(identifier: str) -> Character:
    """Async version of :func:`resolve_character` for server use.

    If *identifier* starts with ``custom:``, the trailing UUID is used to look
    up the character from the database via ``CharacterRepository`` (async).
    Otherwise the identifier is treated as a TOML config name and passed to
    ``load_character``.
    """
    if identifier.startswith("custom:"):
        char_id = uuid.UUID(identifier.removeprefix("custom:"))
        from src.db.character_repository import CharacterRepository, _row_to_character
        row = await CharacterRepository().async_get_by_id(char_id)
        char = _row_to_character(row)
        logger.debug("Resolved character %s → %s (DB async)", identifier, char.name)
        return char
    char = load_character(identifier)
    logger.debug("Resolved character %s → %s (TOML)", identifier, char.name)
    return char
