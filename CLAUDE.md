# CLAUDE.md — Project Instructions for Claude Code

## Project: StarlightScribe
Children's book generator: raw parenting notes → illustrated hardcover picture book.

## Tech Stack & Tooling
- **Python 3.12+** managed with **uv** (never use pip/venv)
- **Claude Opus 4.6** for story generation, keyframing, and translation
- **Google Gemini API** for image generation (API key via `google-genai` SDK, NOT Vertex AI)
- **WeasyPrint** for HTML→PDF rendering
- **Ghostscript** for screen PDF compression
- **Pillow** for image upscaling and CMYK conversion

## Architecture
```
main.py                          # Click CLI entry point
src/
  models.py                      # Pydantic v2 models (Story, Keyframe, BookConfig, Character)
  brain/
    client.py                    # Anthropic client factory (direct API / corporate gateway)
    storyteller.py               # Phase 1: notes → prose
    keyframer.py                 # Phase 2: prose → structured keyframes
    translator.py                # Phase 2b: full story → target language
    prompts.py                   # System prompts for narrator personas
  artist/
    generator.py                 # Phase 3: Gemini image gen + backdrops + upscaling
  publisher/
    layout.py                    # Phase 4: PDF rendering (print + screen + spread)
    templates/page.html          # Print layout (8.25×8.25" with bleed)
    templates/spread.html        # Landscape spread preview (16×8")
    cover.py                     # Legacy Pillow cover composition (unused in current flow)
    color.py                     # RGB → CMYK conversion
  utils/
    config.py                    # TOML config loader
    io.py                        # File helpers (slugify, ensure_dir)
configs/
  characters/*.toml              # Character personality + visual sheets
  styles.toml                    # Art style presets (digital, watercolor, ghibli, papercut)
  settings.toml                  # Runtime defaults
```

## Pipeline Flow
1. **Story** — Claude expands notes into 800-1500 word prose
2. **Keyframes** — Claude breaks prose into 16 page-sized keyframes with visual descriptions (structured output via `messages.parse()`)
3. **Translation** (optional) — Claude translates all text with full story context (delimiter-based output, not JSON)
4. **Illustration** — Gemini generates images; cover prompt includes title text; all upscaled to 2400×2400
5. **Backdrops** — Gemini generates 4 decorative text-page backgrounds
6. **PDF** — WeasyPrint renders spread layout (illustration left, text right), produces 3 files:
   - `book.pdf` (~90 MB, 300 DPI, print-ready with bleed/crop marks)
   - `book-screen.pdf` (~3 MB, 120 DPI, for sharing)
   - `book-spreads.pdf` (~4 MB, landscape preview of how the book looks open)

## Checkpoint System
- `story.json` in each story folder saves pipeline state (story + translations + image paths)
- `--resume` flag skips completed phases
- Image generator skips existing files
- Translation is saved in checkpoint and reused on subsequent `pdf` runs

## Anthropic API Notes
- Supports direct API (`ANTHROPIC_API_KEY`) and corporate gateway (`GATEWAY_BASE_URL` + `GATEWAY_API_KEY`)
- Gateway auto-prefixes model with `anthropic/` (handled in `client.py`)
- Gateway does NOT support assistant message prefill
- Use `messages.parse()` with `output_format=PydanticModel` for structured output (attribute is `.parsed_output`)

## Key CLI Commands
```bash
uv run python main.py generate notes.txt                    # Full pipeline
uv run python main.py generate notes.txt --language hungarian  # With translation
uv run python main.py generate notes.txt --resume           # Resume from checkpoint
uv run python main.py pdf stories/my-story/                 # Re-render PDF only
uv run python main.py pdf stories/my-story/ -l hungarian    # Translate + render
uv run python main.py preview notes.txt                     # Story + keyframes only
uv run python main.py characters list                       # Show available characters
```

## Setup on New Machine
```bash
# 1. Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Install system dependencies (macOS)
brew install pango ghostscript

# 3. Install Python dependencies
uv sync

# 4. Configure API keys
cp .env.example .env
# Edit .env with ANTHROPIC_API_KEY (or GATEWAY_*) and GEMINI_API_KEY

# 5. Run
uv run python main.py generate examples/dance-and-vaccination.txt
```

## User Preferences
- User is Hungarian — stories written in English, translated to Hungarian for the child
- Use uv, never pip/venv
- Prefers Gemini API (simple API key) over Vertex AI
- Cost doesn't matter — pick best quality
