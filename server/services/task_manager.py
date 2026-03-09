import asyncio
import traceback
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Coroutine


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


class TaskManager:
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

        async def _run():
            info.status = TaskStatus.RUNNING
            await self.broadcast(task_id, {"type": "task_start", "task_id": task_id})
            try:
                result = await coro_fn(task_id, *args, **kwargs)
                info.status = TaskStatus.COMPLETED
                info.result = result or {}
                await self.broadcast(task_id, {"type": "task_complete", "task_id": task_id, "result": info.result})
            except Exception as e:
                info.status = TaskStatus.FAILED
                info.error = str(e)
                traceback.print_exc()
                await self.broadcast(task_id, {"type": "error", "task_id": task_id, "error": str(e)})

        self._asyncio_tasks[task_id] = asyncio.create_task(_run())
        return task_id

    def get_status(self, task_id: str) -> TaskInfo | None:
        return self._tasks.get(task_id)

    def subscribe(self, task_id: str) -> asyncio.Queue | None:
        info = self._tasks.get(task_id)
        if not info:
            return None
        queue: asyncio.Queue = asyncio.Queue()
        info.subscribers.append(queue)

        # If task already finished, immediately enqueue the terminal event
        # so late subscribers don't hang forever
        if info.status == TaskStatus.COMPLETED:
            queue.put_nowait({"type": "task_complete", "task_id": task_id, "result": info.result})
        elif info.status == TaskStatus.FAILED:
            queue.put_nowait({"type": "error", "task_id": task_id, "error": info.error})

        return queue

    async def broadcast(self, task_id: str, event: dict):
        info = self._tasks.get(task_id)
        if not info:
            return
        for queue in info.subscribers:
            await queue.put(event)

    def cleanup(self, task_id: str):
        self._tasks.pop(task_id, None)
        task = self._asyncio_tasks.pop(task_id, None)
        if task and not task.done():
            task.cancel()


task_manager = TaskManager()
