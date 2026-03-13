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
#     "rich>=13.0",
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

import ctypes
import io
import logging
import os
import sys
import tempfile
import threading
import time
import warnings

import requests
from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn, TaskProgressColumn
from rich.table import Table
from rich.text import Text

warnings.filterwarnings("ignore")

# Suppress noisy loggers — we use rich for output
logging.basicConfig(level=logging.WARNING, format="%(message)s")
for _quiet in ("urllib3", "requests", "torch", "transformers", "diffusers", "fontTools", "PIL"):
    logging.getLogger(_quiet).setLevel(logging.ERROR)
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

console = Console()

# Windows sleep prevention via SetThreadExecutionState
ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
ES_DISPLAY_REQUIRED = 0x00000002
_wake_lock_held = False


def _keep_awake():
    """Prevent Windows from sleeping or turning off the display."""
    global _wake_lock_held
    if _wake_lock_held or sys.platform != "win32":
        return
    ctypes.windll.kernel32.SetThreadExecutionState(
        ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
    )
    _wake_lock_held = True
    console.print("  [bold black on bright_yellow] WAKE LOCK [/] [yellow]System sleep blocked — GPU is working[/]")


def _allow_sleep():
    """Re-allow Windows to sleep normally."""
    global _wake_lock_held
    if not _wake_lock_held or sys.platform != "win32":
        return
    ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
    _wake_lock_held = False
    console.print("  [dim]Wake lock released — system may sleep[/]")
    _wake_lock_held = False


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

    with console.status("[bold cyan]Loading Wan TI2V-5B model...", spinner="dots"):
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


def _build_stats_table(jobs_completed: int, jobs_failed: int, total_gen_time: float, session_start: float) -> Table:
    """Build a compact stats bar."""
    lock_badge = Text(" WAKE LOCK ", style="bold black on bright_yellow") if _wake_lock_held else Text(" SLEEP OK ", style="dim on default")
    t = Table.grid(padding=(0, 2))
    t.add_row(
        lock_badge,
        Text(f"{jobs_completed}", style="bold green") + Text(" done"),
        Text(f"{jobs_failed}", style="bold red") + Text(" failed") if jobs_failed else Text(""),
        Text(f"{_fmt_duration(total_gen_time / jobs_completed)}/clip", style="dim") if jobs_completed else Text(""),
        Text(f"uptime {_fmt_duration(time.monotonic() - session_start)}", style="dim"),
    )
    return t


