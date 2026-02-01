from __future__ import annotations

from typing import Any

from app.api import deps as deps_module
from app.main import app
from app.services.provider_registry import ProviderInfo
from app.services.credential_resolver import CredentialInfo
from app.services.remote_model_fetcher import RemoteModelInfo


def test_fetch_remote_models_end_to_end(client, admin_headers):
    test_client, *_ = client

    class FakeProviderRegistry:
        def __init__(self):
            self.inserted: list[RemoteModelInfo] = []

        async def get_provider(self, code: str):
            return ProviderInfo(
                id=1,
                code=code,
                name="OpenAI",
                display_name="OpenAI",
                api_type="openai_compat",
                base_url="https://api.example.com/v",
                doc_url=None,
                icon=None,
                is_enabled=True,
                priority=1,
                capabilities={},
                config_schema=None,
            )

        async def bulk_insert_models(self, provider_code: str, models: list[RemoteModelInfo]) -> int:
            self.inserted = models
            return len(models)

    class FakeCredentialResolver:
        async def get_credential(self, provider_code: str, user_id=None, credential_id=None):
            return CredentialInfo(
                id=10,
                provider_id=1,
                provider_code=provider_code,
                api_type="openai_compat",
                api_key="sk-test",
                base_url="https://api.example.com/v1",
                extra_config={"api_path_mode": "append_v1"},
                is_default=True,
            )

    class FakeRemoteModelFetcher:
        async def fetch_models(self, provider: ProviderInfo, credential: CredentialInfo) -> list[RemoteModelInfo]:
            return [
                RemoteModelInfo(
                    model_id="claude-sonnet-4-5-thinking",
                    display_name="Claude 4.5 Sonnet (Thinking)",
                    model_type="chat",
                    context_window=200000,
                    max_output_tokens=8192,
                    input_cost_per_1k=None,
                    output_cost_per_1k=None,
                    capabilities={"source": "remote"},
                    is_enabled=False,
                ),
                RemoteModelInfo(
                    model_id="gemini-3-flash-preview",
                    display_name="Gemini 3 Flash Preview",
                    model_type="chat",
                    context_window=1000000,
                    max_output_tokens=16384,
                    input_cost_per_1k=None,
                    output_cost_per_1k=None,
                    capabilities={"source": "remote"},
                    is_enabled=False,
                ),
                RemoteModelInfo(
                    model_id="text-embedding-3-small",
                    display_name="Embedding 3 Small",
                    model_type="embedding",
                    context_window=None,
                    max_output_tokens=None,
                    input_cost_per_1k=None,
                    output_cost_per_1k=None,
                    capabilities={"source": "remote"},
                    is_enabled=False,
                ),
            ]

    registry = FakeProviderRegistry()

    app.dependency_overrides[deps_module.get_provider_registry] = lambda: registry
    app.dependency_overrides[deps_module.get_credential_resolver] = lambda: FakeCredentialResolver()
    app.dependency_overrides[deps_module.get_remote_model_fetcher] = lambda: FakeRemoteModelFetcher()

    resp = test_client.post(
        "/api/v1/admin/providers/openai/models/remote",
        headers=admin_headers,
        json={"credential_id": 10},
    )

    assert resp.status_code == 200
    payload: dict[str, Any] = resp.json()
    assert payload["data"]["inserted"] == 3
    assert len(registry.inserted) == 3

    app.dependency_overrides = {}
