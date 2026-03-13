import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path

from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML

from src.models import Keyframe, Story

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).parent / "templates"


@dataclass
class PageData:
    page_number: int
    page_text: str
    image_path: str
    is_cover: bool
    display_number: int


def _build_page_data(
    keyframes: list[Keyframe],
    image_paths: list[Path],
) -> list[PageData]:
    """Match keyframes to their images and build template-ready data."""
    pages: list[PageData] = []
    display_num = 1

    for kf, img_path in zip(keyframes, image_paths):
        pages.append(PageData(
            page_number=kf.page_number,
            page_text=kf.page_text_translated or kf.page_text,
            image_path=img_path.resolve().as_uri(),
            is_cover=kf.is_cover,
            display_number=0 if kf.is_cover else display_num,
        ))
        if not kf.is_cover:
            display_num += 1

    # Put cover page first
    pages.sort(key=lambda p: (not p.is_cover, p.page_number))
    return pages


def render_book_pdf(
    story: Story,
    image_paths: list[Path],
    output_path: Path,
    backdrop_paths: list[Path] | None = None,
) -> Path:
    """Render the final book PDF using WeasyPrint."""
    logger.info("Rendering PDF: %d pages, %d images → %s", len(story.keyframes), len(image_paths), output_path.name)
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))
    template = env.get_template("page.html")

    pages = _build_page_data(story.keyframes, image_paths)

    backdrops = []
    if backdrop_paths:
        backdrops = [p.resolve().as_uri() for p in backdrop_paths]

    html_content = template.render(
        title=story.title_translated or story.title,
        dedication=story.dedication_translated or story.dedication,
        pages=pages,
        backdrops=backdrops,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Write intermediate HTML for debugging
    html_path = output_path.with_suffix(".html")
    html_path.write_text(html_content, encoding="utf-8")

    HTML(string=html_content, base_url=str(TEMPLATES_DIR)).write_pdf(str(output_path))
    logger.info("Print PDF written: %s (%.1f MB)", output_path.name, output_path.stat().st_size / 1_048_576)

    # Generate a lightweight screen-quality PDF for sharing
    screen_path = output_path.with_stem(output_path.stem + "-screen")
    render_screen_pdf(output_path, screen_path)

    # Generate a landscape spread preview
    spread_path = output_path.with_stem(output_path.stem + "-spreads")
    render_spread_pdf(story, image_paths, spread_path, backdrop_paths)

    return output_path


def render_spread_pdf(
    story: Story,
    image_paths: list[Path],
    output_path: Path,
    backdrop_paths: list[Path] | None = None,
) -> Path:
    """Render a landscape spread preview for on-screen reading."""
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))
    template = env.get_template("spread.html")

    pages = _build_page_data(story.keyframes, image_paths)

    backdrops = []
    if backdrop_paths:
        backdrops = [p.resolve().as_uri() for p in backdrop_paths]

    html_content = template.render(
        title=story.title_translated or story.title,
        pages=pages,
        backdrops=backdrops,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    html_path = output_path.with_suffix(".html")
    html_path.write_text(html_content, encoding="utf-8")

    HTML(string=html_content, base_url=str(TEMPLATES_DIR)).write_pdf(str(output_path))

    # Compress for screen
    compressed = output_path.with_stem(output_path.stem + "-tmp")
    result = render_screen_pdf(output_path, compressed, dpi=150)
    if result and compressed.exists():
        compressed.replace(output_path)

    return output_path


def render_screen_pdf(print_pdf: Path, output_path: Path, dpi: int = 120) -> Path | None:
    """Compress print PDF to a screen-friendly size using PyMuPDF."""
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(str(print_pdf))
        doc.rewrite_images(
            dpi_threshold=max(dpi + 50, 200),
            dpi_target=dpi,
            quality=70,
            lossy=True,
            lossless=True,
        )
        doc.ez_save(str(output_path), garbage=4, deflate=True)
        doc.close()
        return output_path
    except Exception:
        logger.warning("PyMuPDF compression failed, trying Ghostscript", exc_info=True)
        # Fallback: try Ghostscript if PyMuPDF fails
        try:
            subprocess.run(
                [
                    "gs", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5",
                    "-dPDFSETTINGS=/ebook",
                    f"-dDownsampleColorImages=true", f"-dColorImageResolution={dpi}",
                    f"-dDownsampleGrayImages=true", f"-dGrayImageResolution={dpi}",
                    "-dNOPAUSE", "-dQUIET", "-dBATCH",
                    f"-sOutputFile={output_path}",
                    str(print_pdf),
                ],
                check=True,
                capture_output=True,
            )
            return output_path
        except (FileNotFoundError, subprocess.CalledProcessError):
            logger.warning("Screen PDF compression unavailable (no PyMuPDF or Ghostscript)")
            return None
