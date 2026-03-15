"""Object storage backend for story/character assets.

Uses MinIO (S3-compatible) when MINIO_ENDPOINT is configured.
Local filesystem remains the primary read/write path; MinIO is the
shared source of truth that both k8s and local docker-compose use.

Pattern:
  - Writes go to local filesystem first (generation code unchanged),
    then get uploaded to MinIO via sync_directory() / upload_file().
  - Reads check local filesystem first (cache hit), falling back to
    MinIO download + local cache on miss.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

BUCKET = "stories"

# Lazy-initialized MinIO client
_client = None
_initialized = False


def _endpoint() -> str | None:
    return os.environ.get("MINIO_ENDPOINT")


def is_enabled() -> bool:
    return _endpoint() is not None


def _get_client():
    """Return a thread-safe MinIO client (lazy init)."""
    global _client, _initialized
    if _client is not None:
        return _client
    if not is_enabled():
        return None

    from minio import Minio

    endpoint = _endpoint()
    _client = Minio(
        endpoint,
        access_key=os.environ.get("MINIO_ACCESS_KEY", "minioadmin"),
        secret_key=os.environ.get("MINIO_SECRET_KEY", "minioadmin"),
        secure=False,
    )

    if not _initialized:
        try:
            if not _client.bucket_exists(BUCKET):
                _client.make_bucket(BUCKET)
                logger.info("Created MinIO bucket: %s", BUCKET)
            _initialized = True
        except Exception:
            logger.warning("Failed to initialize MinIO bucket", exc_info=True)

    return _client


# ---------------------------------------------------------------------------
# Core operations (sync, called via asyncio.to_thread)
# ---------------------------------------------------------------------------


def _upload_file(key: str, local_path: Path) -> None:
    """Upload a single file to MinIO."""
    client = _get_client()
    if not client:
        return
    client.fput_object(BUCKET, key, str(local_path))


def _download_file(key: str, local_path: Path) -> bool:
    """Download a file from MinIO to local path. Returns True on success."""
    client = _get_client()
    if not client:
        return False
    try:
        client.fget_object(BUCKET, key, str(local_path))
        return True
    except Exception:
        return False


def _object_exists(key: str) -> bool:
    """Check if an object exists in MinIO."""
    client = _get_client()
    if not client:
        return False
    try:
        client.stat_object(BUCKET, key)
        return True
    except Exception:
        return False


def _delete_object(key: str) -> None:
    """Delete a single object from MinIO."""
    client = _get_client()
    if not client:
        return
    try:
        client.remove_object(BUCKET, key)
    except Exception:
        logger.debug("Failed to delete %s from MinIO", key, exc_info=True)


def _delete_prefix(prefix: str) -> None:
    """Delete all objects with the given prefix."""
    client = _get_client()
    if not client:
        return
    from minio.deleteobjects import DeleteObject
    objects = client.list_objects(BUCKET, prefix=prefix, recursive=True)
    delete_list = [DeleteObject(obj.object_name) for obj in objects]
    if delete_list:
        errors = list(client.remove_objects(BUCKET, delete_list))
        if errors:
            logger.warning("Errors deleting prefix %s: %s", prefix, errors)


def _sync_directory(local_dir: Path, prefix: str) -> int:
    """Upload all files under local_dir to MinIO under prefix. Returns count."""
    client = _get_client()
    if not client:
        return 0
    count = 0
    for file_path in local_dir.rglob("*"):
        if file_path.is_file() and not file_path.name.startswith("."):
            # Skip thumbnail cache — regenerated on demand
            if ".thumbs" in file_path.parts:
                continue
            rel = file_path.relative_to(local_dir)
            key = f"{prefix}/{rel.as_posix()}"
            try:
                client.fput_object(BUCKET, key, str(file_path))
                count += 1
            except Exception:
                logger.warning("Failed to upload %s", key, exc_info=True)
    return count


# ---------------------------------------------------------------------------
# Async wrappers (for use in FastAPI / pipeline code)
# ---------------------------------------------------------------------------


async def upload_file(key: str, local_path: Path) -> None:
    """Async: upload a file to MinIO."""
    if not is_enabled():
        return
    await asyncio.to_thread(_upload_file, key, local_path)


async def ensure_local(key: str, local_path: Path) -> bool:
    """Ensure a file exists locally, downloading from MinIO if needed.

    Returns True if the file is available locally after this call.
    """
    if local_path.exists():
        return True
    if not is_enabled():
        return False
    local_path.parent.mkdir(parents=True, exist_ok=True)
    return await asyncio.to_thread(_download_file, key, local_path)


async def sync_directory(local_dir: Path, prefix: str) -> int:
    """Async: upload all files under local_dir to MinIO. Returns count."""
    if not is_enabled():
        return 0
    count = await asyncio.to_thread(_sync_directory, local_dir, prefix)
    logger.info("Synced %d files to MinIO: %s -> %s", count, local_dir, prefix)
    return count


async def delete_prefix(prefix: str) -> None:
    """Async: delete all objects with the given prefix."""
    if not is_enabled():
        return
    await asyncio.to_thread(_delete_prefix, prefix)
    logger.info("Deleted MinIO prefix: %s", prefix)


async def delete_object(key: str) -> None:
    """Async: delete a single object."""
    if not is_enabled():
        return
    await asyncio.to_thread(_delete_object, key)
