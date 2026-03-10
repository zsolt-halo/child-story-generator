import os
import platform
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Ensure native libraries are discoverable for WeasyPrint
if platform.system() == "Windows":
    msys2_bin = r"C:\msys64\ucrt64\bin"
    if os.path.isdir(msys2_bin):
        os.add_dll_directory(msys2_bin)
        os.environ["PATH"] = msys2_bin + os.pathsep + os.environ.get("PATH", "")
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from server.routers import stories, pipeline, config, sanity, characters

load_dotenv()

from server.logging_config import setup_logging
setup_logging()

import logging
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run DB table creation as a dev safety net on startup."""
    try:
        from src.db.engine import get_async_engine
        from src.db.models import Base
        engine = get_async_engine()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database tables verified")
    except Exception:
        logger.debug("DB auto-create skipped (not configured)", exc_info=True)
    yield


app = FastAPI(
    title="StarlightScribe",
    description="Children's book generator API",
    version="0.1.0",
    lifespan=lifespan,
)

_default_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
_extra = os.environ.get("CORS_ORIGINS", "")
_origins = _default_origins + [o.strip() for o in _extra.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stories.router)
app.include_router(pipeline.router)
app.include_router(config.router)
app.include_router(sanity.router)
app.include_router(characters.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# Serve built frontend (production mode)
FRONTEND_DIST = Path(__file__).parent.parent / "web" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
