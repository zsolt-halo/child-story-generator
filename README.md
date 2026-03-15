# StarlightScribe

Turn rough parenting notes into hardcover illustrated children's books.

You write *"We went to the park and Lana fed the ducks"* — StarlightScribe turns it into a 32-page picture book with full-page illustrations, decorative text pages, and a print-ready PDF you can send to a print shop.

## How It Works

```
notes.txt → [Story] → [Keyframes] → [Cast + Ref Sheets] → [Translation] → [Cover Variations] → [Illustration] → [PDF] → [Animation]
```

| Phase | Tool | What happens | Cost |
|-------|------|-------------|------|
| 1. Story | Gemini 2.5 Pro | Notes expanded into 800-1500 words of grounded fantasy | ~$0.06 |
| 2. Keyframes | Gemini 2.5 Pro | Story split into 16 structured pages with visual descriptions | ~$0.10 |
| 3. Cast + Ref Sheets | Gemini 2.5 Flash | Secondary characters extracted, reference sheets generated | ~$0.10 |
| 4. Translation | Gemini 2.5 Pro | Full story translated (e.g. English → Hungarian) | ~$0.04 |
| 5. Illustration | Gemini 2.5 Flash | 16 images + cover + 4 backdrops, upscaled to 300 DPI | ~$0.80 |
| 6. PDF | WeasyPrint | Three PDFs: print-ready, screen, and spread preview | free |
| 7. Animation | Wan 2.2 (local) | Per-page video clips from illustrations | free |

**Total per book: ~$1.10** (animation free with local GPU)

## Web UI

The web interface provides an interactive pipeline with three review gates:

1. **Story Review** — Serpentine flowchart of all keyframes; edit text before illustration
2. **Cast Review** — View/edit secondary characters with AI-generated reference sheets; regenerate individual sheets
3. **Cover Selection** — Pick from 3 cover art variations

Additional features:
- **Characters** — Create custom characters, upload photos, build family trees with persistent members across stories
- **Surprise Me** — One-click auto-generation with presets (generates premise + full pipeline)
- **Read Along** — Shareable fullscreen view with auto-play, keyboard navigation, and video support
- **Animation** — Optional per-page video generation using Wan 2.2 TI2V-5B (local GPU)
- **Branching** — Create story variants with different styles or re-illustration

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

### Web UI

```bash
# Install with web dependencies
uv sync --extra web

# Set up API keys
cp .env.example .env
# Edit .env with GEMINI_API_KEY + DATABASE_URL

# Start the server (API + built frontend on :8000)
uvicorn server.app:app --host 127.0.0.1 --port 8000

# Or run in dev mode (Vite HMR on :5173, proxied to :8000)
cd web && npm run dev
```

### Docker

```bash
# Full stack (connects to external PostgreSQL)
docker compose up -d

# With observability (Grafana + Tempo)
OTEL_EXPORTER=otlp docker compose --profile observability up --build -d

# With local PostgreSQL (offline mode)
docker compose --profile offline up -d

# With animation worker (requires NVIDIA GPU)
docker compose --profile animation up -d
```

## Configuration

### API Keys (`.env`)

```bash
# Required — powers all text and image generation
GEMINI_API_KEY=your-gemini-api-key

# Database (PostgreSQL)
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/starlight
```

### Characters

Three built-in TOML templates in `configs/characters/`:

| Config | Character | Traits |
|--------|-----------|--------|
| `lana-llama` | Luna the Llama | Curious, clumsy, Andean scarf |
| `lana-cat` | Duchess Whiskers | Sassy, brave, tiny gold crown |
| `lana-princess` | Princess Mudboots | Adventurous, yellow cape, wooden sword |

Custom characters can be created in the Web UI with AI-powered "polish", photo upload, color palettes, and family trees.

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

