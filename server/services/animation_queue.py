"""In-memory animation job queue for remote GPU worker.

Only one queue is active at a time (matches the exclusive pipeline lock).
Jobs are ephemeral — scoped to a single run_animate() call.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Callable, Coroutine

logger = logging.getLogger(__name__)


class JobStatus(str, Enum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class AnimationJob:
    job_id: str
    slug: str
    page_number: int
    image_prefix: str  # "page_01", "cover"
    prompt: str
    status: JobStatus = JobStatus.PENDING
    assigned_at: float | None = None
    error: str | None = None


class AnimationQueue:
    STALE_TIMEOUT = 300  # 5 minutes before re-queuing assigned jobs

    def __init__(
        self,
        slug: str,
        task_id: str,
        on_complete: Callable[[AnimationJob, Path | None], Coroutine] | None = None,
    ):
        self.slug = slug
        self.task_id = task_id
        self._jobs: dict[str, AnimationJob] = {}
        self._lock = asyncio.Lock()
        self._all_done = asyncio.Event()
        self._on_complete = on_complete

    def add_job(self, job: AnimationJob) -> None:
        self._jobs[job.job_id] = job

    async def claim_next(self) -> AnimationJob | None:
        """Atomically claim the next pending job."""
        async with self._lock:
            for job in self._jobs.values():
                if job.status == JobStatus.PENDING:
                    job.status = JobStatus.ASSIGNED
                    job.assigned_at = time.monotonic()
                    return job
        return None

    async def complete_job(
        self,
        job_id: str,
        video_bytes: bytes | None,
        success: bool,
        error: str | None = None,
    ) -> None:
        """Mark a job as completed or failed, save video to disk."""
        job = self._jobs.get(job_id)
        if not job:
            logger.warning("complete_job: unknown job_id %s", job_id)
            return

        video_path: Path | None = None
        if success and video_bytes:
            videos_dir = Path("stories") / self.slug / "videos"
            videos_dir.mkdir(parents=True, exist_ok=True)
            video_path = videos_dir / f"{job.image_prefix}.mp4"
            video_path.write_bytes(video_bytes)
            job.status = JobStatus.COMPLETED
            logger.info("Job %s completed: %s", job_id, video_path)
        else:
            job.status = JobStatus.FAILED
            job.error = error or "Unknown error"
            logger.error("Job %s failed: %s", job_id, job.error)

        if self._on_complete:
            await self._on_complete(job, video_path)

        if self.is_all_done():
            self._all_done.set()

    def is_all_done(self) -> bool:
        return all(
            j.status in (JobStatus.COMPLETED, JobStatus.FAILED)
            for j in self._jobs.values()
        )

    async def wait_all(self, timeout: float = 14400) -> bool:
        """Wait until all jobs are done. Returns True if completed, False on timeout."""
        try:
            await asyncio.wait_for(self._all_done.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False

    async def requeue_stale(self) -> int:
        """Re-queue jobs stuck in assigned status beyond STALE_TIMEOUT."""
        count = 0
        async with self._lock:
            now = time.monotonic()
            for job in self._jobs.values():
                if (
                    job.status == JobStatus.ASSIGNED
                    and job.assigned_at
                    and now - job.assigned_at > self.STALE_TIMEOUT
                ):
                    job.status = JobStatus.PENDING
                    job.assigned_at = None
                    count += 1
                    logger.warning("Re-queued stale job %s (%s)", job.job_id, job.image_prefix)
        return count

    @property
    def total(self) -> int:
        return len(self._jobs)

    @property
    def completed_count(self) -> int:
        return sum(1 for j in self._jobs.values() if j.status in (JobStatus.COMPLETED, JobStatus.FAILED))

    def get_job(self, job_id: str) -> AnimationJob | None:
        return self._jobs.get(job_id)


# Module-level singleton — one active queue at a time
_active_queue: AnimationQueue | None = None
_active_queue_lock = asyncio.Lock()

# Worker heartbeat tracking
_worker_last_seen: float | None = None


def get_active_queue() -> AnimationQueue | None:
    return _active_queue


async def set_active_queue(queue: AnimationQueue | None) -> None:
    global _active_queue
    async with _active_queue_lock:
        _active_queue = queue


def update_worker_heartbeat() -> None:
    global _worker_last_seen
    _worker_last_seen = time.time()


def get_worker_last_seen() -> float | None:
    return _worker_last_seen


def is_worker_available(timeout: float = 60) -> bool:
    """Check if a worker has been seen recently."""
    if _worker_last_seen is None:
        return False
    return (time.time() - _worker_last_seen) < timeout
