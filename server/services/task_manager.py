import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Coroutine

from opentelemetry import trace

logger = logging.getLogger(__name__)
tracer = trace.get_tracer("starlight.task")


class TaskStatus(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class TaskInfo:
    task_id: str
    status: TaskStatus = TaskStatus.PENDING
    result: dict | None = None
    error: str | None = None
    subscribers: list[asyncio.Queue] = field(default_factory=list)
    event_history: list[dict] = field(default_factory=list)


class TaskManager:
    CLEANUP_DELAY = 300  # seconds before completed tasks are evicted

    def __init__(self):
        self._tasks: dict[str, TaskInfo] = {}
        self._asyncio_tasks: dict[str, asyncio.Task] = {}
        self._pipeline_lock = asyncio.Lock()
        self._pipeline_queue: list[str] = []  # ordered list of waiting task IDs

    def create_task(
        self,
        coro_fn: Callable[..., Coroutine],
        *args: Any,
        exclusive: bool = False,
        **kwargs: Any,
    ) -> str:
        task_id = uuid.uuid4().hex[:12]
        info = TaskInfo(task_id=task_id)
        self._tasks[task_id] = info
        logger.info("Task created: %s (exclusive=%s)", task_id, exclusive)

        if exclusive:
            self._asyncio_tasks[task_id] = asyncio.create_task(
                self._run_exclusive(task_id, info, coro_fn, *args, **kwargs)
            )
        else:
            self._asyncio_tasks[task_id] = asyncio.create_task(
                self._run(task_id, info, coro_fn, *args, **kwargs)
            )
        return task_id

    async def _run(self, task_id: str, info: TaskInfo, coro_fn: Callable, *args, **kwargs):
        info.status = TaskStatus.RUNNING
        logger.info("Task started: %s", task_id)
        await self.broadcast(task_id, {"type": "task_start", "task_id": task_id})

        # Track active tasks metric
        try:
            from server.telemetry import active_pipeline_tasks
            if active_pipeline_tasks:
                active_pipeline_tasks.add(1)
        except ImportError:
            pass
        _metric_tracked = True

        with tracer.start_as_current_span(
            "task.run",
            attributes={"task.id": task_id, "task.function": coro_fn.__name__},
        ) as span:
            try:
                result = await coro_fn(task_id, *args, **kwargs)
                info.status = TaskStatus.COMPLETED
                info.result = result or {}
                span.set_attribute("task.status", "completed")
                logger.info("Task completed: %s", task_id)
                await self.broadcast(task_id, {"type": "task_complete", "task_id": task_id, "result": info.result})
            except Exception as e:
                info.status = TaskStatus.FAILED
                info.error = str(e)
                span.set_status(trace.StatusCode.ERROR, str(e))
                span.record_exception(e)
                logger.error("Task %s failed: %s", task_id, e, exc_info=True)
                await self.broadcast(task_id, {"type": "error", "task_id": task_id, "error": str(e)})
            finally:
                try:
                    from server.telemetry import active_pipeline_tasks as apt
                    if apt:
                        apt.add(-1)
                except ImportError:
                    pass
                self._schedule_cleanup(task_id)

    async def _run_exclusive(self, task_id: str, info: TaskInfo, coro_fn: Callable, *args, **kwargs):
        """Run a task with exclusive pipeline lock, broadcasting queue position while waiting."""
        self._pipeline_queue.append(task_id)
        info.status = TaskStatus.QUEUED
        self._broadcast_queue_positions()

        acquire_task = asyncio.ensure_future(self._pipeline_lock.acquire())
        try:
            # Wait for the lock, periodically updating queue positions
            while not acquire_task.done():
                done, _ = await asyncio.wait({acquire_task}, timeout=3.0)
                if done:
                    break
                self._broadcast_queue_positions()
        except asyncio.CancelledError:
            acquire_task.cancel()
            self._pipeline_queue = [t for t in self._pipeline_queue if t != task_id]
            self._broadcast_queue_positions()
            raise

        # Got the lock — remove from queue and run
        self._pipeline_queue = [t for t in self._pipeline_queue if t != task_id]
        self._broadcast_queue_positions()

        try:
            await self._run(task_id, info, coro_fn, *args, **kwargs)
        finally:
            self._pipeline_lock.release()

    def _broadcast_queue_positions(self):
        """Send queue_position events to all queued tasks."""
        for i, queued_id in enumerate(self._pipeline_queue):
            info = self._tasks.get(queued_id)
            if not info:
                continue
            event = {
                "type": "queue_position",
                "task_id": queued_id,
                "position": i + 1,
                "queue_ahead": i,
            }
            info.event_history.append(event)
            for queue in info.subscribers:
                queue.put_nowait(event)

    def _schedule_cleanup(self, task_id: str):
        """Auto-clean completed/failed tasks after a delay to free memory."""
        async def _deferred():
            await asyncio.sleep(self.CLEANUP_DELAY)
            self.cleanup(task_id)
            logger.debug("Auto-cleaned task %s", task_id)
        asyncio.create_task(_deferred())

    def get_status(self, task_id: str) -> TaskInfo | None:
        return self._tasks.get(task_id)

    def subscribe(self, task_id: str) -> asyncio.Queue | None:
        info = self._tasks.get(task_id)
        if not info:
            return None
        queue: asyncio.Queue = asyncio.Queue()

        # Snapshot history before adding to subscribers to avoid
        # duplicate events from concurrent broadcast() calls
        history_snapshot = list(info.event_history)
        info.subscribers.append(queue)

        for event in history_snapshot:
            queue.put_nowait(event)

        return queue

    def unsubscribe(self, task_id: str, queue: asyncio.Queue):
        info = self._tasks.get(task_id)
        if not info:
            return
        try:
            info.subscribers.remove(queue)
        except ValueError:
            pass

    async def broadcast(self, task_id: str, event: dict):
        info = self._tasks.get(task_id)
        if not info:
            return
        info.event_history.append(event)
        for queue in info.subscribers:
            await queue.put(event)

    def cleanup(self, task_id: str):
        self._pipeline_queue = [t for t in self._pipeline_queue if t != task_id]
        self._tasks.pop(task_id, None)
        task = self._asyncio_tasks.pop(task_id, None)
        if task and not task.done():
            task.cancel()


task_manager = TaskManager()
