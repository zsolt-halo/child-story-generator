import os
import platform
from pathlib import Path

import click
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn

from src.models import Story
from src.utils.config import build_config, load_character, load_style, resolve_character
from src.utils.io import slugify

load_dotenv()

# Native libraries (pango/gobject) need to be discoverable for WeasyPrint
if platform.system() == "Darwin":
    brew_lib = "/opt/homebrew/lib"
    if os.path.isdir(brew_lib):
        os.environ.setdefault("DYLD_FALLBACK_LIBRARY_PATH", brew_lib)
elif platform.system() == "Windows":
    # MSYS2 UCRT64 provides GTK/Pango DLLs needed by WeasyPrint
    msys2_bin = r"C:\msys64\ucrt64\bin"
    if os.path.isdir(msys2_bin):
        os.add_dll_directory(msys2_bin)
        os.environ["PATH"] = msys2_bin + os.pathsep + os.environ.get("PATH", "")

console = Console()


def _get_repo():
    """Lazy-import repository to avoid DB connection when not needed."""
    from src.db.repository import StoryRepository
    return StoryRepository()


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
@click.option("--model", "-m", default=None, help="Text model override (default: gemini-2.5-pro)")
def generate(notes_file: Path, character: str, narrator: str, style: str, pages: int, output: Path, language: str, resume: bool, model: str):
    """Generate a complete illustrated book from notes."""
    config = build_config(character=character, narrator=narrator, style=style, pages=pages, output=output, text_model=model)
    char = resolve_character(config.character)
    style_data = load_style(config.style)
    style_desc = style_data["description"]
    notes = notes_file.read_text().strip()

    if not notes:
        console.print("[red]Error: Notes file is empty.[/red]")
        raise SystemExit(1)

    repo = _get_repo()
    story = None
    image_paths = []
    output_dir = None
    slug = None

    # Try to resume from checkpoint
    if resume:
        # Find the most recent story dir
        candidates = sorted(config.output.glob("*/story.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        if candidates:
            output_dir = candidates[0].parent
            slug = output_dir.name
            try:
                story, image_paths = repo.get(slug)
                console.print(f"[yellow]Resuming from:[/yellow] {output_dir}")
                console.print(f"[yellow]Story:[/yellow] {story.title} ({len(story.keyframes)} pages)")
                if image_paths:
                    existing = [p for p in image_paths if p.exists()]
                    console.print(f"[yellow]Images:[/yellow] {len(existing)}/{len(image_paths)} already generated\n")
            except FileNotFoundError:
                # DB doesn't have it — try JSON fallback for migration period
                from src.utils.io import load_checkpoint
                story, image_paths = load_checkpoint(output_dir)
                console.print(f"[yellow]Resuming from JSON checkpoint:[/yellow] {output_dir}")
        else:
            console.print("[yellow]No checkpoint found, starting fresh.[/yellow]\n")

    # Phase 1 + 2: Story and keyframes
    if story is None:
        console.print(Panel(f"Generating story for [bold]{char.child_name}[/bold]...", title="Phase 1: Story"))
        with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), transient=True) as progress:
            progress.add_task("Writing story with Gemini...", total=None)
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

        # Save to DB with metadata
        output_dir = config.output / slugify(story.title)
        slug = output_dir.name
        from datetime import datetime
        metadata = {
            "notes": notes,
            "config": {
                "character": config.character,
                "narrator": config.narrator,
                "style": config.style,
                "pages": config.pages,
                "language": language or None,
            },
            "parent_slug": None,
            "created_at": datetime.now().isoformat(),
        }
        repo.save(slug, story, metadata=metadata)
        console.print(f"[dim]Saved to database: {slug}[/dim]\n")

    # Phase 2.5: Cast Extraction (character consistency)
    if not story.cast:
        console.print(Panel("Extracting character cast for visual consistency...", title="Phase 2.5: Cast"))
        with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), transient=True) as progress:
            progress.add_task("Analyzing characters with Gemini...", total=None)
            from src.brain.cast_extractor import extract_cast
            story = extract_cast(story, char, config)

        if story.cast:
            console.print(f"[green]Cast members:[/green] {len(story.cast)}")
            for member in story.cast:
                pages_str = ", ".join(str(p) for p in member.appears_on_pages)
                console.print(f"  [dim]{member.name}[/dim] ({member.species}) — pages {pages_str}")
            repo.save(slug, story)
            console.print(f"[dim]Database updated with cast[/dim]\n")
        else:
            console.print("[dim]No secondary characters found[/dim]\n")

    # Phase 2b: Translation (if requested and not already done)
    if language and not story.title_translated:
        console.print(Panel(f"Translating to [bold]{language}[/bold]...", title="Phase 2b: Translation"))
        with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), transient=True) as progress:
            progress.add_task(f"Translating with Gemini...", total=None)
            from src.brain.translator import translate_story
            story = translate_story(story, language, config)

        console.print(f"[green]Translated title:[/green] {story.title_translated}")
        repo.save(slug, story)
        console.print(f"[dim]Database updated with translation[/dim]\n")

    images_dir = output_dir / "images"

    style_anchor = style_data.get("anchor", style_desc)

    # Phase 2c: Reference Sheet
    console.print(Panel("Generating character reference sheet...", title="Phase 2c: Reference Sheet"))
    with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), transient=True) as progress:
        progress.add_task("Creating character model sheet with Gemini...", total=None)
        from src.artist.generator import generate_reference_sheet, load_reference_sheet
        ref_path = generate_reference_sheet(char, style_anchor, config, images_dir)

    if ref_path:
        console.print(f"[green]Reference sheet:[/green] {ref_path}")
    else:
        console.print("[yellow]Reference sheet generation failed, continuing without it[/yellow]")

    ref_bytes = load_reference_sheet(images_dir)
    console.print()

    cover_title = story.title_translated or story.title

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
            title=cover_title, cast=story.cast or None,
            reference_image=ref_bytes,
        )

    # Update DB with image paths
    repo.save(slug, story, [str(p) for p in image_paths])
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
    """Render PDF from an existing story folder (with images)."""
    slug = story_dir.name
    repo = _get_repo()

    try:
        story, image_paths = repo.get(slug)
    except FileNotFoundError:
        # Fallback to JSON checkpoint for migration period
        from src.utils.io import load_checkpoint, CHECKPOINT_FILE
        checkpoint = story_dir / CHECKPOINT_FILE
        if not checkpoint.exists():
            console.print(f"[red]Story not found in database or on disk: {slug}[/red]")
            raise SystemExit(1)
        story, image_paths = load_checkpoint(story_dir)

    console.print(f"[green]Story:[/green] {story.title} ({len(story.keyframes)} pages)")

    # Translate if requested and not already done
    if language and not story.title_translated:
        meta = repo.get_metadata(slug)
        if meta and meta.get("config"):
            mc = meta["config"]
            config = build_config(character=mc.get("character"), narrator=mc.get("narrator"),
                                  style=mc.get("style"), pages=mc.get("pages"))
        else:
            config = build_config()
        console.print(Panel(f"Translating to [bold]{language}[/bold]...", title="Translation"))
        with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), transient=True) as progress:
            progress.add_task("Translating with Gemini...", total=None)
            from src.brain.translator import translate_story
            story = translate_story(story, language, config)
        console.print(f"[green]Translated title:[/green] {story.title_translated}")
        repo.save(slug, story, [str(p) for p in image_paths])
    elif story.title_translated:
        console.print(f"[green]Translation:[/green] {story.title_translated}")

    missing = [p for p in image_paths if not p.exists()]
    if missing:
        console.print(f"[red]Missing {len(missing)} images. Run 'generate --resume' first.[/red]")
        raise SystemExit(1)

    from src.utils.io import discover_backdrops
    backdrop_paths = discover_backdrops(story_dir)

    if backdrop_paths:
        console.print(f"[green]Backdrops:[/green] {len(backdrop_paths)} found")

    _render_pdf(story, image_paths, story_dir, backdrop_paths or None)


