import logging

from src.brain.client import generate_text
from src.brain.prompts import build_storyteller_system_prompt, build_premise_prompt
from src.models import BookConfig, Character

logger = logging.getLogger(__name__)


def generate_story(notes: str, character: Character, config: BookConfig, style_desc: str) -> tuple[str, str]:
    """Generate an expanded story from raw notes. Returns (title, prose)."""
    logger.info("Generating story for %s (%d-page, narrator=%s)", character.child_name, config.pages, config.narrator)
    system_prompt = build_storyteller_system_prompt(
        character=character,
        narrator=config.narrator,
        style_desc=style_desc,
    )

    user_prompt = (
        f"Here are today's notes about {character.child_name}:\n\n"
        f"{notes}\n\n"
        f"Write a {config.pages}-page picture book story based on these notes. "
        f"Start with the title on its own line, then a blank line, then the story prose."
    )

    text = generate_text(config, system_prompt, user_prompt, max_tokens=8192)

    lines = text.strip().split("\n", 1)
    title = lines[0].strip().strip("#").strip().strip('"').strip("*").strip()
    prose = lines[1].strip() if len(lines) > 1 else ""

    logger.info("Story generated: '%s' (%d words)", title, len(prose.split()))
    return title, prose


def generate_premise(character: Character, config: BookConfig) -> str:
    """Generate synthetic parent notes for the Surprise Me mode."""
    logger.info("Generating premise for %s (%d-page)", character.child_name, config.pages)
    system_prompt = build_premise_prompt(character)
    user_prompt = (
        f"Write today's notes about {character.child_name} "
        f"for a {config.pages}-page picture book story."
    )
    # max_tokens must be high enough for Gemini 2.5's thinking budget + output
    for attempt in range(2):
        notes = generate_text(config, system_prompt, user_prompt, max_tokens=4096)
        if notes.strip():
            break
        if attempt == 0:
            logger.warning("Premise was empty, retrying...")
    if not notes.strip():
        raise RuntimeError("Gemini returned empty premise after 2 attempts")
    logger.info("Premise generated: %d words", len(notes.split()))
    return notes.strip()
