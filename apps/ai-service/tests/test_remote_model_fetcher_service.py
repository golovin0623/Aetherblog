from __future__ import annotations

import pytest
import httpx

from app.services.remote_model_fetcher import RemoteModelFetcher
from app.services.provider_registry import ProviderInfo
from app.services.credential_resolver import CredentialInfo


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
    assert fake_client.last_url == "https://api.example.com/v1/models"


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
