import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)


class TaskStatus(str, Enum):
    PENDING = "pending"
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

    def create_task(
        self,
        coro_fn: Callable[..., Coroutine],
        *args: Any,
        **kwargs: Any,
    ) -> str:
        task_id = uuid.uuid4().hex[:12]
        info = TaskInfo(task_id=task_id)
        self._tasks[task_id] = info
        logger.info("Task created: %s", task_id)

        async def _run():
            info.status = TaskStatus.RUNNING
            logger.info("Task started: %s", task_id)
            await self.broadcast(task_id, {"type": "task_start", "task_id": task_id})
            try:
                result = await coro_fn(task_id, *args, **kwargs)
                info.status = TaskStatus.COMPLETED
                info.result = result or {}
                logger.info("Task completed: %s", task_id)
                await self.broadcast(task_id, {"type": "task_complete", "task_id": task_id, "result": info.result})
            except Exception as e:
                info.status = TaskStatus.FAILED
                info.error = str(e)
                logger.error("Task %s failed: %s", task_id, e, exc_info=True)
                await self.broadcast(task_id, {"type": "error", "task_id": task_id, "error": str(e)})
            finally:
                self._schedule_cleanup(task_id)

        self._asyncio_tasks[task_id] = asyncio.create_task(_run())
        return task_id

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
        self._tasks.pop(task_id, None)
        task = self._asyncio_tasks.pop(task_id, None)
        if task and not task.done():
            task.cancel()


task_manager = TaskManager()
