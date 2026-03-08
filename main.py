import json
import os
import platform
from pathlib import Path

import click
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn

from src.models import Story
from src.utils.config import build_config, load_character, load_style
from src.utils.io import slugify

load_dotenv()

# Homebrew libraries (pango/gobject) need to be discoverable for WeasyPrint
if platform.system() == "Darwin":
    brew_lib = "/opt/homebrew/lib"
    if os.path.isdir(brew_lib):
        os.environ.setdefault("DYLD_FALLBACK_LIBRARY_PATH", brew_lib)

console = Console()

CHECKPOINT_FILE = "story.json"


def _save_checkpoint(output_dir: Path, story: Story, image_paths: list[str] | None = None):
    """Save pipeline state so we can resume later."""
    output_dir.mkdir(parents=True, exist_ok=True)
    data = {
        "story": story.model_dump(),
        "image_paths": image_paths or [],
    }
    (output_dir / CHECKPOINT_FILE).write_text(json.dumps(data, indent=2))


def _load_checkpoint(output_dir: Path) -> tuple[Story, list[Path]]:
    """Load saved pipeline state."""
    data = json.loads((output_dir / CHECKPOINT_FILE).read_text())
    story = Story.model_validate(data["story"])
    image_paths = [Path(p) for p in data.get("image_paths", [])]
    return story, image_paths


@click.group()
def cli():
    """StarlightScribe - Turn daily notes into illustrated children's books."""
    pass


@cli.command()
@click.argument("notes_file", type=click.Path(exists=True, path_type=Path))
@click.option("--character", "-c", default=None, help="Character config name (e.g., lana-llama)")
@click.option("--narrator", "-n", default=None, type=click.Choice(["whimsical", "bedtime", "heroic"]))
@click.option("--style", "-s", default=None, type=click.Choice(["digital", "watercolor", "ghibli", "papercut"]))
@click.option("--pages", "-p", default=None, type=click.IntRange(8, 24))
@click.option("--output", "-o", default=None, type=click.Path(path_type=Path))
@click.option("--language", "-l", default=None, help="Translate story text (e.g., hungarian, german, french)")
@click.option("--resume", is_flag=True, help="Resume from last checkpoint (skip completed phases)")
def generate(notes_file: Path, character: str, narrator: str, style: str, pages: int, output: Path, language: str, resume: bool):
    """Generate a complete illustrated book from notes."""
    config = build_config(character=character, narrator=narrator, style=style, pages=pages, output=output)
    char = load_character(config.character)
    style_data = load_style(config.style)
    style_desc = style_data["description"]
    notes = notes_file.read_text().strip()

    if not notes:
        console.print("[red]Error: Notes file is empty.[/red]")
        raise SystemExit(1)

    story = None
    image_paths = []
    output_dir = None

    # Try to resume from checkpoint
    if resume:
        # Find the most recent story dir
        candidates = sorted(config.output.glob("*/story.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        if candidates:
            output_dir = candidates[0].parent
            story, image_paths = _load_checkpoint(output_dir)
            console.print(f"[yellow]Resuming from:[/yellow] {output_dir}")
            console.print(f"[yellow]Story:[/yellow] {story.title} ({len(story.keyframes)} pages)")
            if image_paths:
                existing = [p for p in image_paths if p.exists()]
                console.print(f"[yellow]Images:[/yellow] {len(existing)}/{len(image_paths)} already generated\n")
        else:
            console.print("[yellow]No checkpoint found, starting fresh.[/yellow]\n")

    # Phase 1 + 2: Story and keyframes
    if story is None:
        console.print(Panel(f"Generating story for [bold]{char.child_name}[/bold]...", title="Phase 1: Story"))
        with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), transient=True) as progress:
            progress.add_task("Writing story with Claude...", total=None)
            from src.brain.storyteller import generate_story
            title, prose = generate_story(notes, char, config, style_desc)

        console.print(f"[green]Title:[/green] {title}")
        console.print(f"[dim]({len(prose.split())} words)[/dim]\n")

        console.print(Panel("Breaking story into illustrated pages...", title="Phase 2: Keyframes"))
        with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), transient=True) as progress:
            progress.add_task("Extracting keyframes...", total=None)
            from src.brain.keyframer import generate_keyframes
            story = generate_keyframes(title, prose, char, config, style_desc)

        console.print(f"[green]Pages:[/green] {len(story.keyframes)}")
        cover_kf = next((kf for kf in story.keyframes if kf.is_cover), None)
        if cover_kf:
            console.print(f"[green]Cover page:[/green] {cover_kf.page_number}\n")

        # Save checkpoint after story + keyframes
        output_dir = config.output / slugify(story.title)
        _save_checkpoint(output_dir, story)
        console.print(f"[dim]Checkpoint saved to {output_dir / CHECKPOINT_FILE}[/dim]\n")

    # Phase 2b: Translation (if requested and not already done)
    if language and not story.title_translated:
        console.print(Panel(f"Translating to [bold]{language}[/bold]...", title="Phase 2b: Translation"))
        with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), transient=True) as progress:
            progress.add_task(f"Translating with Claude...", total=None)
            from src.brain.translator import translate_story
            story = translate_story(story, language, config)

        console.print(f"[green]Translated title:[/green] {story.title_translated}")
        _save_checkpoint(output_dir, story)
        console.print(f"[dim]Checkpoint updated with translation[/dim]\n")

    images_dir = output_dir / "images"

    style_anchor = style_data.get("anchor", style_desc)

    # Phase 3: Illustration (skips already-generated images)
    console.print(Panel("Generating illustrations with Gemini...", title="Phase 3: Art"))
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("{task.completed}/{task.total}"),
    ) as progress:
        from src.artist.generator import generate_all_illustrations
        image_paths = generate_all_illustrations(
            story.keyframes, char, config, style_anchor, images_dir, progress,
            title=story.title,
        )

    # Update checkpoint with image paths
    _save_checkpoint(output_dir, story, [str(p) for p in image_paths])
    console.print(f"[green]Images saved to:[/green] {images_dir}\n")

    # Phase 3b: Backdrops for text pages
    backdrops_dir = output_dir / "backdrops"
    console.print(Panel("Generating text page backdrops...", title="Phase 3b: Backdrops"))
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("{task.completed}/{task.total}"),
    ) as progress:
        from src.artist.generator import generate_backdrops
        backdrop_paths = generate_backdrops(config, style_anchor, backdrops_dir, progress=progress)

    console.print(f"[green]Backdrops:[/green] {len(backdrop_paths)} generated\n")

    # Phase 4: PDF assembly
    _render_pdf(story, image_paths, output_dir, backdrop_paths)


