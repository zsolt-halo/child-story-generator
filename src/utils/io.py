import json
from pathlib import Path

from src.models import Story

CHECKPOINT_FILE = "story.json"


def slugify(text: str, max_len: int = 40) -> str:
    """Convert text to a filesystem-safe slug."""
    slug = text.lower()
    slug = "".join(c if c.isalnum() or c == " " else "" for c in slug)
    slug = "-".join(slug.split())
    return slug[:max_len].rstrip("-")


def ensure_dir(path: Path) -> Path:
    """Create directory if it doesn't exist and return it."""
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_checkpoint(
    output_dir: Path,
    story: Story,
    image_paths: list[str] | None = None,
    metadata: dict | None = None,
):
    """Save pipeline state so we can resume later.

    If metadata is provided, it overwrites any existing metadata.
    If metadata is None, existing metadata is preserved.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    data: dict = {
        "story": story.model_dump(),
        "image_paths": image_paths or [],
    }
    if metadata is not None:
        data["metadata"] = metadata
    else:
        # Preserve existing metadata
        checkpoint = output_dir / CHECKPOINT_FILE
        if checkpoint.exists():
            try:
                old = json.loads(checkpoint.read_text())
                if "metadata" in old:
                    data["metadata"] = old["metadata"]
            except (json.JSONDecodeError, KeyError):
                pass
    (output_dir / CHECKPOINT_FILE).write_text(json.dumps(data, indent=2))


def load_checkpoint(output_dir: Path) -> tuple[Story, list[Path]]:
    """Load saved pipeline state."""
    data = json.loads((output_dir / CHECKPOINT_FILE).read_text())
    story = Story.model_validate(data["story"])
    image_paths = [Path(p) for p in data.get("image_paths", [])]
    return story, image_paths


def load_metadata(output_dir: Path) -> dict | None:
    """Load metadata from checkpoint, or None if not present."""
    checkpoint = output_dir / CHECKPOINT_FILE
    if not checkpoint.exists():
        return None
    try:
        data = json.loads(checkpoint.read_text())
        return data.get("metadata")
    except (json.JSONDecodeError, KeyError):
        return None
