import logging
import os
import time as _time

from google import genai
from google.genai import types
from opentelemetry import trace
from pydantic import BaseModel

from src.models import BookConfig

logger = logging.getLogger(__name__)
tracer = trace.get_tracer("starlight.gemini")


def _record_gemini_metrics(model: str, call_type: str, elapsed: float) -> None:
    """Record Gemini API call/latency metrics. No-op when telemetry is unavailable."""
    try:
        from server.telemetry import gemini_api_calls, gemini_api_latency
        if gemini_api_calls:
            gemini_api_calls.add(1, {"model": model, "type": call_type})
        if gemini_api_latency:
            gemini_api_latency.record(elapsed, {"model": model, "type": call_type})
    except ImportError:
        pass


def _create_client(config: BookConfig) -> genai.Client:
    """Create a Gemini client using the configured API key."""
    api_key = config.gemini_api_key or os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set. Add it to .env or export it.")
    return genai.Client(api_key=api_key)


def generate_text(
    config: BookConfig,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 8192,
) -> str:
    """Generate text using Gemini."""
    logger.debug("generate_text: model=%s prompt_len=%d", config.text_model, len(user_prompt))
    with tracer.start_as_current_span(
        "gemini.generate_text",
        attributes={"gemini.model": config.text_model, "gemini.type": "text"},
    ) as span:
        t0 = _time.monotonic()
        client = _create_client(config)
        response = client.models.generate_content(
            model=config.text_model,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=max_tokens,
            ),
        )
        elapsed = _time.monotonic() - t0
        span.set_attribute("gemini.response_len", len(response.text))
        logger.debug("generate_text: response_len=%d", len(response.text))
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            u = response.usage_metadata
            logger.debug("Token usage: prompt=%s candidates=%s total=%s",
                          getattr(u, "prompt_token_count", "?"),
                          getattr(u, "candidates_token_count", "?"),
                          getattr(u, "total_token_count", "?"))
        _record_gemini_metrics(config.text_model, "text", elapsed)
        return response.text


def generate_structured(
    config: BookConfig,
    system_prompt: str,
    user_prompt: str,
    schema: type[BaseModel],
    max_tokens: int = 16384,
) -> BaseModel:
    """Generate structured output using Gemini with a Pydantic schema."""
    logger.debug("generate_structured: model=%s schema=%s prompt_len=%d",
                 config.text_model, schema.__name__, len(user_prompt))
    with tracer.start_as_current_span(
        "gemini.generate_structured",
        attributes={
            "gemini.model": config.text_model,
            "gemini.type": "structured",
            "gemini.schema": schema.__name__,
        },
    ) as span:
        t0 = _time.monotonic()
        client = _create_client(config)
        response = client.models.generate_content(
            model=config.text_model,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=max_tokens,
                response_mime_type="application/json",
                response_schema=schema,
            ),
        )
        elapsed = _time.monotonic() - t0
        span.set_attribute("gemini.response_len", len(response.text))
        logger.debug("generate_structured: response_len=%d", len(response.text))
        _record_gemini_metrics(config.text_model, "structured", elapsed)
        return schema.model_validate_json(response.text)


def generate_multimodal(
    config: BookConfig,
    system_prompt: str,
    image_bytes: bytes,
    text_prompt: str,
    max_tokens: int = 4096,
) -> str:
    """Send image + text to Gemini for multimodal analysis."""
    logger.debug("generate_multimodal: model=%s image_size=%d KB", config.text_model, len(image_bytes) // 1024)
    with tracer.start_as_current_span(
        "gemini.generate_multimodal",
        attributes={
            "gemini.model": config.text_model,
            "gemini.type": "multimodal",
            "gemini.image_size_kb": len(image_bytes) // 1024,
        },
    ) as span:
        t0 = _time.monotonic()
        client = _create_client(config)
        response = client.models.generate_content(
            model=config.text_model,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
                text_prompt,
            ],
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=max_tokens,
            ),
        )
        elapsed = _time.monotonic() - t0
        span.set_attribute("gemini.response_len", len(response.text))
        _record_gemini_metrics(config.text_model, "multimodal", elapsed)
        return response.text
