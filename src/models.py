from pathlib import Path

from pydantic import BaseModel, Field


class CharacterPersonality(BaseModel):
    traits: list[str]
    speech_style: str


class CharacterVisual(BaseModel):
    description: str
    constants: str
    color_palette: list[str] = Field(default_factory=list)


class CharacterStoryRules(BaseModel):
    always: str
    never: str


class Character(BaseModel):
    name: str
    child_name: str
    personality: CharacterPersonality
    visual: CharacterVisual
    story_rules: CharacterStoryRules


class Keyframe(BaseModel):
    page_number: int
    page_text: str
    visual_description: str
    mood: str
    is_cover: bool = False
    page_text_translated: str | None = None


class Story(BaseModel):
    title: str
    dedication: str = ""
    keyframes: list[Keyframe]
    title_translated: str | None = None
    dedication_translated: str | None = None


class BookConfig(BaseModel):
    character: str = "lana-llama"
    narrator: str = "whimsical"
    style: str = "digital"
    pages: int = 16
    language: str = ""
    output: Path = Path("stories")
    text_model: str = "gemini-2.5-pro"
    image_model: str = "gemini-2.5-flash-image"
    gemini_api_key: str = ""
    gateway_base_url: str = ""
    gateway_api_key: str = ""