def _render_pdf(story: Story, image_paths: list[Path], output_dir: Path, backdrop_paths: list[Path] | None = None):
    """Render PDF from story data and images."""
    console.print(Panel("Assembling print-ready PDF...", title="Phase 4: PDF"))
    from src.publisher.layout import render_book_pdf
    pdf_path = output_dir / "book.pdf"
    render_book_pdf(story, image_paths, pdf_path, backdrop_paths)

    screen_pdf = pdf_path.with_stem(pdf_path.stem + "-screen")
    spread_pdf = pdf_path.with_stem(pdf_path.stem + "-spreads")

    def _size(p: Path) -> str:
        return f"{p.stat().st_size / 1024 / 1024:.1f} MB" if p.exists() else "n/a"

    console.print(f"\n[bold green]Book complete![/bold green]")
    console.print(f"  Print PDF:   {pdf_path} ({_size(pdf_path)})")
    if screen_pdf.exists():
        console.print(f"  Screen PDF:  {screen_pdf} ({_size(screen_pdf)})")
    if spread_pdf.exists():
        console.print(f"  Spread PDF:  {spread_pdf} ({_size(spread_pdf)})")
    console.print(f"  Images:      {output_dir / 'images'}")


@cli.command()
@click.argument("story_dir", type=click.Path(exists=True, path_type=Path))
@click.option("--language", "-l", default=None, help="Translate story text (e.g., hungarian, german, french)")
def pdf(story_dir: Path, language: str):
    """Render PDF from an existing story folder (with story.json + images)."""
    checkpoint = story_dir / CHECKPOINT_FILE
    if not checkpoint.exists():
        console.print(f"[red]No {CHECKPOINT_FILE} found in {story_dir}.[/red]")
        raise SystemExit(1)

    story, image_paths = _load_checkpoint(story_dir)
    console.print(f"[green]Story:[/green] {story.title} ({len(story.keyframes)} pages)")

    # Translate if requested and not already done
    if language and not story.title_translated:
        from src.utils.config import build_config
        config = build_config()
        console.print(Panel(f"Translating to [bold]{language}[/bold]...", title="Translation"))
        with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), transient=True) as progress:
            progress.add_task("Translating with Claude...", total=None)
            from src.brain.translator import translate_story
            story = translate_story(story, language, config)
        console.print(f"[green]Translated title:[/green] {story.title_translated}")
        _save_checkpoint(story_dir, story, [str(p) for p in image_paths])
    elif story.title_translated:
        console.print(f"[green]Translation:[/green] {story.title_translated}")

    missing = [p for p in image_paths if not p.exists()]
    if missing:
        console.print(f"[red]Missing {len(missing)} images. Run 'generate --resume' first.[/red]")
        raise SystemExit(1)

    # Discover backdrops if they exist
    backdrops_dir = story_dir / "backdrops"
    backdrop_paths = sorted(backdrops_dir.glob("backdrop_*.png")) if backdrops_dir.exists() else []
    # Filter out raw files
    backdrop_paths = [p for p in backdrop_paths if "_raw" not in p.name]

    if backdrop_paths:
        console.print(f"[green]Backdrops:[/green] {len(backdrop_paths)} found")

    _render_pdf(story, image_paths, story_dir, backdrop_paths or None)


