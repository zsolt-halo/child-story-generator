"""Animation bridge — manages Wan 2.2 subprocess lifecycle.

Spawns a single worker process that loads the model once and processes
all image→video jobs sequentially via JSONL protocol.
"""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from typing import Callable

from src.models import Keyframe

logger = logging.getLogger(__name__)

WAN_PYTHON = "C:/Users/netzs/codes/Wan2.2/.venv/Scripts/python.exe"
WORKER_SCRIPT = Path(__file__).parent / "wan_worker.py"


def build_animation_prompt(keyframe: Keyframe) -> str:
    """Build a video generation prompt from a keyframe's visual description."""
    parts = [
        "Gentle, subtle animation of a children's book illustration.",
        keyframe.visual_description,
        f"Mood: {keyframe.mood}.",
        "Slow camera movement, soft parallax, characters with gentle breathing or swaying motion.",
        "Seamless looping animation — the last frame transitions smoothly back to the first frame.",
        "Maintain the illustrated art style. No morphing or distortion.",
    ]
    return " ".join(parts)


def _start_worker() -> subprocess.Popen:
    """Start the Wan worker subprocess."""
    logger.info("Starting Wan worker subprocess: %s", WORKER_SCRIPT)
    proc = subprocess.Popen(
        [WAN_PYTHON, str(WORKER_SCRIPT)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    return proc


def _send_job(proc: subprocess.Popen, image_path: Path, output_path: Path, prompt: str) -> dict:
    """Send a single job to the worker and read the result."""
    job = {
        "image_path": str(image_path),
        "output_path": str(output_path),
        "prompt": prompt,
    }
    proc.stdin.write(json.dumps(job) + "\n")
    proc.stdin.flush()

    line = proc.stdout.readline()
    if not line:
        # Worker died — check stderr
        stderr = proc.stderr.read() if proc.stderr else ""
        raise RuntimeError(f"Wan worker died unexpectedly. stderr: {stderr[:2000]}")

    return json.loads(line.strip())


def generate_video_clip(image_path: Path, output_path: Path, prompt: str) -> Path:
    """Generate a single video clip. Starts/stops worker for one-off use."""
    proc = _start_worker()
    try:
        result = _send_job(proc, image_path, output_path, prompt)
        if result["status"] == "error":
            raise RuntimeError(f"Wan worker error: {result['error']}")
        return Path(result["output_path"])
    finally:
        proc.stdin.close()
        proc.wait(timeout=30)


def generate_all_clips(
    story_dir: Path,
    keyframes: list[Keyframe],
    on_progress: Callable[[int, int, Path, bool], None] | None = None,
) -> list[Path]:
    """Generate video clips for all keyframes, reusing a single worker process.

    Args:
        story_dir: Story directory containing images/ subfolder.
        keyframes: List of keyframes to animate.
        on_progress: Callback(index, total, output_path, skipped) for progress updates.

    Returns:
        List of output video paths.
    """
    videos_dir = story_dir / "videos"
    videos_dir.mkdir(parents=True, exist_ok=True)
    images_dir = story_dir / "images"

    # Check which clips need generation
    jobs: list[tuple[int, Keyframe, Path, Path]] = []
    results: list[tuple[int, Path, bool]] = []  # (index, path, skipped)

    for i, kf in enumerate(keyframes):
        output_path = videos_dir / f"{kf.image_prefix}.mp4"
        image_path = images_dir / f"{kf.image_prefix}.png"

        if output_path.exists():
            logger.debug("Video %s already exists, skipping", kf.image_prefix)
            results.append((i, output_path, True))
        elif not image_path.exists():
            logger.warning("Image %s not found, skipping animation", kf.image_prefix)
            results.append((i, output_path, True))
        else:
            jobs.append((i, kf, image_path, output_path))
            results.append((i, output_path, False))

    # Report skipped clips
    for idx, path, skipped in results:
        if skipped and on_progress:
            on_progress(idx, len(keyframes), path, True)

    if not jobs:
        return [r[1] for r in sorted(results)]

    # Start worker, process all pending jobs
    proc = _start_worker()
    try:
        for idx, kf, image_path, output_path in jobs:
            prompt = build_animation_prompt(kf)
            logger.info("Animating %d/%d: %s", idx + 1, len(keyframes), kf.image_prefix)

            result = _send_job(proc, image_path, output_path, prompt)
            if result["status"] == "error":
                logger.error("Animation failed for %s: %s", kf.image_prefix, result["error"])
                # Update results to mark as skipped on error
                for j, (ri, rp, rs) in enumerate(results):
                    if ri == idx:
                        results[j] = (ri, rp, True)
                        break
            if on_progress:
                on_progress(idx, len(keyframes), output_path, result["status"] != "ok")
    finally:
        proc.stdin.close()
        proc.wait(timeout=60)

    return [r[1] for r in sorted(results) if r[1].exists()]
