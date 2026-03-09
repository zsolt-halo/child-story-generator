from __future__ import annotations

import functools
import os
import re

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker


def get_database_url(async_driver: bool = False) -> str:
    """Read DATABASE_URL and swap the driver component as needed.

    Accepts plain ``postgresql://`` as well as URLs that already contain a
    driver prefix such as ``postgresql+asyncpg://``.

    Returns a URL with ``postgresql+asyncpg://`` when *async_driver* is True,
    or ``postgresql+psycopg2://`` when False.
    """
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL environment variable is not set")

    target_driver = "asyncpg" if async_driver else "psycopg2"
    # Match the scheme part: 'postgresql' optionally followed by '+driver'
    url = re.sub(
        r"^postgresql(\+\w+)?://",
        f"postgresql+{target_driver}://",
        url,
    )
    return url


@functools.lru_cache(maxsize=1)
def get_async_engine():
    """Return a cached async SQLAlchemy engine."""
    url = get_database_url(async_driver=True)
    return create_async_engine(url, echo=False, pool_pre_ping=True)


@functools.lru_cache(maxsize=1)
def get_sync_engine():
    """Return a cached sync SQLAlchemy engine."""
    url = get_database_url(async_driver=False)
    return create_engine(url, echo=False, pool_pre_ping=True)


@functools.lru_cache(maxsize=1)
def get_async_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return an async session factory bound to the async engine."""
    return async_sessionmaker(
        bind=get_async_engine(),
        class_=AsyncSession,
        expire_on_commit=False,
    )


@functools.lru_cache(maxsize=1)
def get_sync_session_factory() -> sessionmaker[Session]:
    """Return a sync session factory bound to the sync engine."""
    return sessionmaker(
        bind=get_sync_engine(),
        expire_on_commit=False,
    )
