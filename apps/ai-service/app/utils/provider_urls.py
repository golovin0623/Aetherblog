# ref: §5.1 - Provider URL helpers
from __future__ import annotations

from typing import Any


def _strip_trailing_slash(url: str) -> str:
    return url.rstrip("/")


def _ensure_v1_suffix(url: str) -> str:
    url = _strip_trailing_slash(url)
    if url.endswith("/v1"):
        return url
    if url.endswith("/v"):
        return f"{url}1"
    return f"{url}/v1"


def _strip_v1_suffix(url: str) -> str:
    url = _strip_trailing_slash(url)
    if url.endswith("/v1"):
        return url[:-3]
    return url


def normalize_api_base(
    base_url: str | None,
    api_type: str | None,
    extra_config: dict[str, Any] | None,
) -> str | None:
    """
    Normalize API base URL according to provider protocol conventions.

    Modes:
    - append_v1: force add /v1 suffix
    - strip_v1: force remove /v1 suffix
    - auto (default): openai_compat -> append /v1, anthropic -> strip /v1
    """
    if not base_url:
        return None

    mode = (extra_config or {}).get("api_path_mode", "auto")
    if mode == "append_v1":
        return _ensure_v1_suffix(base_url)
    if mode == "strip_v1":
        return _strip_v1_suffix(base_url)

    # auto mode
    if api_type == "openai_compat":
        return _ensure_v1_suffix(base_url)
    if api_type == "anthropic":
        return _strip_v1_suffix(base_url)

    return _strip_trailing_slash(base_url)
