# StarlightScribe

Turn rough parenting notes into hardcover illustrated children's books.

You write *"We went to the park and Lana fed the ducks"* — StarlightScribe turns it into a 32-page picture book with full-page illustrations, decorative text pages, and a print-ready PDF you can send to a print shop.

## How It Works

```
notes.txt → [Story] → [Keyframes] → [Translation] → [Illustration] → [PDF]
```

| Phase | Tool | What happens | Cost |
|-------|------|-------------|------|
| 1. Story | Claude Opus 4.6 | Notes expanded into 800-1500 words of grounded fantasy | ~$0.07 |
| 2. Keyframes | Claude Opus 4.6 | Story split into 16 structured pages with visual descriptions | ~$0.12 |
| 2b. Translation | Claude Opus 4.6 | Full story translated (e.g. English → Hungarian) | ~$0.10 |
| 3. Illustration | Gemini | 16 images generated + 4 decorative backdrops, upscaled to 300 DPI | ~$0.60 |
| 4. PDF | WeasyPrint | Three PDFs: print-ready, screen, and spread preview | free |

**Total per book: ~$0.89**

## Layout

The book uses a **spread layout** — each story beat becomes two pages:

- **Left page**: Full-bleed illustration
- **Right page**: Story text with decorative backdrop at low opacity

The cover image includes the title text, generated directly by the AI.

Three PDF variants are produced:

| File | Size | Purpose |
|------|------|---------|
| `book.pdf` | ~90 MB | Print-ready: 300 DPI, 8.25×8.25" with bleed + crop marks |
| `book-screen.pdf` | ~3 MB | Sharing via email/messaging (120 DPI) |
| `book-spreads.pdf` | ~4 MB | Landscape spread preview — how the open book looks |

## Quick Start

```bash
# Install dependencies
uv sync

# Set up API keys
cp .env.example .env
# Edit .env with your keys

# Preview a story (text only, no images — fast and cheap)
uv run python main.py preview examples/dance-and-vaccination.txt

# Generate a full book
uv run python main.py generate examples/dance-and-vaccination.txt

# Generate with translation
uv run python main.py generate examples/dance-and-vaccination.txt --language hungarian

# Re-render PDF from existing story
uv run python main.py pdf stories/luna-and-the-bravest-day-of-all/

# Translate an existing story and render
uv run python main.py pdf stories/luna-and-the-bravest-day-of-all/ --language hungarian
```

## Configuration

### API Keys (`.env`)

```bash
# Option 1: Direct Anthropic API
ANTHROPIC_API_KEY=sk-ant-...

# Option 2: Corporate API Gateway
GATEWAY_BASE_URL=https://your-gateway.example.com/anthropic
GATEWAY_API_KEY=your-gateway-key

# Image generation (required)
GEMINI_API_KEY=your-gemini-api-key
```

### Characters

Characters are defined as TOML files in `configs/characters/`:

| Config | Character | Traits |
|--------|-----------|--------|
| `lana-llama` | Luna the Llama | Curious, clumsy, Andean scarf |
| `lana-cat` | Duchess Whiskers | Sassy, brave, tiny gold crown |
| `lana-princess` | Princess Mudboots | Adventurous, yellow cape, wooden sword |

### Art Styles

Four presets in `configs/styles.toml`:

- **digital** — Clean, modern, vibrant colors (default)
- **watercolor** — Soft washes, Beatrix Potter feel
- **ghibli** — Lush, detailed, Miyazaki-inspired
- **papercut** — Bold shapes, Eric Carle style

### Narrator Voices

| Voice | Tone |
|-------|------|
| `whimsical` | Roald Dahl wordplay (default) |
| `bedtime` | Warm, lullaby pacing |
| `heroic` | Bold fairy tale |

## CLI Reference

```bash
uv run python main.py generate <notes.txt> [options]
  -c, --character    Character config name (e.g., lana-llama)
  -n, --narrator     whimsical | bedtime | heroic
  -s, --style        digital | watercolor | ghibli | papercut
  -p, --pages        Target page count (8-24, default: 16)
  -l, --language     Translate text (e.g., hungarian, german, french)
  -o, --output       Output directory
  --resume           Resume from last checkpoint

uv run python main.py pdf <story_dir> [options]
  -l, --language     Translate text before rendering

uv run python main.py preview <notes.txt> [options]
  Same options as generate (no images produced)

uv run python main.py characters list
```

## System Requirements

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) for package management
- macOS: `brew install pango ghostscript`
- A Google Gemini API key ([get one here](https://aistudio.google.com/apikey))
- An Anthropic API key or corporate gateway access

## Project Structure

```
├── main.py                          # CLI entry point
├── CLAUDE.md                        # AI assistant instructions
├── configs/
│   ├── characters/*.toml            # Character sheets
│   ├── styles.toml                  # Art style presets
│   └── settings.toml                # Runtime config
├── src/
│   ├── models.py                    # Pydantic models
│   ├── brain/
│   │   ├── client.py                # Anthropic client (direct / gateway)
│   │   ├── storyteller.py           # Phase 1: notes → prose
│   │   ├── keyframer.py             # Phase 2: prose → keyframes
│   │   ├── translator.py            # Phase 2b: translation
│   │   └── prompts.py               # Narrator personas
│   ├── artist/
│   │   └── generator.py             # Phase 3: Gemini images + backdrops
│   └── publisher/
│       ├── layout.py                # Phase 4: PDF rendering (3 variants)
│       ├── templates/
│       │   ├── page.html            # Print layout (8.25×8.25")
│       │   └── spread.html          # Landscape spread preview
│       ├── cover.py                 # Cover composition (legacy)
│       └── color.py                 # RGB → CMYK conversion
├── examples/                        # Sample input files
└── stories/                         # Generated books
    └── luna-and-the-bravest-day/
        ├── story.json               # Checkpoint (story + translations)
        ├── book.pdf                 # Print-ready
        ├── book-screen.pdf          # For sharing
        ├── book-spreads.pdf         # Spread preview
        ├── images/                  # Illustrations
        └── backdrops/               # Text page backgrounds
```
