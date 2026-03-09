# StarlightScribe Backend API
# Multi-stage build for minimal image size

FROM python:3.12-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libffi-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --no-cache-dir --target=/app/deps ".[web]"


FROM python:3.12-slim

WORKDIR /app

# Runtime system dependencies:
#  - libpango*, libcairo2, libgdk-pixbuf-2.0-0: WeasyPrint HTML→PDF rendering
#  - ghostscript: PDF compression (called as subprocess `gs`)
#  - libffi8: cffi runtime dependency
#  - fonts-noto: Unicode font coverage for Hungarian text
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libpangoft2-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libcairo2 \
    ghostscript \
    libffi8 \
    libpq5 \
    fonts-noto \
    && rm -rf /var/lib/apt/lists/*

# Python packages from builder
COPY --from=builder /app/deps /app/deps
ENV PYTHONPATH=/app/deps

# Application source
COPY src/ ./src/
COPY server/ ./server/
COPY main.py ./
COPY configs/ ./configs/
COPY alembic.ini ./
COPY alembic/ ./alembic/

# Stories directory (overlaid by PVC in k8s)
RUN mkdir -p /app/stories

# Non-root user
RUN useradd -m -u 1001 starlight && \
    chown -R starlight:starlight /app

USER starlight

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

CMD ["python", "-m", "uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000"]
