#!/usr/bin/env python
"""Migrate story data from JSON checkpoints to PostgreSQL."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from src.models import Story
from src.db.repository import StoryRepository


def migrate():
    stories_dir = Path("stories")
    if not stories_dir.exists():
        print("No stories directory found")
        return

    repo = StoryRepository()
    success = 0
    failed = 0

    for story_json in sorted(stories_dir.glob("*/story.json")):
        slug = story_json.parent.name
        try:
            data = json.loads(story_json.read_text())
            story = Story.model_validate(data["story"])
            image_paths = data.get("image_paths", [])
            metadata = data.get("metadata")

            repo.save(slug, story, image_paths=image_paths, metadata=metadata)
            print(f"  OK: {slug} ({story.title})")
            success += 1
        except Exception as e:
            print(f"  FAIL: {slug} — {e}")
            failed += 1

    print(f"\nDone: {success} migrated, {failed} failed")


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    migrate()
