# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "torch>=2.4.0",
#     "torchvision>=0.19.0",
#     "requests>=2.31",
#     "opencv-python>=4.9.0.80",
#     "diffusers>=0.31.0",
#     "transformers>=4.49.0",
#     "tokenizers>=0.20.3",
#     "accelerate>=1.1.1",
#     "tqdm",
#     "imageio[ffmpeg]",
#     "easydict",
#     "ftfy",
#     "numpy>=1.26",
#     "imageio-ffmpeg",
#     "einops",
#     "regex",
#     "Pillow>=10.0.0",
# ]
#
# [[tool.uv.index]]
# name = "pytorch-cu128"
# url = "https://download.pytorch.org/whl/cu128"
# explicit = true
#
# [tool.uv.sources]
# torch = [{ index = "pytorch-cu128" }]
# torchvision = [{ index = "pytorch-cu128" }]
# ///
"""Pull-based animation worker for remote GPU inference.

Polls the backend for animation jobs, runs Wan 2.2 TI2V-5B locally,
and uploads completed videos. Used both bare-metal and in Docker container.

Config via env vars:
    BACKEND_URL   - Comma-separated backend URLs (default: http://localhost:8000)
                    e.g. http://localhost:8000,http://192.168.86.45:30082
    WORKER_TOKEN  - Auth token (must match backend's WORKER_AUTH_TOKEN)
    WAN_REPO      - Path to Wan 2.2 source repo
    WAN_MODEL_DIR - Path to model weights (default: {WAN_REPO}/Wan2.2-TI2V-5B)

Usage:
    uv run scripts/animation_worker.py
    BACKEND_URL=http://localhost:8000,http://192.168.86.45:30082 uv run scripts/animation_worker.py
"""

import io
import logging
import os
import sys
import tempfile
import threading
import time
import warnings

import requests

warnings.filterwarnings("ignore")

logging.basicConfig(
    level=logging.INFO,
    format="[animation-worker %(asctime)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Configuration
_raw_urls = os.environ.get("BACKEND_URL", "http://localhost:8000")
BACKEND_URLS = [u.strip() for u in _raw_urls.split(",") if u.strip()]
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "dev-token")
WAN_REPO = os.environ.get("WAN_REPO", "C:/Users/netzs/codes/Wan2.2")
WAN_MODEL_DIR = os.environ.get("WAN_MODEL_DIR", f"{WAN_REPO}/Wan2.2-TI2V-5B")

POLL_INTERVAL = 5  # seconds between polls when idle
HEARTBEAT_INTERVAL = 30  # seconds between heartbeats

SIZE = "1280*704"
SAMPLE_STEPS = int(os.environ.get("SAMPLE_STEPS", "30"))
FRAME_NUM = int(os.environ.get("FRAME_NUM", "81"))

_session = requests.Session()
_session.headers["Authorization"] = f"Bearer {WORKER_TOKEN}"


def _api(method, path, backend_url, **kwargs):
    """Make an API call to a specific backend."""
    url = f"{backend_url}{path}"
    resp = getattr(_session, method)(url, **kwargs)
    return resp


