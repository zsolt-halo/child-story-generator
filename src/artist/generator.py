import base64
import io
import logging
import os
import time
from pathlib import Path

from google import genai
from google.genai import types
from opentelemetry import trace
from PIL import Image
from rich.progress import Progress

from src.brain.prompts import _infer_species, get_anatomy_note
from src.models import BookConfig, CastMember, Character, Keyframe

logger = logging.getLogger(__name__)
tracer = trace.get_tracer("starlight.artist")


def _record_image_result(result: str, model: str) -> None:
    """Record image generation success/failure metric. No-op when telemetry is unavailable."""
    try:
        from server.telemetry import image_generation_results
        if image_generation_results:
            image_generation_results.add(1, {"result": result, "model": model})
    except ImportError:
        pass

RETRY_DELAY = 10.0
MAX_RETRIES = 5


def build_image_prompt(
    keyframe: Keyframe, character: Character, style_anchor: str, title: str = "",
    cast: list[CastMember] | None = None,
) -> str:
    parts = [
        keyframe.visual_description,
        f"Art style: {style_anchor}",
        f"Mood: {keyframe.mood}",
    ]
    if cast:
        relevant = [m for m in cast if keyframe.page_number in m.appears_on_pages]
        if relevant:
            cast_desc = "; ".join(
                f"{m.name}: {m.visual_description}, {m.visual_constants}"
                for m in relevant
            )
            parts.append(f"Secondary characters in this scene: {cast_desc}")
    if keyframe.is_cover and title:
        parts.append(
            f'This is a children\'s book cover. Include the title "{title}" as beautiful, '
            f"prominent hand-lettered text integrated into the composition. "
            f"The title should be clearly legible and styled to match the illustration."
        )
    else:
        parts.append("No text, no words, no letters in the image.")
    # Collect anatomy notes for animal species in the scene
    anatomy_notes: list[str] = []
    protagonist_species = _infer_species(character)
    proto_note = get_anatomy_note(protagonist_species)
    if proto_note:
        anatomy_notes.append(proto_note)
    if cast:
        relevant = [m for m in cast if keyframe.page_number in m.appears_on_pages]
        seen = {protagonist_species.lower()}
        for m in relevant:
            sp = m.species.lower() if m.species else ""
            if sp and sp not in seen:
                seen.add(sp)
                note = get_anatomy_note(sp)
                if note:
                    anatomy_notes.append(note)
    if anatomy_notes:
        parts.append("Anatomy: " + " ".join(anatomy_notes))
    parts.append("Square aspect ratio, high detail, children's book illustration.")
    return ". ".join(parts)


def create_image_client(config: BookConfig) -> genai.Client:
    api_key = config.gemini_api_key or os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set. Add it to .env or export it.")
    return genai.Client(api_key=api_key)


def _extract_image_bytes(response) -> bytes | None:
    """Extract image bytes from a Gemini generate_content response."""
    if not response.candidates or not response.candidates[0].content.parts:
        return None
    for part in response.candidates[0].content.parts:
        if hasattr(part, "inline_data") and part.inline_data:
            data = part.inline_data.data
            if isinstance(data, bytes):
                return data
            elif isinstance(data, str):
                return base64.b64decode(data)
    return None


def _generate_image(
    client: genai.Client,
    prompt: str,
    model: str,
    reference_image: bytes | None = None,
    additional_references: list[bytes] | None = None,
) -> bytes:
    """Generate image via Gemini generate_content API (supports multimodal reference input)."""
    has_refs = reference_image is not None or additional_references
    if has_refs:
        contents: list = []
        if reference_image is not None:
            contents.append(types.Part.from_bytes(data=reference_image, mime_type="image/png"))
        if additional_references:
            for ref in additional_references:
                contents.append(types.Part.from_bytes(data=ref, mime_type="image/png"))
        contents.append(prompt)
    else:
        contents = prompt

    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
        ),
    )
    image_bytes = _extract_image_bytes(response)
    if not image_bytes:
        raise RuntimeError("No image data in response")
    return image_bytes


