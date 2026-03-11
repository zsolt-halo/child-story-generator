"""OpenTelemetry SDK initialization for StarlightScribe backend.

Configures tracing, metrics, and log correlation based on ``OTEL_EXPORTER`` env var:
  - ``otlp``    — export traces via OTLP HTTP, expose Prometheus /metrics (production/docker)
  - ``console`` — print spans to stderr (debugging)
  - ``none``    — disable all telemetry (default / CLI)
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Custom metric instruments (importable by other modules)
# ---------------------------------------------------------------------------
# Initialized lazily in setup_telemetry(); safe to import before setup.

pipeline_phase_duration = None  # Histogram (seconds), labels: phase
gemini_api_calls = None         # Counter, labels: model, type
gemini_api_latency = None       # Histogram (seconds), labels: model, type
image_generation_results = None  # Counter, labels: result, model
active_pipeline_tasks = None    # UpDownCounter

_providers_initialized = False


def setup_telemetry(app: FastAPI) -> None:
    """Initialize OTel SDK and auto-instrument the application."""
    global pipeline_phase_duration, gemini_api_calls, gemini_api_latency
    global image_generation_results, active_pipeline_tasks, _providers_initialized

    exporter_mode = os.environ.get("OTEL_EXPORTER", "none").lower()
    if exporter_mode == "none":
        logger.debug("Telemetry disabled (OTEL_EXPORTER=none)")
        return

    try:
        from opentelemetry import trace, metrics
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.sdk.metrics import MeterProvider
    except ImportError:
        logger.warning("OpenTelemetry SDK not installed — skipping telemetry setup")
        return

    # --- Resource ---
    resource = Resource.create({
        "service.name": os.environ.get("OTEL_SERVICE_NAME", "starlight-backend"),
        "deployment.environment": os.environ.get("DEPLOYMENT_ENV", "development"),
    })

    # --- Traces ---
    tracer_provider = TracerProvider(resource=resource)

    if exporter_mode == "otlp":
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        endpoint = os.environ.get(
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
            "http://localhost:4318/v1/traces",
        )
        tracer_provider.add_span_processor(
            BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint))
        )
    elif exporter_mode == "console":
        from opentelemetry.sdk.trace.export import ConsoleSpanExporter
        tracer_provider.add_span_processor(
            BatchSpanProcessor(ConsoleSpanExporter())
        )

    trace.set_tracer_provider(tracer_provider)

    # --- Metrics ---
    readers = []
    if exporter_mode == "otlp":
        try:
            from opentelemetry.exporter.prometheus import PrometheusMetricReader
            reader = PrometheusMetricReader()
            readers.append(reader)
            logger.info("Prometheus metrics available on :9464/metrics")
        except Exception:
            logger.warning("Failed to start Prometheus metric reader", exc_info=True)
    elif exporter_mode == "console":
        from opentelemetry.sdk.metrics.export import (
            ConsoleMetricExporter,
            PeriodicExportingMetricReader,
        )
        readers.append(
            PeriodicExportingMetricReader(ConsoleMetricExporter(), export_interval_millis=30000)
        )

    meter_provider = MeterProvider(resource=resource, metric_readers=readers)
    metrics.set_meter_provider(meter_provider)

    # Create custom instruments
    meter = metrics.get_meter("starlight")
    pipeline_phase_duration = meter.create_histogram(
        name="starlight.pipeline.phase_duration",
        description="Duration of pipeline phases in seconds",
        unit="s",
    )
    gemini_api_calls = meter.create_counter(
        name="starlight.gemini.api_calls",
        description="Number of Gemini API calls",
    )
    gemini_api_latency = meter.create_histogram(
        name="starlight.gemini.api_latency",
        description="Latency of Gemini API calls in seconds",
        unit="s",
    )
    image_generation_results = meter.create_counter(
        name="starlight.image.generation_results",
        description="Image generation outcomes",
    )
    active_pipeline_tasks = meter.create_up_down_counter(
        name="starlight.pipeline.active_tasks",
        description="Number of currently running pipeline tasks",
    )

    # --- Auto-instrumentation ---
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        FastAPIInstrumentor.instrument_app(
            app, excluded_urls="api/pipeline/progress",
        )
    except Exception:
        logger.debug("FastAPI instrumentation failed", exc_info=True)

    try:
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
        SQLAlchemyInstrumentor().instrument()
    except Exception:
        logger.debug("SQLAlchemy instrumentation failed", exc_info=True)

    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
        HTTPXClientInstrumentor().instrument()
    except Exception:
        logger.debug("HTTPX instrumentation failed", exc_info=True)

    try:
        from opentelemetry.instrumentation.requests import RequestsInstrumentor
        RequestsInstrumentor().instrument()
    except Exception:
        logger.debug("Requests instrumentation failed", exc_info=True)

    try:
        from opentelemetry.instrumentation.logging import LoggingInstrumentor
        LoggingInstrumentor().instrument(set_logging_format=True)
    except Exception:
        logger.debug("Logging instrumentation failed", exc_info=True)

    _providers_initialized = True
    logger.info("Telemetry initialized (exporter=%s)", exporter_mode)


def shutdown_telemetry() -> None:
    """Flush and shut down all OTel providers."""
    if not _providers_initialized:
        return
    try:
        from opentelemetry import trace, metrics
        tp = trace.get_tracer_provider()
        if hasattr(tp, "shutdown"):
            tp.shutdown()
        mp = metrics.get_meter_provider()
        if hasattr(mp, "shutdown"):
            mp.shutdown()
        logger.info("Telemetry shut down")
    except Exception:
        logger.debug("Telemetry shutdown error", exc_info=True)