def _load_pipeline():
    """Load the Wan TI2V pipeline once.

    Imports only the textimage2video submodule to avoid pulling in heavy
    unused deps (decord, dashscope, peft) from speech2video/animate.
    We stub out wan.__init__ to prevent it from importing everything.
    """
    import types
    import torch
    sys.path.insert(0, WAN_REPO)

    # Create a stub wan package to prevent __init__.py from importing
    # speech2video/animate (which need decord, dashscope, peft)
    wan_stub = types.ModuleType("wan")
    wan_stub.__path__ = [os.path.join(WAN_REPO, "wan")]
    wan_stub.__package__ = "wan"
    sys.modules["wan"] = wan_stub

    from wan.configs import WAN_CONFIGS, SIZE_CONFIGS, MAX_AREA_CONFIGS
    from wan.textimage2video import WanTI2V

    cfg = WAN_CONFIGS["ti2v-5B"]
    cfg.sample_steps = SAMPLE_STEPS
    cfg.frame_num = FRAME_NUM
    logger.info("Loading Wan TI2V-5B model from %s ...", WAN_MODEL_DIR)
    logger.info("  Steps: %d, Frames: %d (%.1fs @ %dfps)", SAMPLE_STEPS, FRAME_NUM, FRAME_NUM / cfg.sample_fps, cfg.sample_fps)

    pipeline = WanTI2V(
        config=cfg,
        checkpoint_dir=WAN_MODEL_DIR,
        device_id=0,
        rank=0,
        t5_fsdp=False,
        dit_fsdp=False,
        use_sp=False,
        t5_cpu=False,
    )
    logger.info("Model loaded successfully.")
    return pipeline, cfg, SIZE_CONFIGS[SIZE], MAX_AREA_CONFIGS[SIZE]


def _generate_video(pipeline, cfg, size_cfg, max_area, image_path: str, output_path: str, prompt: str):
    """Generate a single video clip from an image + prompt."""
    import torch
    from PIL import Image
    from wan.utils.utils import save_video

    img = Image.open(image_path).convert("RGB")

    video = pipeline.generate(
        prompt,
        img=img,
        size=size_cfg,
        max_area=max_area,
        frame_num=cfg.frame_num,
        shift=cfg.sample_shift,
        sample_solver="unipc",
        sampling_steps=cfg.sample_steps,
        guide_scale=cfg.sample_guide_scale,
        seed=-1,
        offload_model=True,
    )

    save_video(
        tensor=video[None],
        save_file=output_path,
        fps=cfg.sample_fps,
        nrow=1,
        normalize=True,
        value_range=(-1, 1),
    )
    del video
    torch.cuda.empty_cache()


def _heartbeat_loop():
    """Send periodic heartbeats to all backends in a background thread."""
    while True:
        for url in BACKEND_URLS:
            try:
                _api("post", "/api/worker/heartbeat", url)
            except Exception as e:
                logger.warning("Heartbeat failed (%s): %s", url, e)
        time.sleep(HEARTBEAT_INTERVAL)


def _poll() -> tuple[dict, str] | None:
    """Poll all backends for next job. Returns (job_dict, backend_url) or None."""
    for url in BACKEND_URLS:
        try:
            resp = _api("get", "/api/worker/poll", url)
            if resp.status_code == 200:
                data = resp.json()
                if data:
                    return data, url
        except Exception as e:
            logger.warning("Poll failed (%s): %s", url, e)
    return None


def _download_image(backend_url: str, image_url: str, dest: str) -> bool:
    """Download source image from backend."""
    try:
        url = f"{backend_url}{image_url}"
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        with open(dest, "wb") as f:
            f.write(resp.content)
        return True
    except Exception as e:
        logger.error("Failed to download image %s: %s", image_url, e)
        return False


def _upload_result(backend_url: str, job_id: str, video_path: str | None, error: str | None):
    """Upload completed video or report error."""
    try:
        data = {"status": "ok" if video_path else "error"}
        if error:
            data["error"] = error
            data["status"] = "error"

        files = {}
        if video_path and os.path.exists(video_path):
            files["video"] = ("video.mp4", open(video_path, "rb"), "video/mp4")

        resp = _api("post", f"/api/worker/complete/{job_id}", backend_url, data=data, files=files)
        if resp.status_code != 200:
            logger.error("Upload failed: %s %s", resp.status_code, resp.text)
    except Exception as e:
        logger.error("Upload failed for job %s: %s", job_id, e)


def _fmt_duration(seconds: float) -> str:
    """Format seconds into a human-readable string."""
    if seconds < 60:
        return f"{seconds:.0f}s"
    m, s = divmod(int(seconds), 60)
    if m < 60:
        return f"{m}m{s:02d}s"
    h, m = divmod(m, 60)
    return f"{h}h{m:02d}m{s:02d}s"


