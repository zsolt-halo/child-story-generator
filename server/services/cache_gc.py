"""Background cache garbage collector.

Periodically compares locally cached story/character files against
MinIO (the source of truth) and evicts stale entries:

  - **Size mismatch** → file was regenerated → delete local + thumbnails
  - **Missing in MinIO** → file was deleted → delete local + thumbnails
  - **Orphaned directory** → story deleted from DB → remove entire dir

Runs as a background asyncio task inside the FastAPI process.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from src import storage

logger = logging.getLogger(__name__)

STORIES_DIR = Path("stories")
GC_INTERVAL = int(os.environ.get("CACHE_GC_INTERVAL", "300"))  # seconds


def _clear_thumbnails(file_path: Path) -> int:
    """Delete cached thumbnails derived from the given source image.

    Thumbnails live in ``{parent}/.thumbs/{stem}_w{width}.jpg``.
    Returns the number of thumbnails removed.
    """
    thumbs_dir = file_path.parent / ".thumbs"
    if not thumbs_dir.exists():
        return 0
    stem = file_path.stem
    count = 0
    for thumb in thumbs_dir.glob(f"{stem}_w*.jpg"):
        thumb.unlink(missing_ok=True)
        count += 1
    return count


async def _gc_prefix(local_dir: Path, prefix: str) -> tuple[int, int]:
    """Compare local files under ``local_dir`` against MinIO prefix.

    Returns (evicted_files, evicted_thumbs).
    """
    client = storage._get_client()
    if not client or not local_dir.exists():
        return 0, 0

    # Build a {key: size} map from MinIO in one list call
    minio_map: dict[str, int] = {}
    for obj in client.list_objects(storage.BUCKET, prefix=prefix + "/", recursive=True):
        minio_map[obj.object_name] = obj.size

    evicted = 0
    thumbs_evicted = 0

    for file_path in list(local_dir.rglob("*")):
        if not file_path.is_file():
            continue
        # Skip thumbnail cache and hidden metadata
        if ".thumbs" in file_path.parts:
            continue

        rel = file_path.relative_to(STORIES_DIR)
        key = rel.as_posix()

        if key not in minio_map:
            # File no longer exists in MinIO — evict
            file_path.unlink(missing_ok=True)
            thumbs_evicted += _clear_thumbnails(file_path)
            evicted += 1
        elif minio_map[key] != file_path.stat().st_size:
            # Size mismatch — file was regenerated — evict stale cache
            file_path.unlink(missing_ok=True)
            thumbs_evicted += _clear_thumbnails(file_path)
            evicted += 1

    return evicted, thumbs_evicted


async def _get_db_slugs() -> set[str]:
    """Return the set of story slugs currently in the database."""
    try:
        from src.db.engine import get_async_session_factory
        from src.db.models import StoryRow
        from sqlalchemy import select

        async with get_async_session_factory()() as session:
            result = await session.execute(select(StoryRow.slug))
            return {row[0] for row in result.all()}
    except Exception:
        logger.debug("Failed to query DB for story slugs", exc_info=True)
        return set()


async def run_gc_cycle() -> dict:
    """Single GC cycle. Returns stats."""
    if not storage.is_enabled():
        return {"skipped": True, "reason": "storage not enabled"}

    total_evicted = 0
    total_thumbs = 0
    dirs_removed = 0

    db_slugs = await _get_db_slugs()

    # Walk local story directories
    if STORIES_DIR.exists():
        for entry in STORIES_DIR.iterdir():
            if not entry.is_dir():
                continue

            # .characters directory — GC character assets
            if entry.name == ".characters":
                for char_dir in entry.iterdir():
                    if not char_dir.is_dir() or char_dir.name.startswith("."):
                        continue
                    prefix = f".characters/{char_dir.name}"
                    evicted, thumbs = await asyncio.to_thread(
                        _gc_prefix_sync, char_dir, prefix
                    )
                    total_evicted += evicted
                    total_thumbs += thumbs
                continue

            slug = entry.name

            # Orphaned directory — story deleted from DB
            if db_slugs and slug not in db_slugs:
                import shutil
                shutil.rmtree(entry, ignore_errors=True)
                dirs_removed += 1
                logger.info("GC: removed orphaned directory %s", slug)
                continue

            # Compare story files against MinIO
            evicted, thumbs = await asyncio.to_thread(
                _gc_prefix_sync, entry, slug
            )
            total_evicted += evicted
            total_thumbs += thumbs

    stats = {
        "evicted_files": total_evicted,
        "evicted_thumbnails": total_thumbs,
        "orphaned_dirs_removed": dirs_removed,
    }
    if total_evicted or total_thumbs or dirs_removed:
        logger.info("GC cycle: %s", stats)
    return stats


def _gc_prefix_sync(local_dir: Path, prefix: str) -> tuple[int, int]:
    """Synchronous version of _gc_prefix for use with asyncio.to_thread."""
    client = storage._get_client()
    if not client or not local_dir.exists():
        return 0, 0

    minio_map: dict[str, int] = {}
    for obj in client.list_objects(storage.BUCKET, prefix=prefix + "/", recursive=True):
        minio_map[obj.object_name] = obj.size

    evicted = 0
    thumbs_evicted = 0

    for file_path in list(local_dir.rglob("*")):
        if not file_path.is_file():
            continue
        if ".thumbs" in file_path.parts:
            continue

        rel = file_path.relative_to(STORIES_DIR)
        key = rel.as_posix()

        if key not in minio_map:
            file_path.unlink(missing_ok=True)
            thumbs_evicted += _clear_thumbnails(file_path)
            evicted += 1
        elif minio_map[key] != file_path.stat().st_size:
            file_path.unlink(missing_ok=True)
            thumbs_evicted += _clear_thumbnails(file_path)
            evicted += 1

    return evicted, thumbs_evicted


async def start_gc_worker():
    """Background loop that runs GC cycles at a fixed interval."""
    logger.info("Cache GC worker started (interval=%ds)", GC_INTERVAL)
    # Initial delay — let the app finish starting up
    await asyncio.sleep(30)
    while True:
        try:
            await run_gc_cycle()
        except asyncio.CancelledError:
            break
        except Exception:
            logger.warning("GC cycle failed", exc_info=True)
        await asyncio.sleep(GC_INTERVAL)
