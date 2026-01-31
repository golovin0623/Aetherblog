from app.utils.provider_urls import normalize_api_base


def test_normalize_api_base_auto_openai_append_v1():
    assert normalize_api_base("https://api.example.com/v", "openai_compat", {}) == "https://api.example.com/v1"
    assert normalize_api_base("https://api.example.com/v1", "openai_compat", {}) == "https://api.example.com/v1"
    assert normalize_api_base("https://api.example.com/v1/", "openai_compat", {}) == "https://api.example.com/v1"


def test_normalize_api_base_auto_anthropic_strip_v1():
    assert normalize_api_base("https://api.example.com/v1", "anthropic", {}) == "https://api.example.com"
    assert normalize_api_base("https://api.example.com/v1/", "anthropic", {}) == "https://api.example.com"
    assert normalize_api_base("https://api.example.com/v", "anthropic", {}) == "https://api.example.com/v"


def test_normalize_api_base_explicit_modes():
    assert (
        normalize_api_base("https://api.example.com", "anthropic", {"api_path_mode": "append_v1"})
        == "https://api.example.com/v1"
    )
    assert (
        normalize_api_base("https://api.example.com/v1", "openai_compat", {"api_path_mode": "strip_v1"})
        == "https://api.example.com"
    )


def test_normalize_api_base_handles_none():
    assert normalize_api_base(None, "openai_compat", {}) is None
