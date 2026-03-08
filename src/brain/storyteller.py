from src.brain.client import create_client, resolve_model
from src.brain.prompts import build_storyteller_system_prompt
from src.models import BookConfig, Character


def generate_story(notes: str, character: Character, config: BookConfig, style_desc: str) -> tuple[str, str]:
    """Generate an expanded story from raw notes. Returns (title, prose)."""
    client = create_client(config)
    model = resolve_model(config)

    system_prompt = build_storyteller_system_prompt(
        character=character,
        narrator=config.narrator,
        style_desc=style_desc,
    )

    response = client.messages.create(
        model=model,
        max_tokens=8192,
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
                    f"Here are today's notes about {character.child_name}:\n\n"
                    f"{notes}\n\n"
                    f"Write a {config.pages}-page picture book story based on these notes. "
                    f"Start with the title on its own line, then a blank line, then the story prose."
                ),
            }
        ],
    )

    text = response.content[0].text
    lines = text.strip().split("\n", 1)
    title = lines[0].strip().strip("#").strip().strip('"').strip("*").strip()
    prose = lines[1].strip() if len(lines) > 1 else ""

    return title, prose