## System Requirements

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) for package management
- macOS: `brew install pango ghostscript`
- A Google Gemini API key ([get one here](https://aistudio.google.com/apikey))
- PostgreSQL 16+ (for Web UI)
- Optional: NVIDIA GPU with 24GB+ VRAM for animation (Wan 2.2 TI2V-5B)

## Project Structure

```
├── CLAUDE.md                        # AI assistant instructions
├── configs/
│   ├── characters/*.toml            # Character sheets (3 built-in)
│   ├── styles.toml                  # Art style presets
│   └── settings.toml                # Runtime config
├── src/
│   ├── models.py                    # Pydantic models
│   ├── brain/
│   │   ├── client.py                # Gemini client (text + structured output)
│   │   ├── storyteller.py           # Phase 1: notes → prose
│   │   ├── keyframer.py             # Phase 2: prose → keyframes
│   │   ├── translator.py            # Phase 3: translation
│   │   └── prompts.py               # Narrator personas + system prompts
│   ├── artist/
│   │   └── generator.py             # Gemini 2.5 Flash images + backdrops
│   ├── animator/
│   │   ├── generator.py             # Animation bridge (local/remote modes)
│   │   └── wan_worker.py            # Wan 2.2 TI2V-5B subprocess worker
│   ├── publisher/
│   │   ├── layout.py                # PDF rendering (3 variants)
│   │   ├── templates/
│   │   │   ├── page.html            # Print layout (8.25×8.25")
│   │   │   └── spread.html          # Landscape spread preview
│   │   ├── cover.py                 # Cover composition (legacy)
│   │   └── color.py                 # RGB → CMYK conversion
│   ├── db/
│   │   ├── engine.py                # Async connection factory
│   │   ├── models.py                # SQLAlchemy ORM models
│   │   ├── repository.py            # Story CRUD (async)
│   │   ├── character_repository.py  # Character CRUD (async)
│   │   └── family_repository.py     # Family tree links
│   └── utils/
│       ├── config.py                # TOML config loader + character resolver
│       └── io.py                    # File helpers (slugify, ensure_dir)
├── server/
│   ├── app.py                       # FastAPI application
│   ├── telemetry.py                 # OpenTelemetry setup
│   ├── routers/                     # API endpoints
│   │   ├── pipeline.py              # Pipeline orchestration + SSE
│   │   ├── stories.py               # Story CRUD + file serving
│   │   ├── characters.py            # Character management + family
│   │   ├── worker.py                # Animation worker poll API
│   │   ├── presets.py               # Auto-generation presets
│   │   └── sanity.py                # Sanity checks + auto-fix
│   └── services/                    # Business logic
│       ├── pipeline_service.py      # Full pipeline orchestration
│       ├── story_service.py         # Story CRUD + branching
│       ├── character_service.py     # Character + family tree logic
│       ├── animation_queue.py       # In-memory animation job queue
│       ├── task_manager.py          # Async task manager + SSE events
│       └── preset_service.py        # Preset CRUD
├── web/                             # React + Vite + Tailwind frontend
│   └── src/
│       ├── pages/                   # 9 pages (Dashboard, Pipeline, ReadAlong, etc.)
│       ├── components/              # UI components (45+)
│       ├── stores/                  # Zustand state management
│       └── api/                     # API client + types
├── alembic/                         # Database migrations (001-010)
├── k8s/                             # Kubernetes manifests
├── scripts/
│   └── animation_worker.py          # Pull-based remote animation worker
├── docker-compose.yml               # Multi-service with profiles
├── Dockerfile                       # Backend image
├── Dockerfile.worker                # Animation worker image
├── examples/                        # Sample input files
└── stories/                         # Generated books
    └── <story-slug>/
        ├── story.json               # Checkpoint
        ├── book.pdf                 # Print-ready
        ├── book-screen.pdf          # For sharing
        ├── book-spreads.pdf         # Spread preview
        ├── images/                  # Illustrations + reference sheets
        ├── backdrops/               # Text page backgrounds
        └── videos/                  # Animated page clips (optional)
```
