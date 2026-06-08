from __future__ import annotations

import pytest
import httpx

from app.services.remote_model_fetcher import RemoteModelFetcher
from app.services.provider_registry import ProviderInfo
from app.services.credential_resolver import CredentialInfo


@pytest.fixture(autouse=True)
def _allow_external(monkeypatch):
    """放行外链校验：这些用例验证的是「响应解析」，不应依赖真实 DNS。

    SSRF 防护本身由 tests/test_api_base.py / url_validator 覆盖；此处若不打桩，
    ``api.example.com`` 在部分环境会解析到保留网段而误拦截，掩盖被测逻辑。
    """
    monkeypatch.setattr(
        "app.services.remote_model_fetcher.validate_external_url",
        lambda *args, **kwargs: True,
    )


class FakeAsyncClient:
    def __init__(self, response: httpx.Response):
        self.response = response
        self.last_headers = None
        self.last_url = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url: str, headers: dict):
        self.last_headers = headers
        self.last_url = url
        return self.response


@pytest.mark.asyncio
async def test_fetch_openai_models(monkeypatch):
    request = httpx.Request("GET", "https://api.example.com/v1/models")
    response = httpx.Response(
        200,
        json={"data": [{"id": "gpt-4o", "created": 1700000000}]},
        request=request,
    )
    fake_client = FakeAsyncClient(response)

    monkeypatch.setattr(
        "app.services.remote_model_fetcher.httpx.AsyncClient",
        lambda timeout=20: fake_client,
    )

    provider = ProviderInfo(
        id=1,
        code="openai",
        name="OpenAI",
        display_name="OpenAI",
        api_type="openai_compat",
        base_url="https://api.example.com/v1",
        doc_url=None,
        icon=None,
        is_enabled=True,
        priority=1,
        capabilities={},
        config_schema=None,
    )
    credential = CredentialInfo(
        id=1,
        provider_id=1,
        provider_code="openai",
        api_type="openai_compat",
        api_key="sk-test",
        base_url="https://api.example.com/v1",
        extra_config={},
        is_default=True,
    )

    fetcher = RemoteModelFetcher()
    models = await fetcher.fetch_models(provider, credential)
    assert models[0].model_id == "gpt-4o"
    assert models[0].capabilities["source"] == "remote"
    assert "released_at" in models[0].capabilities
    # 远程模型应自动带上规范能力标志（gpt-4o → 视觉 + 工具调用）
    assert models[0].capabilities["abilities"]["vision"] is True
    assert models[0].capabilities["abilities"]["functionCall"] is True
    assert fake_client.last_url == "https://api.example.com/v1/models"


@pytest.mark.asyncio
async def test_fetch_openai_models_captures_aggregator_pricing(monkeypatch):
    # OpenRouter / 兼容聚合站惯例：pricing.{prompt,completion} 为 USD/Token，context_length 给上下文
    request = httpx.Request("GET", "https://api.example.com/v1/models")
    response = httpx.Response(
        200,
        json={
            "data": [
                {
                    "id": "anthropic/claude-3.5-sonnet",
                    "context_length": 200000,
                    "pricing": {"prompt": "0.000003", "completion": "0.000015"},
                }
            ]
        },
        request=request,
    )
    fake_client = FakeAsyncClient(response)
    monkeypatch.setattr(
        "app.services.remote_model_fetcher.httpx.AsyncClient",
        lambda timeout=20: fake_client,
    )

    provider = ProviderInfo(
        id=1, code="openrouter", name="OpenRouter", display_name="OpenRouter",
        api_type="openai_compat", base_url="https://api.example.com/v1",
        doc_url=None, icon=None, is_enabled=True, priority=1, capabilities={}, config_schema=None,
    )
    credential = CredentialInfo(
        id=1, provider_id=1, provider_code="openrouter", api_type="openai_compat",
        api_key="sk-test", base_url="https://api.example.com/v1", extra_config={}, is_default=True,
    )

    fetcher = RemoteModelFetcher()
    models = await fetcher.fetch_models(provider, credential)
    m = models[0]
    # USD/Token → 每百万 Token
    assert m.input_cost_per_1m == 3.0
    assert m.output_cost_per_1m == 15.0
    # 同时换算 *_per_1k 供 bulk_insert 落库
    assert m.input_cost_per_1k == 0.003
    assert m.context_window == 200000
    assert m.capabilities["pricing"]["input"] == 3.0
    assert m.capabilities["pricing"]["currency"] == "USD"


