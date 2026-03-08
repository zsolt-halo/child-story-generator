from src.brain.client import create_client, resolve_model
from src.brain.prompts import build_keyframer_system_prompt
from src.models import BookConfig, Character, Story


def generate_keyframes(title: str, prose: str, character: Character, config: BookConfig, style_desc: str) -> Story:
    """Break a story into illustrated page keyframes using structured output."""
    client = create_client(config)
    model = resolve_model(config)

    system_prompt = build_keyframer_system_prompt(
        character=character,
        style_desc=style_desc,
    )

    parsed = client.messages.parse(
        model=model,
        max_tokens=16384,
        output_format=Story,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[
            {
                "role": "user",
                "content": (
                    f"# Story Title: {title}\n\n"
                    f"{prose}\n\n"
                    f"---\n"
                    f"Split this story into exactly {config.pages} pages (keyframes). "
                    f"Set the title to \"{title}\" and optionally add a short dedication for {character.child_name}."
                ),
            }
        ],
    )

    return parsed.parsed_output
