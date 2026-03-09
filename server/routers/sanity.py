import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from server.schemas import TaskResponse, SanityCheckResult
from server.services.task_manager import task_manager
from server.services import sanity_service

router = APIRouter(prefix="/api/sanity", tags=["sanity"])


@router.post("/check/{slug}", response_model=TaskResponse)
async def check_all(slug: str):
    task_id = task_manager.create_task(
        sanity_service.check_all_pages,
        slug=slug,
    )
    return TaskResponse(task_id=task_id)


@router.post("/check/{slug}/{page}", response_model=SanityCheckResult)
async def check_page(slug: str, page: int):
    try:
        return await sanity_service.check_single_page(slug, page)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/fix/{slug}/{page}", response_model=TaskResponse)
async def fix_page(slug: str, page: int):
    task_id = task_manager.create_task(
        sanity_service.auto_fix_page,
        slug=slug,
        page_number=page,
    )
    return TaskResponse(task_id=task_id)


@router.get("/progress/{task_id}")
async def stream_sanity_progress(task_id: str):
    queue = task_manager.subscribe(task_id)
    if queue is None:
        raise HTTPException(status_code=404, detail="Task not found")

    async def event_stream():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("type") in ("task_complete", "error"):
                        break
                except asyncio.TimeoutError:
                    yield f": keepalive\n\n"
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