@pytest.mark.asyncio
async def test_fetch_openai_models_appends_v1_when_missing(monkeypatch):
    request = httpx.Request("GET", "https://api.example.com/v1/models")
    response = httpx.Response(
        200,
        json={"data": [{"id": "gpt-4.1"}]},
        request=request,
    )
    fake_client = FakeAsyncClient(response)

    monkeypatch.setattr(
        "app.services.remote_model_fetcher.httpx.AsyncClient",
        lambda timeout=20: fake_client,
    )

    provider = ProviderInfo(
        id=1,
        code="openai",
        name="OpenAI",
        display_name="OpenAI",
        api_type="openai_compat",
        base_url="https://api.example.com",
        doc_url=None,
        icon=None,
        is_enabled=True,
        priority=1,
        capabilities={},
        config_schema=None,
    )
    credential = CredentialInfo(
        id=1,
        provider_id=1,
        provider_code="openai",
        api_type="openai_compat",
        api_key="sk-test",
        base_url="https://api.example.com",
        extra_config={},
        is_default=True,
    )

    fetcher = RemoteModelFetcher()
    models = await fetcher.fetch_models(provider, credential)
    assert models[0].model_id == "gpt-4.1"
    assert fake_client.last_url == "https://api.example.com/v1/models"


@pytest.mark.asyncio
async def test_fetch_openai_models_accepts_models_key(monkeypatch):
    request = httpx.Request("GET", "https://api.example.com/v1/models")
    response = httpx.Response(
        200,
        json={"models": [{"id": "gpt-5.2"}]},
        request=request,
    )
    fake_client = FakeAsyncClient(response)

    monkeypatch.setattr(
        "app.services.remote_model_fetcher.httpx.AsyncClient",
        lambda timeout=20: fake_client,
    )

    provider = ProviderInfo(
        id=1,
        code="openai",
        name="OpenAI",
        display_name="OpenAI",
        api_type="openai_compat",
        base_url="https://api.example.com/v1",
        doc_url=None,
        icon=None,
        is_enabled=True,
        priority=1,
        capabilities={},
        config_schema=None,
    )
    credential = CredentialInfo(
        id=1,
        provider_id=1,
        provider_code="openai",
        api_type="openai_compat",
        api_key="sk-test",
        base_url="https://api.example.com/v1",
        extra_config={},
        is_default=True,
    )

    fetcher = RemoteModelFetcher()
    models = await fetcher.fetch_models(provider, credential)
    assert models[0].model_id == "gpt-5.2"


@pytest.mark.asyncio
async def test_fetch_anthropic_models_with_version(monkeypatch):
    request = httpx.Request("GET", "https://api.example.com/models")
    response = httpx.Response(
        200,
        json={"data": [{"id": "claude-test", "created_at": "2025-01-01T00:00:00Z"}]},
        request=request,
    )
    fake_client = FakeAsyncClient(response)

    monkeypatch.setattr(
        "app.services.remote_model_fetcher.httpx.AsyncClient",
        lambda timeout=20: fake_client,
    )

    provider = ProviderInfo(
        id=2,
        code="anthropic",
        name="Anthropic",
        display_name="Anthropic",
        api_type="anthropic",
        base_url="https://api.example.com",
        doc_url=None,
        icon=None,
        is_enabled=True,
        priority=1,
        capabilities={},
        config_schema=None,
    )
    credential = CredentialInfo(
        id=2,
        provider_id=2,
        provider_code="anthropic",
        api_type="anthropic",
        api_key="sk-test",
        base_url="https://api.example.com",
        extra_config={"anthropic_version": "2024-01-01"},
        is_default=True,
    )

    fetcher = RemoteModelFetcher()
    models = await fetcher.fetch_models(provider, credential)
    assert models[0].model_id == "claude-test"
    assert fake_client.last_headers["anthropic-version"] == "2024-01-01"


@pytest.mark.asyncio
async def test_fetch_google_models_strips_prefix_and_reads_limits(monkeypatch):
    request = httpx.Request("GET", "https://generativelanguage.googleapis.com/v1beta/models")
    response = httpx.Response(
        200,
        json={
            "models": [
                {
                    "name": "models/gemini-2.5-pro",
                    "displayName": "Gemini 2.5 Pro",
                    "inputTokenLimit": 1048576,
                    "outputTokenLimit": 65536,
                    "supportedGenerationMethods": ["generateContent"],
                }
            ]
        },
        request=request,
    )
    fake_client = FakeAsyncClient(response)

    monkeypatch.setattr(
        "app.services.remote_model_fetcher.httpx.AsyncClient",
        lambda timeout=20: fake_client,
    )

    provider = ProviderInfo(
        id=3,
        code="google",
        name="Google",
        display_name="Google",
        api_type="google",
        base_url="https://generativelanguage.googleapis.com/v1beta",
        doc_url=None,
        icon=None,
        is_enabled=True,
        priority=1,
        capabilities={},
        config_schema=None,
    )
    credential = CredentialInfo(
        id=3,
        provider_id=3,
        provider_code="google",
        api_type="google",
        api_key="g-test",
        base_url="https://generativelanguage.googleapis.com/v1beta",
        extra_config={},
        is_default=True,
    )

    fetcher = RemoteModelFetcher()
    models = await fetcher.fetch_models(provider, credential)
    assert models[0].model_id == "gemini-2.5-pro"  # 去掉 models/ 前缀
    assert models[0].context_window == 1048576
    assert models[0].max_output_tokens == 65536
    # 密钥走请求头，不进 URL
    assert fake_client.last_headers["x-goog-api-key"] == "g-test"
    assert models[0].capabilities["abilities"]["vision"] is True
