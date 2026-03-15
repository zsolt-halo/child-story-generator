from __future__ import annotations

import functools
import os
import re

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


def get_database_url() -> str:
    """Read DATABASE_URL and normalise to use the asyncpg driver.

    Accepts plain ``postgresql://`` as well as URLs that already contain a
    driver prefix such as ``postgresql+asyncpg://``.
    """
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL environment variable is not set")

    # Match the scheme part: 'postgresql' optionally followed by '+driver'
    url = re.sub(
        r"^postgresql(\+\w+)?://",
        "postgresql+asyncpg://",
        url,
    )
    return url


@functools.lru_cache(maxsize=1)
def get_async_engine():
    """Return a cached async SQLAlchemy engine."""
    url = get_database_url()
    return create_async_engine(url, echo=False, pool_pre_ping=True)


@functools.lru_cache(maxsize=1)
def get_async_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return an async session factory bound to the async engine."""
    return async_sessionmaker(
        bind=get_async_engine(),
        class_=AsyncSession,
        expire_on_commit=False,
    )
