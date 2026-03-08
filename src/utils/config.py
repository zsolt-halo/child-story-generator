import tomllib
from pathlib import Path

from src.models import BookConfig, Character, CharacterPersonality, CharacterStoryRules, CharacterVisual

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