def generate_single_image(
    client: genai.Client,
    prompt: str,
    model: str,
    output_path: Path,
    reference_image: bytes | None = None,
    additional_references: list[bytes] | None = None,
) -> Path:
    """Generate a single image via Gemini and save it to disk."""
    logger.debug("Generating image: %s (model=%s)", output_path.name, model)
    with tracer.start_as_current_span(
        "image.generate",
        attributes={"image.model": model, "image.output": output_path.name},
    ) as span:
        for attempt in range(MAX_RETRIES):
            try:
                image_bytes = _generate_image(
                    client, prompt, model,
                    reference_image=reference_image,
                    additional_references=additional_references,
                )

                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(image_bytes)
                span.set_attribute("image.size_kb", len(image_bytes) // 1024)
                logger.info("Image saved: %s (%d KB)", output_path.name, len(image_bytes) // 1024)
                _record_image_result("success", model)
                return output_path

            except Exception as e:
                span.add_event("retry", {"attempt": attempt + 1, "error": str(e)})
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_DELAY * (2 ** attempt)  # exponential backoff: 10, 20, 40, 80s
                    logger.warning(
                        "Image gen attempt %d/%d failed: %s — retrying in %.0fs",
                        attempt + 1, MAX_RETRIES, e, delay,
                    )
                    time.sleep(delay)
                else:
                    span.set_status(trace.StatusCode.ERROR, str(e))
                    span.record_exception(e)
                    _record_image_result("failure", model)
                    raise RuntimeError(f"Image generation failed after {MAX_RETRIES} attempts: {e}") from e

    raise RuntimeError("Unreachable")


def upscale_for_print(
    image_path: Path,
    output_path: Path,
    target_size: int = 2400,
) -> Path:
    """Upscale an image to print resolution using Pillow (2400px = 300 DPI at 8x8")."""
    img = Image.open(image_path)
    if img.mode != "RGB":
        img = img.convert("RGB")

    img = img.resize((target_size, target_size), Image.LANCZOS)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path, format="PNG")
    return output_path


def generate_reference_sheet(
    character: Character,
    style_anchor: str,
    config: BookConfig,
    output_dir: Path,
) -> Path | None:
    """Generate a character reference/model sheet for visual consistency.

    Returns the path to the saved reference sheet, or None if generation fails.
    Skips generation if the file already exists (resume-safe).
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    final_path = output_dir / "reference_sheet.png"

    if final_path.exists():
        logger.debug("Reference sheet already exists, skipping")
        return final_path

    species = _infer_species(character)
    anatomy_note = get_anatomy_note(species)
    prompt = (
        f"Character model sheet / reference sheet for a children's book character. "
        f"Show the character in multiple poses: front view, three-quarter view, side view, "
        f"plus 2-3 facial expressions (happy, surprised, thoughtful). "
        f"Clean white background, no other characters, no scenery. "
        f"Character: {character.visual.description}. "
        f"Visual constants: {character.visual.constants}. "
        f"Art style: {style_anchor}. "
        f"Professional character turnaround sheet for animation/illustration reference. "
        f"Square format."
    )
    if anatomy_note:
        prompt += f" {anatomy_note}"

    try:
        logger.info("Generating reference sheet for %s", character.name)
        client = create_image_client(config)
        raw_path = output_dir / "reference_sheet_raw.png"
        generate_single_image(client, prompt, config.image_model, raw_path)
        upscale_for_print(raw_path, final_path)
        return final_path
    except Exception:
        logger.warning("Reference sheet generation failed", exc_info=True)
        return None


def generate_cover_variations(
    keyframe: Keyframe,
    character: Character,
    style_anchor: str,
    config: BookConfig,
    output_dir: Path,
    title: str = "",
    cast: list[CastMember] | None = None,
    count: int = 4,
    reference_image: bytes | None = None,
) -> list[Path]:
    """Generate multiple cover art variations. Skips existing files (resume-safe)."""
    output_dir.mkdir(parents=True, exist_ok=True)
    prompt = build_image_prompt(keyframe, character, style_anchor, title=title, cast=cast)
    client = None
    paths: list[Path] = []

    for i in range(1, count + 1):
        final_path = output_dir / f"cover_v{i}.png"

        if final_path.exists():
            paths.append(final_path)
            continue

        if client is None:
            client = create_image_client(config)

        raw_path = output_dir / f"cover_v{i}_raw.png"
        generate_single_image(
            client, prompt, config.image_model, raw_path,
            reference_image=reference_image,
        )
        upscale_for_print(raw_path, final_path)
        paths.append(final_path)

        if i < count:
            time.sleep(5.0)

    return paths


def load_reference_sheet(images_dir: Path) -> bytes | None:
    """Load reference sheet bytes if the file exists, else None."""
    ref_path = images_dir / "reference_sheet.png"
    if ref_path.exists():
        return ref_path.read_bytes()
    return None


def generate_cast_reference_sheet(
    member: CastMember,
    style_anchor: str,
    config: BookConfig,
    output_dir: Path,
) -> Path | None:
    """Generate a reference/model sheet for a secondary cast member.

    Returns the path to the saved reference sheet, or None if generation fails.
    Skips generation if the file already exists (resume-safe).
    """
    from src.utils.io import slugify

    output_dir.mkdir(parents=True, exist_ok=True)
    name_slug = slugify(member.name)
    final_path = output_dir / f"ref_{name_slug}.png"

    if final_path.exists():
        logger.debug("Cast ref sheet for %s already exists, skipping", member.name)
        return final_path

    member_species = member.species.lower() if member.species else ""
    anatomy_note = get_anatomy_note(member_species)
    prompt = (
        f"Character model sheet / reference sheet for a children's book character. "
        f"Show the character in multiple poses: front view, three-quarter view, side view, "
        f"plus 2-3 facial expressions (happy, surprised, thoughtful). "
        f"Clean white background, no other characters, no scenery. "
        f"Character: {member.visual_description}. "
        f"Visual constants: {member.visual_constants}. "
        f"Art style: {style_anchor}. "
        f"Professional character turnaround sheet for animation/illustration reference. "
        f"Square format."
    )
    if anatomy_note:
        prompt += f" {anatomy_note}"

    try:
        logger.info("Generating cast reference sheet for %s", member.name)
        client = create_image_client(config)
        raw_path = output_dir / f"ref_{name_slug}_raw.png"
        generate_single_image(client, prompt, config.image_model, raw_path)
        upscale_for_print(raw_path, final_path)
        return final_path
    except Exception:
        logger.warning("Cast ref sheet generation failed for %s", member.name, exc_info=True)
        return None


def load_cast_reference_sheets(images_dir: Path, cast: list[CastMember]) -> dict[str, bytes]:
    """Load reference sheet bytes for each cast member that has one on disk.

    Returns {slugified_name: png_bytes}.
    """
    from src.utils.io import slugify

    result: dict[str, bytes] = {}
    for member in cast:
        name_slug = slugify(member.name)
        ref_path = images_dir / f"ref_{name_slug}.png"
        if ref_path.exists():
            result[name_slug] = ref_path.read_bytes()
    return result


def generate_all_illustrations(
    keyframes: list[Keyframe],
    character: Character,
    config: BookConfig,
    style_anchor: str,
    output_dir: Path,
    progress: Progress | None = None,
    title: str = "",
    cast: list[CastMember] | None = None,
    reference_image: bytes | None = None,
    cast_ref_map: dict[str, bytes] | None = None,
) -> list[Path]:
    """Generate illustrations for all keyframes. Skips images that already exist."""
    from src.utils.io import slugify as _slugify

    output_dir.mkdir(parents=True, exist_ok=True)

    task_id = None
    if progress:
        task_id = progress.add_task("Generating illustrations", total=len(keyframes))

    paths: list[Path] = []
    client = None  # Lazy init — only create if we need to generate

    for kf in keyframes:
        final_path = output_dir / f"{kf.image_prefix}.png"

        if final_path.exists():
            # Skip already-generated images
            if progress and task_id is not None:
                progress.advance(task_id)
            paths.append(final_path)
            continue

        if client is None:
            client = create_image_client(config)

        # Collect per-page cast reference images for members appearing on this page
        additional_refs: list[bytes] = []
        if cast_ref_map and cast:
            for m in cast:
                if kf.page_number in m.appears_on_pages:
                    member_slug = _slugify(m.name)
                    if member_slug in cast_ref_map:
                        additional_refs.append(cast_ref_map[member_slug])

        prompt = build_image_prompt(kf, character, style_anchor, title=title, cast=cast)

        raw_path = output_dir / f"{kf.image_prefix}_raw.png"
        generate_single_image(
            client, prompt, config.image_model, raw_path,
            reference_image=reference_image,
            additional_references=additional_refs if additional_refs else None,
        )

        upscale_for_print(raw_path, final_path)

        if progress and task_id is not None:
            progress.advance(task_id)

        paths.append(final_path)

        # Rate limit delay between images
        if kf != keyframes[-1]:
            time.sleep(5.0)

    return paths


