"""Worker API — pull-based endpoints for remote GPU animation worker."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, UploadFile, File, Form

from server.services.animation_queue import (
    get_active_queue,
    update_worker_heartbeat,
    get_worker_last_seen,
    is_worker_available,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/worker", tags=["worker"])


async def verify_worker_token(authorization: str = Header(...)):
    expected = os.environ.get("WORKER_AUTH_TOKEN", "")
    if not expected:
        raise HTTPException(503, "Worker auth not configured")
    if authorization != f"Bearer {expected}":
        raise HTTPException(401, "Invalid worker token")


@router.get("/poll")
async def poll_job(authorization: str = Header(...)):
    """Return next pending animation job, or 204 if idle."""
    await verify_worker_token(authorization)
    update_worker_heartbeat()

    queue = get_active_queue()
    if not queue:
        return None  # 200 with null body — worker treats as "no work"

    job = await queue.claim_next()
    if not job:
        return None

    return {
        "job_id": job.job_id,
        "slug": job.slug,
        "image_prefix": job.image_prefix,
        "prompt": job.prompt,
        "image_url": f"/api/stories/{job.slug}/images/{job.image_prefix}.png",
    }


@router.post("/complete/{job_id}")
async def complete_job(
    job_id: str,
    authorization: str = Header(...),
    status: str = Form(...),
    error: str = Form(None),
    video: UploadFile | None = File(None),
):
    """Upload completed video or report error for a job."""
    await verify_worker_token(authorization)
    update_worker_heartbeat()

    queue = get_active_queue()
    if not queue:
        raise HTTPException(404, "No active animation queue")

    job = queue.get_job(job_id)
    if not job:
        raise HTTPException(404, f"Job {job_id} not found")

    video_bytes = None
    if status == "ok" and video:
        video_bytes = await video.read()

    await queue.complete_job(
        job_id=job_id,
        video_bytes=video_bytes,
        success=(status == "ok"),
        error=error,
    )

    return {"ok": True}


@router.post("/heartbeat")
async def heartbeat(authorization: str = Header(...)):
    """Worker alive ping."""
    await verify_worker_token(authorization)
    update_worker_heartbeat()
    return {"ok": True}


@router.get("/status")
async def worker_status():
    """Public endpoint — returns worker availability and queue state."""
    last_seen = get_worker_last_seen()
    queue = get_active_queue()

    queue_info = None
    if queue:
        jobs = []
        for job in queue._jobs.values():
            jobs.append({
                "job_id": job.job_id,
                "image_prefix": job.image_prefix,
                "page_number": job.page_number,
                "status": job.status.value,
                "error": job.error,
            })
        # Sort by page number for readability
        jobs.sort(key=lambda j: j["page_number"])
        queue_info = {
            "slug": queue.slug,
            "total": queue.total,
            "completed": sum(1 for j in jobs if j["status"] == "completed"),
            "failed": sum(1 for j in jobs if j["status"] == "failed"),
            "assigned": sum(1 for j in jobs if j["status"] == "assigned"),
            "pending": sum(1 for j in jobs if j["status"] == "pending"),
            "jobs": jobs,
        }

    return {
        "available": is_worker_available(),
        "last_seen": (
            datetime.fromtimestamp(last_seen, tz=timezone.utc).isoformat()
            if last_seen
            else None
        ),
        "queue": queue_info,
    }
