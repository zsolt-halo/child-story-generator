import os

import anthropic

from src.models import BookConfig

# Gateway requires anthropic/ prefix on model names
_GATEWAY_MODEL_PREFIX = "anthropic/"


def create_client(config: BookConfig) -> anthropic.Anthropic:
    """Create an Anthropic client, using gateway if configured."""
    gateway_url = config.gateway_base_url or os.environ.get("GATEWAY_BASE_URL", "")
    gateway_key = config.gateway_api_key or os.environ.get("GATEWAY_API_KEY", "")

    if gateway_url and gateway_key:
        return anthropic.Anthropic(base_url=gateway_url, api_key=gateway_key)

    # Fall back to direct Anthropic API (uses ANTHROPIC_API_KEY env var)
    return anthropic.Anthropic()


def resolve_model(config: BookConfig) -> str:
    """Return the model name, adding gateway prefix if needed."""
    model = config.claude_model
    is_gateway = bool(
        (config.gateway_base_url or os.environ.get("GATEWAY_BASE_URL", ""))
        and (config.gateway_api_key or os.environ.get("GATEWAY_API_KEY", ""))
    )

    if is_gateway and "/" not in model:
        return f"{_GATEWAY_MODEL_PREFIX}{model}"
    return model
