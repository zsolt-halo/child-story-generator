import re

from pydantic import BaseModel

from src.brain.client import generate_structured, generate_text
from src.brain.prompts import build_cast_extraction_prompt, build_cast_rewrite_prompt
from src.models import BookConfig, CastMember, Character, Story


class CastList(BaseModel):
    members: list[CastMember]


def extract_cast(story: Story, character: Character, config: BookConfig) -> Story:
    """Phase 2.5: Extract secondary character cast and rewrite keyframe visual descriptions.

    Step 1: Identify all secondary characters with consistent visual descriptions.
    Step 2: Rewrite each keyframe's visual_description to embed canonical cast visuals.
    """
    # Step 1: Extract cast via structured output
    system_prompt = build_cast_extraction_prompt(character)

    keyframes_text = "\n\n".join(
        f"Page {kf.page_number}{' (COVER)' if kf.is_cover else ''}:\n"
        f"Text: {kf.page_text}\n"
        f"Visual description: {kf.visual_description}"
        for kf in story.keyframes
    )

    user_prompt = (
        f"# Story: {story.title}\n\n"
        f"## Full Story by Page\n{keyframes_text}\n\n"
        f"---\n"
        f"Identify ALL secondary characters in this story and create their visual cast sheet."
    )

    cast_list = generate_structured(config, system_prompt, user_prompt, schema=CastList)

    # Filter out any entry that matches the protagonist name
    protagonist_name = character.name.lower()
    members = [
        m for m in cast_list.members
        if m.name.lower() != protagonist_name
    ]

    story.cast = members

    if not members:
        return story

    # Step 2: Rewrite keyframe visual descriptions with canonical cast info
    rewrite_prompt = build_cast_rewrite_prompt(character)

    # Build the cast sheet section
    cast_sheet = "\n".join(
        f"- **{m.name}** ({m.role}, {m.species}): {m.visual_description}. "
        f"Visual constants: {m.visual_constants}. Pages: {m.appears_on_pages}"
        for m in members
    )

    # Build keyframes with per-page cast annotations
    pages_section = []
    for kf in story.keyframes:
        relevant = [m for m in members if kf.page_number in m.appears_on_pages]
        cast_note = ""
        if relevant:
            cast_note = "\nCast on this page: " + ", ".join(
                f"{m.name} ({m.visual_constants})" for m in relevant
            )
        pages_section.append(
            f"===PAGE {kf.page_number}===\n"
            f"{kf.visual_description}{cast_note}"
        )

    rewrite_user_prompt = (
        f"## Cast Sheet\n{cast_sheet}\n\n"
        f"## Current Visual Descriptions\n" + "\n\n".join(pages_section) + "\n\n"
        f"---\n"
        f"Rewrite ALL {len(story.keyframes)} visual descriptions with consistent cast visuals."
    )

    raw = generate_text(config, rewrite_prompt, rewrite_user_prompt, max_tokens=16384)

    # Parse delimiter-based output
    page_rewrites = re.findall(
        r'===PAGE\s+(\d+)===\s*\n(.+?)(?=\n===PAGE|\Z)', raw.strip(), re.DOTALL
    )

    rewrite_map = {int(num): text.strip() for num, text in page_rewrites}

    for kf in story.keyframes:
        if kf.page_number in rewrite_map:
            kf.visual_description = rewrite_map[kf.page_number]

    return story
