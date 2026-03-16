"""Shared utilities for router modules."""
from __future__ import annotations

from pathlib import Path


def generate_thumbnail(source: Path, dest: Path, width: int):
    """Resize an image to the given width (preserving aspect ratio) and save as JPEG."""
    from PIL import Image
    with Image.open(source) as img:
        ratio = width / img.width
        height = round(img.height * ratio)
        resized = img.resize((width, height), Image.LANCZOS)
        resized = resized.convert("RGB")
        resized.save(dest, "JPEG", quality=82, optimize=True)
