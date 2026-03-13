"""One-time script to generate 32 static backdrop images for text pages.

Usage:
    uv run python scripts/generate_backdrops.py

Generates 32 decorative backgrounds (8 themes x 4 variations) at 2400x2400
into static/backdrops/backdrop_01.png through backdrop_32.png.
"""

import sys
import time
from pathlib import Path

# Ensure project root is on sys.path when run as a script
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()

from src.artist.generator import create_image_client, generate_single_image, upscale_for_print
from src.utils.config import build_config

OUTPUT_DIR = Path("static/backdrops")

# 8 themes x 4 variations = 32 prompts
BACKDROP_PROMPTS = [
    # Theme 1: Leaf & star borders
    "Soft decorative page background for a children's book. "
    "Abstract gentle border ornaments with tiny leaves and stars around the edges, "
    "fading to a clean light cream center. No text, no characters, no animals. "
    "Very subtle and delicate. Square format.",

    "Gentle decorative page background for a children's storybook. "
    "Scattered small leaves and twinkling star shapes forming a loose border, "
    "warm ivory center. No text, no characters, no animals. Soft and airy. Square format.",

    "Delicate children's book page background with tiny leaf sprigs and star motifs "
    "clustered at the corners, transitioning to a clean pale cream middle. "
    "No text, no characters, no animals. Ethereal and light. Square format.",

    "Whimsical page border for a children's book with miniature leaves and stars "
    "dancing along the edges, bright warm center. No text, no characters, no animals. "
    "Pastel tones, very subtle. Square format.",

    # Theme 2: Floral swirls
    "Delicate ornamental page border for a children's book. "
    "Soft swirling floral patterns at the corners and edges, light and airy center area. "
    "No text, no characters, no animals. Pastel tones. Square format.",

    "Ornate children's book page frame with curving floral vines in the corners, "
    "blooming into tiny flowers. Clean bright center. No text, no characters, no animals. "
    "Soft pastel watercolor feel. Square format.",

    "Romantic floral border for a children's storybook page. Gentle rose and daisy swirls "
    "framing the edges, fading to a warm white center. No text, no characters, no animals. "
    "Light and dreamy. Square format.",

    "Children's book decorative border with delicate curling flower stems and small blossoms "
    "along the top and bottom edges. Clean cream center. No text, no characters, no animals. "
    "Soft and elegant. Square format.",

    # Theme 3: Clouds & stars
    "Whimsical decorative frame for a children's book page. "
    "Tiny scattered stars, clouds, and moons creating a gentle border. "
    "Warm soft center. No text, no characters, no animals. Very subtle. Square format.",

    "Dreamy children's book page background with fluffy clouds at the edges "
    "and small twinkling stars scattered around. Bright warm center area. "
    "No text, no characters, no animals. Gentle and magical. Square format.",

    "Celestial children's book page frame with crescent moons in the corners "
    "and tiny stars trailing along the edges. Clean ivory center. "
    "No text, no characters, no animals. Soft midnight blue accents. Square format.",

    "Night sky themed children's book page border with wispy clouds "
    "and scattered starlight around the edges. Warm glowing center. "
    "No text, no characters, no animals. Peaceful and subtle. Square format.",

    # Theme 4: Watercolor wash
    "Gentle watercolor wash background for a children's book. "
    "Soft gradient from warm edges to bright center with delicate vine ornaments in corners. "
    "No text, no characters, no animals. Square format.",

    "Soft watercolor splash background for a children's storybook page. "
    "Peachy and lavender washes at the edges bleeding into a clean white center. "
    "No text, no characters, no animals. Artistic and delicate. Square format.",

    "Children's book page with a gentle watercolor border effect. "
    "Warm golden and sage green washes at the corners fading to bright center. "
    "No text, no characters, no animals. Soft and organic. Square format.",

    "Abstract watercolor background for a children's book page. "
    "Pale blue and pink washes forming a subtle frame around the edges. Clean center. "
    "No text, no characters, no animals. Light and fresh. Square format.",

    # Theme 5: Woodland / nature
    "Forest-themed decorative page border for a children's book. "
    "Tiny mushrooms, ferns, and acorns at the edges and corners. "
    "Clean bright center. No text, no characters, no animals. Whimsical and subtle. Square format.",

    "Woodland children's book page frame with delicate pine branches and pinecones "
    "in the corners, small berries along the edges. Warm cream center. "
    "No text, no characters, no animals. Earthy and gentle. Square format.",

    "Nature-inspired children's book page background with tiny wildflowers "
    "and grass tufts at the bottom edge, butterfly silhouettes at the top corners. "
    "Clean center. No text, no characters, no animals. Fresh and spring-like. Square format.",

    "Garden-themed decorative border for a children's storybook page. "
    "Trailing ivy and small ladybugs at the edges, sunlit cream center. "
    "No text, no characters, no animals. Cheerful and delicate. Square format.",

    # Theme 6: Geometric / playful
    "Playful geometric border for a children's book page. "
    "Soft rounded triangles, circles, and dots in pastel colors along the edges. "
    "Clean white center. No text, no characters, no animals. Fun and modern. Square format.",

    "Children's book page frame with gentle polka dots and wavy lines at the borders, "
    "in soft candy colors. Bright warm center. "
    "No text, no characters, no animals. Cheerful and subtle. Square format.",

    "Confetti-style decorative background for a children's book page. "
    "Tiny pastel shapes scattered lightly around the edges. Clean center. "
    "No text, no characters, no animals. Festive and gentle. Square format.",

    "Whimsical bunting and pennant border for a children's storybook page. "
    "Small triangular flags draped along the top, scattered dots at corners. "
    "Warm ivory center. No text, no characters, no animals. Playful. Square format.",

    # Theme 7: Ocean / water
    "Ocean-themed decorative page border for a children's book. "
    "Gentle waves and tiny seashells at the bottom, subtle bubbles rising at the sides. "
    "Clean bright center. No text, no characters, no animals. Soothing and light. Square format.",

    "Underwater children's book page frame with soft coral shapes in the corners "
    "and tiny starfish accents. Warm aqua edges fading to clean center. "
    "No text, no characters, no animals. Peaceful and delicate. Square format.",

    "Beach-themed children's book page background with faint sandy textures at the bottom "
    "and small wave curls at the top corners. Clean warm center. "
    "No text, no characters, no animals. Summery and subtle. Square format.",

    "Seaside decorative border for a children's storybook. Tiny sailing boats "
    "and seagull silhouettes at the top, gentle wave pattern at the bottom. "
    "Bright center. No text, no characters, no animals. Breezy and light. Square format.",

    # Theme 8: Sparkle / magic
    "Magical sparkle border for a children's book page. "
    "Glittering fairy dust and tiny sparkles trailing along the edges. "
    "Clean warm glowing center. No text, no characters, no animals. Enchanting. Square format.",

    "Enchanted children's book page frame with soft golden sparkles "
    "and small crystal shapes at the corners. Warm bright center. "
    "No text, no characters, no animals. Magical and delicate. Square format.",

    "Rainbow-tinged decorative border for a children's storybook page. "
    "Faint prismatic light at the edges with tiny sparkle accents. Clean center. "
    "No text, no characters, no animals. Dreamy and colorful. Square format.",

    "Fairy tale children's book page background with a soft vignette of golden "
    "shimmer and small swirling sparkles at the borders. Warm ivory center. "
    "No text, no characters, no animals. Magical and warm. Square format.",
]


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    config = build_config()
    client = create_image_client(config)

    print(f"Generating {len(BACKDROP_PROMPTS)} backdrop images into {OUTPUT_DIR}/")

    for i, prompt in enumerate(BACKDROP_PROMPTS):
        num = i + 1
        final_path = OUTPUT_DIR / f"backdrop_{num:02d}.png"

        if final_path.exists():
            print(f"  [{num:2d}/{len(BACKDROP_PROMPTS)}] Already exists, skipping")
            continue

        print(f"  [{num:2d}/{len(BACKDROP_PROMPTS)}] Generating...")
        raw_path = OUTPUT_DIR / f"backdrop_{num:02d}_raw.png"
        generate_single_image(client, prompt, config.image_model, raw_path)
        upscale_for_print(raw_path, final_path)

        # Clean up raw file
        if raw_path.exists():
            raw_path.unlink()

        if num < len(BACKDROP_PROMPTS):
            time.sleep(5.0)

    print(f"Done! {len(BACKDROP_PROMPTS)} backdrops in {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
