from app.utils.provider_urls import normalize_api_base


def test_normalize_api_base_auto_openai_append_v1():
    assert normalize_api_base("https://ai.golovin.cn/v", "openai_compat", {}) == "https://ai.golovin.cn/v1"
    assert normalize_api_base("https://ai.golovin.cn/v1", "openai_compat", {}) == "https://ai.golovin.cn/v1"
    assert normalize_api_base("https://ai.golovin.cn/v1/", "openai_compat", {}) == "https://ai.golovin.cn/v1"


def test_normalize_api_base_auto_anthropic_strip_v1():
    assert normalize_api_base("https://ai.golovin.cn/v1", "anthropic", {}) == "https://ai.golovin.cn"
    assert normalize_api_base("https://ai.golovin.cn/v1/", "anthropic", {}) == "https://ai.golovin.cn"
    assert normalize_api_base("https://ai.golovin.cn/v", "anthropic", {}) == "https://ai.golovin.cn/v"


def test_normalize_api_base_explicit_modes():
    assert (
        normalize_api_base("https://ai.golovin.cn", "anthropic", {"api_path_mode": "append_v1"})
        == "https://ai.golovin.cn/v1"
    )
    assert (
        normalize_api_base("https://ai.golovin.cn/v1", "openai_compat", {"api_path_mode": "strip_v1"})
        == "https://ai.golovin.cn"
    )


def test_normalize_api_base_handles_none():
    assert normalize_api_base(None, "openai_compat", {}) is None
