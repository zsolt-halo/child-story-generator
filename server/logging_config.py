"""Centralized logging setup for the StarlightScribe server.

Reads LOG_LEVEL from environment (default: WARNING).
Local dev (docker-compose) sets LOG_LEVEL=DEBUG; production (k8s) omits it → quiet.
"""

import logging
import os


def setup_logging() -> None:
    level = os.environ.get("LOG_LEVEL", "WARNING").upper()

    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-8s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Pin noisy third-party loggers to WARNING even when root is DEBUG
    for name in (
        "uvicorn.access",
        "sqlalchemy",
        "sqlalchemy.engine",
        "httpcore",
        "httpx",
        "hpack",
        "PIL",
        "weasyprint",
        "fontTools",
        "opentelemetry",
    ):
        logging.getLogger(name).setLevel(logging.WARNING)
