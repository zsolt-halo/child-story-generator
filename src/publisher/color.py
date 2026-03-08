from pathlib import Path

from PIL import Image, ImageCms

ASSETS_DIR = Path(__file__).parent.parent.parent / "assets"
PROFILES_DIR = ASSETS_DIR / "profiles"

SRGB_PROFILE = ImageCms.createProfile("sRGB")


def get_cmyk_profile() -> ImageCms.ImageCmsProfile:
    """Load FOGRA39 CMYK profile, or fall back to a generic CMYK transform."""
    fogra_path = PROFILES_DIR / "FOGRA39.icc"
    if fogra_path.exists():
        return ImageCms.getOpenProfile(str(fogra_path))
    # Fall back to USWebCoatedSWOP if bundled
    swop_path = PROFILES_DIR / "USWebCoatedSWOP.icc"
    if swop_path.exists():
        return ImageCms.getOpenProfile(str(swop_path))
    raise FileNotFoundError(
        f"No CMYK ICC profile found in {PROFILES_DIR}. "
        "Download FOGRA39.icc or USWebCoatedSWOP.icc and place it there."
    )


def convert_rgb_to_cmyk(input_path: Path, output_path: Path) -> Path:
    """Convert an RGB image to CMYK with embedded ICC profile."""
    img = Image.open(input_path)
    if img.mode == "CMYK":
        img.save(output_path)
        return output_path

    if img.mode != "RGB":
        img = img.convert("RGB")

    srgb = SRGB_PROFILE
    cmyk_profile = get_cmyk_profile()

    transform = ImageCms.buildTransform(
        srgb, cmyk_profile, "RGB", "CMYK", renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
    )

    cmyk_img = ImageCms.applyTransform(img, transform)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmyk_img.save(output_path)
    return output_path


def convert_all_to_cmyk(image_paths: list[Path], output_dir: Path) -> list[Path]:
    """Convert a list of RGB images to CMYK."""
    output_dir.mkdir(parents=True, exist_ok=True)
    cmyk_paths = []
    for p in image_paths:
        out = output_dir / f"{p.stem}_cmyk.tiff"
        convert_rgb_to_cmyk(p, out)
        cmyk_paths.append(out)
    return cmyk_paths
