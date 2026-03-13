"""Proof-of-concept: animate a single illustration via Google Veo.

Tests video generation quality by taking an existing page illustration
and producing a short animated clip using the Veo API.

Usage:
    # From an image file directly
    uv run python scripts/animate_poc.py --image stories/my-story/images/page_01.png

    # From a story slug + page number (loads image path from DB)
    uv run python scripts/animate_poc.py --slug my-story --page 1

    # With options
    uv run python scripts/animate_poc.py --image page.png --model veo-3.0-fast-generate-001
    uv run python scripts/animate_poc.py --image page.png --duration 8 --output clip.mp4
    uv run python scripts/animate_poc.py --image page.png --prompt "Camera slowly zooms in..."
"""

import argparse
import os
import sys
import time
from pathlib import Path

# Ensure project root is on sys.path when run as a script
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv()

from google import genai
from google.genai import types

DEFAULT_MODEL = "veo-3.1-fast-generate-preview"
DEFAULT_DURATION = 8
POLL_INTERVAL = 20  # seconds between status checks

DEFAULT_PROMPT = (
    "Gently animate this children's book illustration. "
    "Subtle movement only: character breathing, blinking, slight wind in hair and clothes, "
    "floating particles. Keep the painterly children's book art style. No camera movement."
)

# Veo pricing estimates (USD per second of generated video)
COST_PER_SECOND = {
    "veo-3.1-generate-preview": 0.40,
    "veo-3.1-fast-generate-preview": 0.15,
    "veo-3.0-generate-001": 0.40,
    "veo-3.0-fast-generate-001": 0.15,
    "veo-2.0-generate-001": 0.35,
}


def resolve_image_path(slug: str, page: int) -> Path:
    """Look up the illustration path for a story page from the DB."""
    from src.db.repository import StoryRepository, STORIES_DIR

    repo = StoryRepository()
    story, image_paths = repo.get(slug)

    # Find the matching keyframe
    target_prefix = "cover" if page == 0 else f"page_{page:02d}"
    for p in image_paths:
        if p.stem == target_prefix:
            return p

    # Fallback: construct expected path
    expected = STORIES_DIR / slug / "images" / f"{target_prefix}.png"
    if expected.exists():
        return expected

    raise FileNotFoundError(
        f"No illustration found for page {page} of '{slug}'. "
        f"Expected: {expected}"
    )


def get_keyframe_text(slug: str, page: int) -> str | None:
    """Load the page text for a specific keyframe from the DB."""
    from src.db.repository import StoryRepository

    repo = StoryRepository()
    story, _ = repo.get(slug)

    for kf in story.keyframes:
        if kf.page_number == page or (page == 0 and kf.is_cover):
            return kf.page_text
    return None


def animate(
    image_path: Path,
    model: str,
    duration: int,
    prompt: str,
    output_path: Path,
) -> None:
    """Generate an animated video clip from a single illustration."""
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        print("Error: GEMINI_API_KEY not set. Add it to .env or export it.")
        sys.exit(1)

    if not image_path.exists():
        print(f"Error: Image not found: {image_path}")
        sys.exit(1)

    client = genai.Client(api_key=api_key)
    image = types.Image.from_file(location=str(image_path))

    print(f"  Model:    {model}")
    print(f"  Duration: {duration}s")
    print(f"  Image:    {image_path} ({image_path.stat().st_size // 1024} KB)")
    print(f"  Output:   {output_path}")
    print(f"  Prompt:   {prompt[:80]}{'...' if len(prompt) > 80 else ''}")
    print()

    # Submit video generation (async operation)
    print("Submitting video generation request...")
    t0 = time.monotonic()

    operation = client.models.generate_videos(
        model=model,
        prompt=prompt,
        image=image,
        config=types.GenerateVideosConfig(
            number_of_videos=1,
            duration_seconds=duration,
            # Veo only supports 16:9 and 9:16; omit to let API decide from input
        ),
    )

    # Poll until done
    polls = 0
    while not operation.done:
        polls += 1
        elapsed = time.monotonic() - t0
        print(f"  Waiting... ({elapsed:.0f}s elapsed, poll #{polls})", end="\r")
        time.sleep(POLL_INTERVAL)
        operation = client.operations.get(operation)

    elapsed = time.monotonic() - t0
    print(f"\nGeneration complete in {elapsed:.1f}s")

    # Check for errors
    if not operation.response or not operation.response.generated_videos:
        print("Error: No video was generated.")
        if hasattr(operation, "error") and operation.error:
            print(f"  API error: {operation.error}")
        sys.exit(1)

    # Save the video
    video = operation.response.generated_videos[0]
    client.files.download(file=video.video)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    video.video.save(str(output_path))

    file_size = output_path.stat().st_size
    cost_rate = COST_PER_SECOND.get(model, 0)
    est_cost = cost_rate * duration

    print()
    print(f"  Saved:    {output_path} ({file_size / 1024 / 1024:.1f} MB)")
    print(f"  Duration: {duration}s")
    print(f"  Time:     {elapsed:.1f}s (generation + polling)")
    if cost_rate:
        print(f"  Est cost: ${est_cost:.2f} ({duration}s x ${cost_rate}/s)")
    else:
        print(f"  Est cost: unknown (model '{model}' not in pricing table)")
    print()
    print("Done! Play the video to evaluate quality.")


def main():
    parser = argparse.ArgumentParser(
        description="Animate a children's book illustration using Google Veo",
    )

    # Input source (mutually exclusive)
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument(
        "--image", type=Path,
        help="Path to an illustration image file",
    )
    input_group.add_argument(
        "--slug", type=str,
        help="Story slug to load from DB (requires --page)",
    )

    parser.add_argument(
        "--page", type=int, default=1,
        help="Page number to animate when using --slug (0=cover, default: 1)",
    )
    parser.add_argument(
        "--model", type=str, default=DEFAULT_MODEL,
        help=f"Veo model to use (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--duration", type=int, default=DEFAULT_DURATION, choices=[4, 5, 6, 7, 8],
        help=f"Video duration in seconds (default: {DEFAULT_DURATION})",
    )
    parser.add_argument(
        "--prompt", type=str, default=None,
        help="Custom animation prompt (overrides default)",
    )
    parser.add_argument(
        "--output", "-o", type=Path, default=None,
        help="Output path for the .mp4 file (default: auto-generated)",
    )

    args = parser.parse_args()

    # Resolve image path
    if args.image:
        image_path = args.image
    else:
        print(f"Loading page {args.page} of '{args.slug}' from database...")
        image_path = resolve_image_path(args.slug, args.page)
        print(f"  Found: {image_path}")

    # Build prompt
    prompt = args.prompt or DEFAULT_PROMPT

    # If loading from DB and no custom prompt, enrich with keyframe context
    if args.slug and not args.prompt:
        page_text = get_keyframe_text(args.slug, args.page)
        if page_text:
            prompt = (
                f"{DEFAULT_PROMPT} "
                f"Scene context: {page_text[:200]}"
            )

    # Default output path
    if args.output:
        output_path = args.output
    elif args.slug:
        prefix = "cover" if args.page == 0 else f"page_{args.page:02d}"
        output_path = Path("stories") / args.slug / "videos" / f"{prefix}.mp4"
    else:
        output_path = image_path.with_suffix(".mp4")

    print()
    print("=== Veo Animation PoC ===")
    print()

    animate(image_path, args.model, args.duration, prompt, output_path)


if __name__ == "__main__":
    main()