def main():
    # Startup banner
    grid = Table.grid(padding=(0, 2))
    grid.add_row("[bold]Backends[/]", ", ".join(f"[cyan]{u}[/]" for u in BACKEND_URLS))
    grid.add_row("[bold]Model[/]", f"Wan TI2V-5B  [dim]{WAN_MODEL_DIR}[/]")
    grid.add_row("[bold]Output[/]", f"{SIZE}  {SAMPLE_STEPS} steps  {FRAME_NUM} frames")
    console.print(Panel(grid, title="[bold magenta]StarlightScribe Animation Worker[/]", border_style="magenta", padding=(1, 2)))

    # Load model
    t_load = time.monotonic()
    pipeline, cfg, size_cfg, max_area = _load_pipeline()
    console.print(f"  [green]Model ready[/] [dim]loaded in {_fmt_duration(time.monotonic() - t_load)}[/]\n")

    # Start heartbeat thread
    hb = threading.Thread(target=_heartbeat_loop, daemon=True)
    hb.start()

    for url in BACKEND_URLS:
        try:
            _api("post", "/api/worker/heartbeat", url)
        except Exception:
            pass

    # Session stats
    jobs_completed = 0
    jobs_failed = 0
    total_gen_time = 0.0
    session_start = time.monotonic()
    idle_since = time.monotonic()

    # Idle polling with spinner
    while True:
        # Idle phase — release wake lock, show spinner
        _allow_sleep()
        with console.status("[dim]Waiting for animation jobs...[/]", spinner="dots", spinner_style="cyan") as status:
            while True:
                result = _poll()
                if result:
                    break
                if time.monotonic() - idle_since > 60:
                    idle_dur = _fmt_duration(time.monotonic() - idle_since)
                    status.update(f"[dim]Waiting for jobs... idle {idle_dur}[/]  [dim]|[/]  [green]{jobs_completed}[/] done  [red]{jobs_failed}[/] failed")
                time.sleep(POLL_INTERVAL)

        # Job received — prevent sleep
        _keep_awake()
        idle_since = time.monotonic()
        job, backend_url = result

        job_id = job["job_id"]
        slug = job["slug"]
        image_prefix = job["image_prefix"]
        prompt = job["prompt"]
        image_url = job["image_url"]

        backend_label = backend_url.split("//")[-1]
        short_prompt = (prompt[:60] + "...") if len(prompt) > 63 else prompt

        # Job header
        console.print()
        console.rule(f"[bold yellow]{slug}[/] / [bold]{image_prefix}[/]", style="yellow")
        console.print(f"  [dim]job[/] {job_id}  [dim]via[/] {backend_label}")
        console.print(f"  [dim]prompt[/] [italic]{short_prompt}[/]")

        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = os.path.join(tmpdir, f"{image_prefix}.png")
            output_path = os.path.join(tmpdir, f"{image_prefix}.mp4")

            # Download source image
            t0 = time.monotonic()
            with console.status("  [cyan]Downloading source image...[/]", spinner="dots"):
                ok = _download_image(backend_url, image_url, image_path)
            if not ok:
                console.print("  [red]Failed to download source image[/]")
                _upload_result(backend_url, job_id, None, "Failed to download source image")
                jobs_failed += 1
                continue
            img_size = os.path.getsize(image_path)
            console.print(f"  [green]Downloaded[/] {_fmt_size(img_size)}")

            # Generate video with progress
            try:
                t_gen = time.monotonic()

                progress = Progress(
                    SpinnerColumn("dots", style="magenta"),
                    TextColumn("[bold cyan]Generating"),
                    BarColumn(bar_width=30, style="bar.back", complete_style="magenta", finished_style="green"),
                    TaskProgressColumn(),
                    TextColumn("[dim]elapsed[/]"),
                    TimeElapsedColumn(),
                    console=console,
                    transient=True,
                )
                gen_task = progress.add_task("gen", total=cfg.sample_steps)

                # Run generation in a thread so we can animate the progress bar
                gen_error = [None]
                def _run_gen():
                    try:
                        _generate_video(pipeline, cfg, size_cfg, max_area, image_path, output_path, prompt)
                    except Exception as e:
                        gen_error[0] = e

                gen_thread = threading.Thread(target=_run_gen)

                with progress:
                    gen_thread.start()
                    while gen_thread.is_alive():
                        # Estimate progress from elapsed time vs average
                        elapsed = time.monotonic() - t_gen
                        if jobs_completed > 0:
                            avg = total_gen_time / jobs_completed
                            est = min(elapsed / avg, 0.95) * cfg.sample_steps
                        else:
                            # First job — assume ~3min, ramp up smoothly
                            est = min(elapsed / 180, 0.95) * cfg.sample_steps
                        progress.update(gen_task, completed=int(est))
                        time.sleep(0.5)
                    progress.update(gen_task, completed=cfg.sample_steps)

                if gen_error[0]:
                    raise gen_error[0]

                gen_dur = time.monotonic() - t_gen
                total_gen_time += gen_dur
                vid_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
                console.print(f"  [green]Generated[/] {_fmt_size(vid_size)} in {_fmt_duration(gen_dur)}")

                # Upload
                with console.status("  [cyan]Uploading video...[/]", spinner="dots"):
                    t_up = time.monotonic()
                    _upload_result(backend_url, job_id, output_path, None)
                    up_dur = time.monotonic() - t_up
                console.print(f"  [green]Uploaded[/] in {_fmt_duration(up_dur)}")

                jobs_completed += 1
                total_dur = time.monotonic() - t0
                console.print(f"  [bold green]Done[/] in {_fmt_duration(total_dur)}")
                console.print(_build_stats_table(jobs_completed, jobs_failed, total_gen_time, session_start))

            except Exception as e:
                console.print(f"  [bold red]Failed:[/] {e}")
                _upload_result(backend_url, job_id, None, str(e))
                jobs_failed += 1


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        _allow_sleep()
        console.print("\n  [bold yellow]Interrupted[/] — shutting down gracefully")
        console.print("  [dim]Wake lock released, GPU idle[/]\n")
        sys.exit(0)
