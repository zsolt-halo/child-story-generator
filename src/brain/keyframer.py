from src.brain.client import generate_structured
from src.brain.prompts import build_keyframer_system_prompt
from src.models import BookConfig, Character, Story


def generate_keyframes(title: str, prose: str, character: Character, config: BookConfig, style_desc: str) -> Story:
    """Break a story into illustrated page keyframes using structured output."""
    system_prompt = build_keyframer_system_prompt(
        character=character,
        style_desc=style_desc,
    )

    user_prompt = (
        f"# Story Title: {title}\n\n"
        f"{prose}\n\n"
        f"---\n"
        f"Split this story into exactly {config.pages} pages (keyframes). "
        f'Set the title to "{title}" and optionally add a short dedication for {character.child_name}.'
    )

    return generate_structured(config, system_prompt, user_prompt, schema=Story, max_tokens=16384)
