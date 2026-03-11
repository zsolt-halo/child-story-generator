"""Generate style preview images for the NewStory wizard.

Usage:
    uv run python scripts/generate_style_previews.py
    uv run python scripts/generate_style_previews.py --force   # regenerate all
"""

import argparse
import sys
import tomllib
from pathlib import Path

# Ensure project root is on sys.path when run as a script
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from PIL import Image

load_dotenv(Path(__file__).parent.parent / ".env")

from src.artist.generator import create_image_client, generate_single_image
from src.models import BookConfig

CONFIGS_DIR = Path(__file__).parent.parent / "configs"
PREVIEW_DIR = CONFIGS_DIR / "style_previews"

SCENE_PROMPT = (
    "A small friendly llama wearing a colorful knitted scarf standing on a wooden bridge "
    "over a babbling brook in an enchanted forest. Fireflies glow softly among the ferns. "
    "Golden afternoon light filters through the canopy. A hedgehog companion sits on the "
    "railing. Square format, children's book illustration."
)

TARGET_SIZE = 800


def main():
    parser = argparse.ArgumentParser(description="Generate style preview images")
    parser.add_argument("--force", action="store_true", help="Regenerate all previews")
    args = parser.parse_args()

    styles_path = CONFIGS_DIR / "styles.toml"
    with open(styles_path, "rb") as f:
        styles = tomllib.load(f)

    PREVIEW_DIR.mkdir(exist_ok=True)

    config = BookConfig()
    client = create_image_client(config)

    for name, style in styles.items():
        output_path = PREVIEW_DIR / f"{name}.png"
        if output_path.exists() and not args.force:
            print(f"  Skipping {name} (already exists)")
            continue

        anchor = style["anchor"]
        prompt = f"{SCENE_PROMPT}\n\nArt style: {anchor}\n\nNo text, no words, no letters in the image."
        print(f"  Generating {name}...")

        raw_path = PREVIEW_DIR / f"{name}_raw.png"
        generate_single_image(client, prompt, config.image_model, raw_path)

        # Downscale to target size
        with Image.open(raw_path) as img:
            resized = img.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)
            resized.save(output_path, "PNG", optimize=True)

        raw_path.unlink()
        print(f"  Saved {output_path}")

    print("Done!")


if __name__ == "__main__":
    main()