@cli.command()
@click.argument("notes_file", type=click.Path(exists=True, path_type=Path))
@click.option("--character", "-c", default=None, help="Character config name")
@click.option("--narrator", "-n", default=None, type=click.Choice(["whimsical", "bedtime", "heroic"]))
@click.option("--style", "-s", default=None, type=click.Choice(["digital", "watercolor", "ghibli", "papercut"]))
@click.option("--pages", "-p", default=None, type=click.IntRange(8, 24))
def preview(notes_file: Path, character: str, narrator: str, style: str, pages: int):
    """Preview story and keyframes without generating images (fast, cheap)."""
    config = build_config(character=character, narrator=narrator, style=style, pages=pages)
    char = load_character(config.character)
    style_data = load_style(config.style)
    style_desc = style_data["description"]
    notes = notes_file.read_text().strip()

    if not notes:
        console.print("[red]Error: Notes file is empty.[/red]")
        raise SystemExit(1)

    # Phase 1
    console.print(Panel(f"Generating story for [bold]{char.child_name}[/bold]...", title="Phase 1: Story"))
    with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), transient=True) as progress:
        progress.add_task("Writing story with Claude...", total=None)
        from src.brain.storyteller import generate_story
        title, prose = generate_story(notes, char, config, style_desc)

    console.print(Panel(f"[bold]{title}[/bold]\n\n{prose}", title="Story Preview", border_style="blue"))
    console.print(f"[dim]({len(prose.split())} words)[/dim]\n")

    # Phase 2
    console.print(Panel("Breaking story into illustrated pages...", title="Phase 2: Keyframes"))
    with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), transient=True) as progress:
        progress.add_task("Extracting keyframes...", total=None)
        from src.brain.keyframer import generate_keyframes
        story = generate_keyframes(title, prose, char, config, style_desc)

    for kf in story.keyframes:
        marker = " [yellow][COVER][/yellow]" if kf.is_cover else ""
        console.print(Panel(
            f"[bold]Text:[/bold] {kf.page_text}\n\n"
            f"[bold]Visual:[/bold] [dim]{kf.visual_description}[/dim]\n\n"
            f"[bold]Mood:[/bold] {kf.mood}",
            title=f"Page {kf.page_number}{marker}",
            border_style="green" if kf.is_cover else "dim",
        ))

    console.print(f"\n[bold]Total pages:[/bold] {len(story.keyframes)}")
    console.print("[dim]Run 'starlight generate' to create illustrations and PDF.[/dim]")


@cli.group()
def characters():
    """Manage character configurations."""
    pass


@characters.command("list")
def list_characters():
    """List available character configurations."""
    from src.utils.config import CHARACTERS_DIR

    if not CHARACTERS_DIR.exists():
        console.print("[yellow]No characters directory found.[/yellow]")
        return

    for path in sorted(CHARACTERS_DIR.glob("*.toml")):
        try:
            char = load_character(path.stem)
            console.print(f"  [bold]{path.stem}[/bold] - {char.name} (for {char.child_name})")
        except Exception as e:
            console.print(f"  [red]{path.stem}[/red] - Error: {e}")


if __name__ == "__main__":
    cli()
