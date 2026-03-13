import hashlib
import json
import random
from pathlib import Path

from src.models import Story

STATIC_BACKDROPS_DIR = Path(__file__).resolve().parent.parent.parent / "static" / "backdrops"

CHECKPOINT_FILE = "story.json"


def slugify(text: str, max_len: int = 40) -> str:
    """Convert text to a filesystem-safe slug."""
    slug = text.lower()
    slug = "".join(c if c.isalnum() or c == " " else "" for c in slug)
    slug = "-".join(slug.split())
    return slug[:max_len].rstrip("-")


def discover_backdrops(story_dir: Path) -> list[Path]:
    """Find finished backdrop images in a story directory (excludes raw files)."""
    backdrops_dir = story_dir / "backdrops"
    if not backdrops_dir.exists():
        return []
    return [p for p in sorted(backdrops_dir.glob("backdrop_*.png")) if "_raw" not in p.name]


def get_static_backdrops(slug: str) -> list[Path]:
    """Return the static backdrop pool shuffled deterministically by story slug."""
    pool = sorted(STATIC_BACKDROPS_DIR.glob("backdrop_*.png"))
    if not pool:
        return []
    seed = int(hashlib.md5(slug.encode()).hexdigest(), 16)
    rng = random.Random(seed)
    rng.shuffle(pool)
    return pool


def load_checkpoint(output_dir: Path) -> tuple[Story, list[Path]]:
    """Load saved pipeline state."""
    data = json.loads((output_dir / CHECKPOINT_FILE).read_text())
    story = Story.model_validate(data["story"])
    image_paths = [Path(p) for p in data.get("image_paths", [])]
    return story, image_paths


