import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from server.schemas import PipelineStartRequest, TranslateRequest, TaskResponse, TaskStatusResponse, BranchRequest, CoverSelectionRequest, RegenerateRefSheetRequest
from server.services.task_manager import task_manager
from server.services import pipeline_service

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])


@router.post("/start", response_model=TaskResponse)
async def start_full_pipeline(req: PipelineStartRequest):
    task_id = task_manager.create_task(
        pipeline_service.run_full_pipeline,
        notes=req.notes,
        character=req.character,
        narrator=req.narrator,
        style=req.style,
        pages=req.pages,
        language=req.language,
        exclusive=True,
    )
    return TaskResponse(task_id=task_id)


@router.post("/story", response_model=TaskResponse)
async def start_story_only(req: PipelineStartRequest):
    task_id = task_manager.create_task(
        pipeline_service.run_story_only,
        notes=req.notes,
        character=req.character,
        narrator=req.narrator,
        style=req.style,
        pages=req.pages,
        language=req.language,
        exclusive=True,
    )
    return TaskResponse(task_id=task_id)


@router.post("/cast/{slug}", response_model=TaskResponse)
async def start_cast_extraction(slug: str):
    task_id = task_manager.create_task(
        pipeline_service.run_cast_extraction,
        slug=slug,
        exclusive=True,
    )
    return TaskResponse(task_id=task_id)


@router.post("/translate/{slug}", response_model=TaskResponse)
async def start_translate(slug: str, req: TranslateRequest):
    task_id = task_manager.create_task(
        pipeline_service.run_translate,
        slug=slug,
        language=req.language,
        exclusive=True,
    )
    return TaskResponse(task_id=task_id)


@router.post("/illustrate/{slug}", response_model=TaskResponse)
async def start_illustrate(slug: str):
    task_id = task_manager.create_task(
        pipeline_service.run_illustrate,
        slug=slug,
        exclusive=True,
    )
    return TaskResponse(task_id=task_id)


@router.post("/illustrate/{slug}/{page}", response_model=TaskResponse)
async def start_illustrate_page(slug: str, page: int):
    task_id = task_manager.create_task(
        pipeline_service.run_illustrate,
        slug=slug,
        page_number=page,
        exclusive=True,
    )
    return TaskResponse(task_id=task_id)


@router.post("/backdrops/{slug}", response_model=TaskResponse)
async def start_backdrops(slug: str):
    task_id = task_manager.create_task(
        pipeline_service.run_backdrops,
        slug=slug,
        exclusive=True,
    )
    return TaskResponse(task_id=task_id)


@router.post("/continue/{slug}", response_model=TaskResponse)
async def continue_pipeline(slug: str, cast_edited: bool = False):
    """Continue pipeline after cast review: translate → illustrate → backdrops → PDF."""
    task_id = task_manager.create_task(
        pipeline_service.run_continue_pipeline,
        slug=slug,
        cast_edited=cast_edited,
        exclusive=True,
    )
    return TaskResponse(task_id=task_id)


@router.post("/select-cover/{slug}", response_model=TaskResponse)
async def select_cover(slug: str, req: CoverSelectionRequest):
    """Continue pipeline after cover selection: copy chosen cover → page illustrations → backdrops → PDF."""
    task_id = task_manager.create_task(
        pipeline_service.run_after_cover_selection,
        slug=slug,
        choice=req.choice,
        exclusive=True,
    )
    return TaskResponse(task_id=task_id)


@router.post("/regenerate-ref-sheet/{slug}", response_model=TaskResponse)
async def regenerate_ref_sheet(slug: str, req: RegenerateRefSheetRequest):
    """Regenerate a single cast member's reference sheet."""
    task_id = task_manager.create_task(
        pipeline_service.run_regenerate_cast_ref_sheet,
        slug=slug,
        member_name=req.member_name,
        exclusive=True,
    )
    return TaskResponse(task_id=task_id)


@router.post("/branch/{slug}", response_model=TaskResponse)
async def start_branch(slug: str, req: BranchRequest):
    """Create a story branch with different config."""
    from server.services.story_service import branch_story

    new_slug, new_dir, notes = await branch_story(
        source_slug=slug,
        new_config=req.model_dump(exclude={"start_from"}),
        start_from=req.start_from,
    )

    if req.start_from == "illustration":
        # Skip story gen, go straight to illustration pipeline
        task_id = task_manager.create_task(
            pipeline_service.run_continue_pipeline,
            slug=new_slug,
            exclusive=True,
        )
    else:
        # Full pipeline: story → keyframes → cast → stops for review
        task_id = task_manager.create_task(
            pipeline_service.run_story_only,
            notes=notes,
            character=req.character,
            narrator=req.narrator,
            style=req.style,
            pages=req.pages,
            output_slug=new_slug,
            language=req.language,
            parent_slug=slug,
            exclusive=True,
        )

    return TaskResponse(task_id=task_id)


@router.post("/pdf/{slug}", response_model=TaskResponse)
async def start_pdf(slug: str):
    task_id = task_manager.create_task(
        pipeline_service.run_pdf,
        slug=slug,
        exclusive=True,
    )
    return TaskResponse(task_id=task_id)


@router.get("/progress/{task_id}")
async def stream_progress(task_id: str):
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
        finally:
            task_manager.unsubscribe(task_id, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/status/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    info = task_manager.get_status(task_id)
    if info is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskStatusResponse(
        task_id=info.task_id,
        status=info.status.value,
        result=info.result,
        error=info.error,
    )