def _fmt_size(nbytes: int) -> str:
    """Format bytes into human-readable size."""
    if nbytes < 1024 * 1024:
        return f"{nbytes / 1024:.0f}KB"
    return f"{nbytes / (1024 * 1024):.1f}MB"


def main():
    logger.info("=" * 60)
    logger.info("Animation worker starting")
    for i, url in enumerate(BACKEND_URLS):
        logger.info("  Backend %d: %s", i + 1, url)
    logger.info("  Wan repo:  %s", WAN_REPO)
    logger.info("  Model dir: %s", WAN_MODEL_DIR)
    logger.info("=" * 60)

    # Load model
    t_load = time.monotonic()
    pipeline, cfg, size_cfg, max_area = _load_pipeline()
    logger.info("Model ready (loaded in %s)", _fmt_duration(time.monotonic() - t_load))

    # Start heartbeat thread
    hb = threading.Thread(target=_heartbeat_loop, daemon=True)
    hb.start()

    # Initial heartbeat to all backends
    for url in BACKEND_URLS:
        try:
            _api("post", "/api/worker/heartbeat", url)
        except Exception as e:
            logger.warning("Initial heartbeat failed (%s): %s", url, e)

    logger.info("Polling for jobs...")

    # Session stats
    jobs_completed = 0
    jobs_failed = 0
    total_gen_time = 0.0
    idle_since = time.monotonic()

    while True:
        result = _poll()
        if not result:
            # Periodic idle status (every 60s instead of every 5s)
            if time.monotonic() - idle_since > 60:
                idle_dur = _fmt_duration(time.monotonic() - idle_since)
                logger.info("Idle for %s | Session: %d done, %d failed", idle_dur, jobs_completed, jobs_failed)
                idle_since = time.monotonic()
            time.sleep(POLL_INTERVAL)
            continue

        job, backend_url = result
        idle_since = time.monotonic()

        job_id = job["job_id"]
        slug = job["slug"]
        image_prefix = job["image_prefix"]
        prompt = job["prompt"]
        image_url = job["image_url"]

        backend_label = backend_url.split("//")[-1]
        logger.info("-" * 50)
        logger.info("Job %s: %s/%s [%s]", job_id, slug, image_prefix, backend_label)

        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = os.path.join(tmpdir, f"{image_prefix}.png")
            output_path = os.path.join(tmpdir, f"{image_prefix}.mp4")

            # Download source image
            t0 = time.monotonic()
            if not _download_image(backend_url, image_url, image_path):
                _upload_result(backend_url, job_id, None, "Failed to download source image")
                jobs_failed += 1
                continue
            img_size = os.path.getsize(image_path)
            logger.info("  Downloaded %s (%s)", image_prefix, _fmt_size(img_size))

            # Generate video
            try:
                t_gen = time.monotonic()
                _generate_video(pipeline, cfg, size_cfg, max_area, image_path, output_path, prompt)
                gen_dur = time.monotonic() - t_gen
                total_gen_time += gen_dur

                vid_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
                logger.info("  Generated in %s (%s)", _fmt_duration(gen_dur), _fmt_size(vid_size))

                t_up = time.monotonic()
                _upload_result(backend_url, job_id, output_path, None)
                up_dur = time.monotonic() - t_up
                logger.info("  Uploaded in %s", _fmt_duration(up_dur))

                total_dur = time.monotonic() - t0
                jobs_completed += 1
                avg = total_gen_time / jobs_completed

                logger.info("  Done: %s total | Session: %d/%d done (avg %s/clip)",
                            _fmt_duration(total_dur), jobs_completed,
                            jobs_completed + jobs_failed, _fmt_duration(avg))
            except Exception as e:
                logger.error("  FAILED: %s", e, exc_info=True)
                _upload_result(backend_url, job_id, None, str(e))
                jobs_failed += 1


if __name__ == "__main__":
    main()
