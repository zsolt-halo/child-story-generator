import logging

from src.brain.client import generate_text
from src.brain.prompts import build_storyteller_system_prompt
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
