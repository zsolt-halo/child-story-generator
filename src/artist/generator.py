import base64
import io
import os
import time
from pathlib import Path

from google import genai
from google.genai import types
from PIL import Image
from rich.progress import Progress

from src.models import BookConfig, CastMember, Character, Keyframe

RETRY_DELAY = 5.0
MAX_RETRIES = 2


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


def generate_single_image(
    client: genai.Client,
    prompt: str,
    model: str,
    output_path: Path,
) -> Path:
    """Generate a single image via Gemini and save it to disk."""
    for attempt in range(MAX_RETRIES):
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"],
                ),
            )

            image_bytes = _extract_image_bytes(response)
            if not image_bytes:
                raise RuntimeError("No image data in response")

            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(image_bytes)
            return output_path

        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY * (attempt + 1))
            else:
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


def generate_all_illustrations(
    keyframes: list[Keyframe],
    character: Character,
    config: BookConfig,
    style_anchor: str,
    output_dir: Path,
    progress: Progress | None = None,
    title: str = "",
    cast: list[CastMember] | None = None,
) -> list[Path]:
    """Generate illustrations for all keyframes. Skips images that already exist."""
    output_dir.mkdir(parents=True, exist_ok=True)

    task_id = None
    if progress:
        task_id = progress.add_task("Generating illustrations", total=len(keyframes))

    paths: list[Path] = []
    client = None  # Lazy init — only create if we need to generate

    for kf in keyframes:
        prefix = "cover" if kf.is_cover else f"page_{kf.page_number:02d}"
        final_path = output_dir / f"{prefix}.png"

        if final_path.exists():
            # Skip already-generated images
            if progress and task_id is not None:
                progress.advance(task_id)
            paths.append(final_path)
            continue

        if client is None:
            client = create_image_client(config)

        prompt = build_image_prompt(kf, character, style_anchor, title=title, cast=cast)

        raw_path = output_dir / f"{prefix}_raw.png"
        generate_single_image(client, prompt, config.image_model, raw_path)

        upscale_for_print(raw_path, final_path)

        if progress and task_id is not None:
            progress.advance(task_id)

        paths.append(final_path)

        # Rate limit delay between images
        if kf != keyframes[-1]:
            time.sleep(2.0)

    return paths


_BACKDROP_PROMPTS = [
    "Soft decorative page background for a children's book. {style}. "
    "Abstract gentle border ornaments with tiny leaves and stars around the edges, "
    "fading to a clean light cream center. No text, no characters, no animals. "
    "Very subtle and delicate. Square format.",

    "Delicate ornamental page border for a children's book. {style}. "
    "Soft swirling floral patterns at the corners and edges, light and airy center area. "
    "No text, no characters, no animals. Pastel tones. Square format.",

    "Whimsical decorative frame for a children's book page. {style}. "
    "Tiny scattered stars, clouds, and leaves creating a gentle border. "
    "Warm soft center. No text, no characters, no animals. Very subtle. Square format.",

    "Gentle watercolor wash background for a children's book. {style}. "
    "Soft gradient from warm edges to bright center with delicate vine ornaments in corners. "
    "No text, no characters, no animals. Square format.",
]


def generate_backdrops(
    config: BookConfig,
    style_anchor: str,
    output_dir: Path,
    count: int = 4,
    progress: Progress | None = None,
) -> list[Path]:
    """Generate decorative backdrop images for text pages."""
    output_dir.mkdir(parents=True, exist_ok=True)

    task_id = None
    if progress:
        task_id = progress.add_task("Generating backdrops", total=count)

    client = None
    paths: list[Path] = []

    for i in range(min(count, len(_BACKDROP_PROMPTS))):
        final_path = output_dir / f"backdrop_{i + 1:02d}.png"

        if final_path.exists():
            if progress and task_id is not None:
                progress.advance(task_id)
            paths.append(final_path)
            continue

        if client is None:
            client = create_image_client(config)

        prompt = _BACKDROP_PROMPTS[i].format(style=style_anchor)
        raw_path = output_dir / f"backdrop_{i + 1:02d}_raw.png"
        generate_single_image(client, prompt, config.image_model, raw_path)
        upscale_for_print(raw_path, final_path)

        if progress and task_id is not None:
            progress.advance(task_id)
        paths.append(final_path)

        if i < count - 1:
            time.sleep(2.0)

    return paths
