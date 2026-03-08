from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def _load_font(font_path: Path | None, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if font_path and font_path.exists():
        return ImageFont.truetype(str(font_path), size)
    try:
        return ImageFont.truetype("Arial Bold.ttf", size)
    except OSError:
        try:
            return ImageFont.truetype("Arial.ttf", size)
        except OSError:
            return ImageFont.load_default(size=size)


def _fit_title_font(
    draw: ImageDraw.ImageDraw,
    title: str,
    max_width: int,
    start_size: int,
    font_path: Path | None,
) -> tuple[ImageFont.FreeTypeFont | ImageFont.ImageFont, int]:
    """Shrink font until title fits within max_width, or wrap to 2 lines."""
    for size in range(start_size, start_size // 3, -4):
        font = _load_font(font_path, size)
        bbox = draw.textbbox((0, 0), title, font=font)
        if bbox[2] - bbox[0] <= max_width:
            return font, 1
    # Still too wide — use multiline (split at middle space)
    font = _load_font(font_path, start_size * 2 // 3)
    return font, 2


def compose_cover(
    illustration_path: Path,
    title: str,
    author_line: str,
    output_path: Path,
    size: tuple[int, int] = (2400, 2400),
    font_path: Path | None = None,
) -> Path:
    """Composite a cover illustration with title and author text."""
    img = Image.open(illustration_path).convert("RGB")
    img = img.resize(size, Image.LANCZOS)
    draw = ImageDraw.Draw(img)

    margin = size[0] // 10  # 10% margin on each side
    max_title_w = size[0] - 2 * margin
    start_title_size = size[0] // 12

    title_font, lines = _fit_title_font(draw, title, max_title_w, start_title_size, font_path)
    author_font = _load_font(font_path, size[0] // 28)

    # Title at top
    title_y = size[1] // 10
    if lines == 1:
        bbox = draw.textbbox((0, 0), title, font=title_font)
        title_x = (size[0] - (bbox[2] - bbox[0])) // 2
        _draw_text_with_shadow(draw, (title_x, title_y), title, title_font)
    else:
        # Wrap into 2 lines at the best middle break point
        words = title.split()
        mid = len(words) // 2
        line1 = " ".join(words[:mid])
        line2 = " ".join(words[mid:])
        for line, y_off in [(line1, 0), (line2, 1)]:
            bbox = draw.textbbox((0, 0), line, font=title_font)
            lh = bbox[3] - bbox[1]
            lx = (size[0] - (bbox[2] - bbox[0])) // 2
            ly = title_y + y_off * int(lh * 1.2)
            _draw_text_with_shadow(draw, (lx, ly), line, title_font)

    # Author line at bottom
    author_bbox = draw.textbbox((0, 0), author_line, font=author_font)
    author_w = author_bbox[2] - author_bbox[0]
    author_x = (size[0] - author_w) // 2
    author_y = size[1] - size[1] // 8

    _draw_text_with_shadow(draw, (author_x, author_y), author_line, author_font)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path, quality=100)
    return output_path


def _draw_text_with_shadow(
    draw: ImageDraw.ImageDraw,
    position: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    text_color: str = "white",
    shadow_color: str = "black",
    shadow_offset: int = 3,
):
    x, y = position
    # Shadow
    draw.text((x + shadow_offset, y + shadow_offset), text, font=font, fill=shadow_color)
    # Main text
    draw.text((x, y), text, font=font, fill=text_color)
