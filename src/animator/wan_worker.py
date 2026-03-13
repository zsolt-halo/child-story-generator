"""Wan 2.2 TI2V-5B subprocess worker.

Communicates via JSONL on stdin/stdout. Loads the model once,
processes image→video jobs sequentially, and exits on stdin EOF.

Protocol:
  IN  (one JSON per line): {"image_path": "...", "output_path": "...", "prompt": "..."}
  OUT (one JSON per line): {"status": "ok", "output_path": "..."} | {"status": "error", "error": "..."}
"""

import json
import logging
import sys
import warnings

warnings.filterwarnings("ignore")

logging.basicConfig(
    level=logging.INFO,
    format="[wan-worker %(asctime)s] %(levelname)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger(__name__)

# Wan 2.2 repo root — needed to import wan
WAN_REPO = "C:/Users/netzs/codes/Wan2.2"
MODEL_DIR = f"{WAN_REPO}/Wan2.2-TI2V-5B"
SIZE = "1280*704"


def _load_pipeline():
    """Load the Wan TI2V pipeline once."""
    import torch
    sys.path.insert(0, WAN_REPO)
    import wan
    from wan.configs import WAN_CONFIGS, SIZE_CONFIGS, MAX_AREA_CONFIGS

    cfg = WAN_CONFIGS["ti2v-5B"]
    logger.info("Loading Wan TI2V-5B model from %s ...", MODEL_DIR)

    pipeline = wan.WanTI2V(
        config=cfg,
        checkpoint_dir=MODEL_DIR,
        device_id=0,
        rank=0,
        t5_fsdp=False,
        dit_fsdp=False,
        use_sp=False,
        t5_cpu=False,
    )
    logger.info("Model loaded successfully.")
    return pipeline, cfg, SIZE_CONFIGS[SIZE], MAX_AREA_CONFIGS[SIZE]


def _generate_one(pipeline, cfg, size_cfg, max_area, image_path: str, output_path: str, prompt: str):
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


def main():
    pipeline, cfg, size_cfg, max_area = _load_pipeline()

    logger.info("Worker ready, waiting for jobs on stdin...")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            job = json.loads(line)
            image_path = job["image_path"]
            output_path = job["output_path"]
            prompt = job["prompt"]

            logger.info("Generating: %s -> %s", image_path, output_path)
            _generate_one(pipeline, cfg, size_cfg, max_area, image_path, output_path, prompt)
            result = {"status": "ok", "output_path": output_path}
        except Exception as e:
            logger.error("Job failed: %s", e, exc_info=True)
            result = {"status": "error", "error": str(e)}

        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()

    logger.info("stdin closed, worker exiting.")


if __name__ == "__main__":
    main()
