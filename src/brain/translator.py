import logging
import re

from src.brain.client import generate_text
from src.brain.prompts import build_translator_system_prompt
from src.models import BookConfig, Story

logger = logging.getLogger(__name__)


def translate_story(story: Story, language: str, config: BookConfig) -> Story:
    """Translate all story text into the target language using Gemini."""
    logger.info("Translating '%s' to %s (%d pages)", story.title, language, len(story.keyframes))
    # Build the full story text for context
    pages_text = "\n\n".join(
        f"===PAGE {kf.page_number}===\n{kf.page_text}"
        for kf in story.keyframes
    )

    user_prompt = f"""Here is the English picture book to retell in {language}.
You MUST retell ALL {len(story.keyframes)} pages — every single one.

===TITLE===
{story.title}
===DEDICATION===
{story.dedication}
{pages_text}"""

    system_prompt = build_translator_system_prompt(language, config.narrator)
    raw = generate_text(config, system_prompt, user_prompt, max_tokens=16384)
    raw = raw.strip()

    # Parse the delimited output
    title_match = re.search(r'===TITLE===\s*\n(.+?)(?=\n===)', raw, re.DOTALL)
    ded_match = re.search(r'===DEDICATION===\s*\n(.+?)(?=\n===)', raw, re.DOTALL)

    if title_match:
        story.title_translated = title_match.group(1).strip()
    if ded_match:
        story.dedication_translated = ded_match.group(1).strip()

    # Extract all page translations
    page_translations = re.findall(
        r'===PAGE\s+(\d+)===\s*\n(.+?)(?=\n===PAGE|\Z)', raw, re.DOTALL
    )

    page_map = {int(num): text.strip() for num, text in page_translations}

    translated_count = 0
    for kf in story.keyframes:
        if kf.page_number in page_map:
            kf.page_text_translated = page_map[kf.page_number]
            translated_count += 1

    if translated_count < len(story.keyframes):
        missing = [kf.page_number for kf in story.keyframes if kf.page_number not in page_map]
        raise RuntimeError(
            f"Translation incomplete: only {translated_count}/{len(story.keyframes)} pages translated. "
            f"Missing pages: {missing}"
        )

    logger.info("Translation complete: '%s' → '%s'", story.title, story.title_translated)
    return story
