import asyncio
import os
import re
from logging.config import fileConfig

from dotenv import load_dotenv
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context

# Load .env so DATABASE_URL is available
load_dotenv()

# Alembic Config object
config = context.config

# Set up Python logging from the .ini file
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Import target metadata from our models
from src.db.models import Base  # noqa: E402

target_metadata = Base.metadata


def _get_url() -> str:
    """Return an asyncpg-compatible database URL from the environment."""
    url = os.environ.get("DATABASE_URL", config.get_main_option("sqlalchemy.url"))
    if url is None:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    # Normalize to asyncpg driver
    url = re.sub(r"^postgresql(\+\w+)?://", "postgresql+asyncpg://", url)
    return url


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    Configures the context with just a URL and not an Engine.
    Calls to context.execute() emit the given string to the script output.
    """
    url = _get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    """Configure context with the given connection and run migrations."""
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations in 'online' mode using an async engine."""
    connectable = create_async_engine(
        _get_url(),
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
