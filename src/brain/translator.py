import re

from src.brain.client import generate_text
from src.models import BookConfig, Story

_SYSTEM_PROMPT = """\
You are an expert literary translator specializing in children's picture books.
You translate with warmth, rhythm, and playfulness — preserving the tone, humor,
sound effects, and emotional beats of the original.

Rules:
- Translate ALL text faithfully — do not add, remove, or summarize content.
- Preserve made-up words and sound effects by creating equivalent ones in the target
  language (e.g. "floomph" → a similarly playful onomatopoeia).
- Keep proper names (character names, place names) unless there is a natural
  equivalent that sounds better in the target language. Use your judgment.
- Maintain the reading rhythm — a children's book is read aloud, so the
  translation must flow naturally when spoken.
- Match the approximate length of each page text (the text must fit the same
  layout space as the original).

Output format — use EXACTLY this structure:

===TITLE===
translated title here
===DEDICATION===
translated dedication here
===PAGE 1===
translated page 1 text here
===PAGE 2===
translated page 2 text here
...and so on for EVERY page.

IMPORTANT: You MUST translate EVERY page. Do not skip or leave any page in English."""


def translate_story(story: Story, language: str, config: BookConfig) -> Story:
    """Translate all story text into the target language using Gemini."""
    # Build the full story text for context
    pages_text = "\n\n".join(
        f"===PAGE {kf.page_number}===\n{kf.page_text}"
        for kf in story.keyframes
    )

    user_prompt = f"""Translate this entire children's picture book into {language}.
You MUST translate ALL {len(story.keyframes)} pages — every single one.

===TITLE===
{story.title}
===DEDICATION===
{story.dedication}
{pages_text}"""

    raw = generate_text(config, _SYSTEM_PROMPT, user_prompt, max_tokens=16384)
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

    return story