@cli.command()
@click.argument("notes_file", type=click.Path(exists=True, path_type=Path))
@click.option("--character", "-c", default=None, help="Character config name")
@click.option("--narrator", "-n", default=None, type=click.Choice(["whimsical", "bedtime", "heroic"]))
@click.option("--style", "-s", default=None, type=click.Choice(["digital", "watercolor", "ghibli", "papercut"]))
@click.option("--pages", "-p", default=None, type=click.IntRange(8, 24))
@click.option("--model", "-m", default=None, help="Text model override (default: gemini-2.5-pro)")
def preview(notes_file: Path, character: str, narrator: str, style: str, pages: int, model: str):
    """Preview story and keyframes without generating images (fast, cheap)."""
    config = build_config(character=character, narrator=narrator, style=style, pages=pages, text_model=model)
    char = resolve_character(config.character)
    style_data = load_style(config.style)
    style_desc = style_data["description"]
    notes = notes_file.read_text().strip()

    if not notes:
        console.print("[red]Error: Notes file is empty.[/red]")
        raise SystemExit(1)

    # Phase 1
    console.print(Panel(f"Generating story for [bold]{char.child_name}[/bold]...", title="Phase 1: Story"))
    with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), transient=True) as progress:
        progress.add_task("Writing story with Gemini...", total=None)
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


@cli.command()
@click.option("--host", default="127.0.0.1", help="Host to bind to")
@click.option("--port", default=8000, type=int, help="Port to bind to")
@click.option("--reload", is_flag=True, help="Enable auto-reload for development")
def serve(host: str, port: int, reload: bool):
    """Start the web UI server."""
    try:
        import uvicorn
    except ImportError:
        console.print("[red]Web dependencies not installed. Run: uv sync --extra web[/red]")
        raise SystemExit(1)

    console.print(f"[bold green]Starting StarlightScribe Web UI[/bold green]")
    console.print(f"  Server: http://{host}:{port}")
    console.print(f"  API docs: http://{host}:{port}/docs")

    uvicorn.run(
        "server.app:app",
        host=host,
        port=port,
        reload=reload,
    )


if __name__ == "__main__":
    cli()
