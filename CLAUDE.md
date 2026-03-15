# CLAUDE.md — Project Instructions for Claude Code

## Project: StarlightScribe
Children's book generator: raw parenting notes → illustrated hardcover picture book.
Web UI with interactive review pipeline (FastAPI + React).

## Tech Stack & Tooling
- **Python 3.12+** managed with **uv** (never use pip/venv)
- **Google Gemini API** for all generation — text (`gemini-2.5-pro`) and images (`gemini-2.5-flash-image`) via `google-genai` SDK (NOT Vertex AI)
- **Wan 2.2 TI2V-5B** for animation (local GPU, optional)
- **WeasyPrint** for HTML→PDF rendering
- **Ghostscript** for screen PDF compression
- **Pillow** for image upscaling and CMYK conversion
- **FastAPI** for web backend, **React 19 + Vite + Tailwind CSS v4** for frontend
- **PostgreSQL 16** for persistence (stories, characters, presets, family links)
- **SQLAlchemy** ORM + **Alembic** migrations
- **OpenTelemetry** for observability (tracing, metrics, Prometheus)

## Architecture
```
src/
  models.py                      # Pydantic v2 models (Story, Keyframe, BookConfig, Character)
  brain/
    client.py                    # Gemini client helpers (generate_text / generate_structured / generate_multimodal)
    storyteller.py               # Phase 1: notes → prose (+ generate_premise for auto mode)
    keyframer.py                 # Phase 2: prose → structured keyframes
    translator.py                # Phase 2b: full story → target language
    prompts.py                   # System prompts, narrator personas, character polish
  artist/
    generator.py                 # Gemini 2.5 Flash images + backdrops + ref sheets + upscaling
  animator/
    generator.py                 # Animation bridge (local subprocess or remote worker)
    wan_worker.py                # Wan 2.2 TI2V-5B JSONL-based subprocess
  publisher/
    layout.py                    # PDF rendering (print + screen + spread)
    templates/page.html          # Print layout (8.25×8.25" with bleed)
    templates/spread.html        # Landscape spread preview (16×8")
    cover.py                     # Legacy Pillow cover composition (unused)
    color.py                     # RGB → CMYK conversion
  db/
    engine.py                    # Async connection factory (asyncpg)
    models.py                    # SQLAlchemy ORM (7 tables)
    repository.py                # StoryRepository (async)
    character_repository.py      # CharacterRepository (async)
    family_repository.py         # FamilyRepository (family tree links)
  utils/
    config.py                    # TOML config loader + async_resolve_character (TOML or DB)
    io.py                        # File helpers (slugify, ensure_dir)
server/
  app.py                         # FastAPI application with lifespan
  telemetry.py                   # OpenTelemetry setup
  routers/
    pipeline.py                  # Pipeline endpoints + SSE progress
    stories.py                   # Story CRUD + file serving
    characters.py                # Character CRUD + family tree
    worker.py                    # Animation worker poll API
    presets.py                   # Auto-generation presets
    sanity.py                    # Sanity checks + auto-fix
  services/
    pipeline_service.py          # Full pipeline orchestration (3 review gates)
    story_service.py             # Story CRUD + branching
    character_service.py         # Character + family tree logic
    animation_queue.py           # In-memory animation job queue
    task_manager.py              # Async task manager + SSE + exclusive lock
    preset_service.py            # Preset CRUD
web/                             # React 19 + Vite + TypeScript + Tailwind v4
  src/pages/                     # 9 pages: Dashboard, NewStory, Pipeline, StoryWorkspace, Storyboard, Review, BookPreview, ReadAlong, Characters
  src/components/                # 45+ components
  src/stores/                    # Zustand (pipelineStore, etc.)
  src/api/                       # API client + types
configs/
  characters/*.toml              # Character personality + visual sheets (3 built-in)
  styles.toml                    # Art style presets (digital, watercolor, ghibli, papercut)
  settings.toml                  # Runtime defaults
alembic/                         # 10 migrations (001-010)
k8s/                             # Kubernetes manifests (Pi cluster deployment)
scripts/
  animation_worker.py            # Pull-based remote animation worker
```

## Pipeline Flow
1. **Story** — Gemini expands notes into 800-1500 word prose
2. **Keyframes** — Gemini breaks prose into 16 page-sized keyframes (structured JSON via `response_schema`)
3. **Cast** — Gemini extracts secondary characters; reference sheets generated for main + cast
4. **Translation** (optional) — Gemini translates all text with full story context
5. **Cover Variations** — 3 cover art options generated for user selection
6. **Illustration** — Gemini generates page images; all upscaled to 2400×2400
7. **Backdrops** — Gemini generates 4 decorative text-page backgrounds
8. **PDF** — WeasyPrint renders spread layout, produces 3 files
9. **Animation** (optional) — Wan 2.2 generates per-page video clips

Web UI has 3 review gates: after keyframes (story review), after cast+ref sheets (cast review), after cover variations (cover selection).

## Database
- PostgreSQL 16, 7 tables: `stories`, `keyframes`, `cast_members`, `characters`, `presets`, `phase_timings`, `family_links`
- Alembic migrations 001-010 (latest: `010_add_family_links.py`)
- Images/PDFs/videos stay on disk — DB tracks boolean flags
- `engine.py` uses asyncpg driver exclusively

## Gemini API Notes
- Single API key (`GEMINI_API_KEY`) for both text and image generation
- Text generation uses `generate_text()` / `generate_structured()` helpers in `client.py`
- Structured output uses `response_mime_type="application/json"` + `response_schema=PydanticModel`
- Image generation uses `response_modalities=["IMAGE", "TEXT"]` (in `artist/generator.py`)
- Multimodal analysis uses `generate_multimodal()` for image+text input

## Docker
```bash
docker compose up -d                                                    # Backend + frontend
OTEL_EXPORTER=otlp docker compose --profile observability up --build -d # With monitoring
docker compose --profile offline up -d                                  # With local postgres
docker compose --profile animation up -d                                # With GPU animation worker
```

## Frontend Build
- **Use `tsc -b` not `tsc --noEmit`** for type checking — stricter and matches actual build
- Strict unused-import checking (TS6196) — always clean up unused imports

## Setup on New Machine
```bash
# 1. Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Install system dependencies (macOS)
brew install pango ghostscript

# 3. Install Python dependencies
uv sync --extra web

# 4. Configure API keys
cp .env.example .env
# Edit .env with GEMINI_API_KEY + DATABASE_URL

# 5. Run web UI
uvicorn server.app:app --host 127.0.0.1 --port 8000

# 6. Or run in dev mode (Vite HMR on :5173, proxied to :8000)
cd web && npm run dev
```

## User Preferences
- User is Hungarian — stories written in English, translated to Hungarian for the child
- Use uv, never pip/venv
- Prefers Gemini API (simple API key) over Vertex AI
- Cost doesn't matter — pick best quality
