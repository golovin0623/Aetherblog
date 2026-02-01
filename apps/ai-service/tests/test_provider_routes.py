from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.api.routes import providers as providers_module
from app.schemas.provider import (
    ProviderCreate,
    ProviderUpdate,
    ModelCreate,
    ModelUpdate,
    ModelSyncRequest,
    ModelBatchToggleRequest,
    ModelSortRequest,
    CredentialCreate,
    CredentialTestRequest,
    RoutingUpdateRequest,
)
from app.services.provider_registry import ProviderInfo, ModelInfo
from app.services.credential_resolver import CredentialInfo
from app.services.model_router import RoutingConfig
from app.services.remote_model_fetcher import RemoteModelInfo


class FakeRegistry:
    def __init__(self):
        self.provider = ProviderInfo(
            id=1,
            code="openai",
            name="OpenAI",
            display_name="OpenAI",
            api_type="openai_compat",
            base_url="https://api.openai.com/v1",
            doc_url=None,
            icon=None,
            is_enabled=True,
            priority=1,
            capabilities={},
            config_schema=None,
        )
        self.model = ModelInfo(
            id=10,
            provider_id=1,
            provider_code="openai",
            model_id="gpt-test",
            display_name="GPT Test",
            model_type="chat",
            context_window=8000,
            max_output_tokens=2048,
            input_cost_per_1k=None,
            output_cost_per_1k=None,
            capabilities={},
            is_enabled=True,
        )

    async def list_providers(self, enabled_only=True):
        return [self.provider]

    async def create_provider(self, **_kwargs):
        return self.provider

    async def update_provider(self, provider_id: int, updates):
        return self.provider if provider_id == 1 else None

    async def delete_provider(self, provider_id: int):
        return provider_id == 1

    async def list_models(self, provider_code=None, model_type=None, enabled_only=True):
        return [self.model]

    async def create_model(self, provider_code: str, **_kwargs):
        return self.model if provider_code == "openai" else None

    async def update_model(self, model_id: int, updates):
        return self.model if model_id == 10 else None

    async def delete_model(self, model_db_id: int):
        return model_db_id == 10

    async def get_provider(self, code: str):
        return self.provider if code == "openai" else None

    async def bulk_insert_models(self, provider_code: str, models):
        return len(models)

    async def delete_models_by_provider(self, provider_code: str, source=None):
        return 2

    async def batch_toggle_models(self, ids, enabled: bool):
        return len(ids)

    async def update_models_sort(self, items):
        return len(items)

    async def get_model_by_id(self, model_db_id: int):
        return self.model if model_db_id == 10 else None


class FakeResolver:
    def __init__(self):
        self.credential = CredentialInfo(
            id=2,
            provider_id=1,
            provider_code="openai",
            api_type="openai_compat",
            api_key="sk-test",
            base_url="https://api.openai.com/v1",
            extra_config={},
            is_default=True,
        )

    async def save_credential(self, **_kwargs):
        return 2

    async def list_credentials(self, user_id=None):
        return [
            {
                "id": 2,
                "name": "default",
                "api_key_hint": "sk-...123",
                "provider_code": "openai",
                "provider_name": "OpenAI",
                "base_url_override": None,
                "extra_config": {},
                "is_default": True,
                "is_enabled": True,
                "last_used_at": None,
                "last_error": None,
                "created_at": "2026-01-01",
            }
        ]

    async def delete_credential(self, credential_id: int, user_id=None):
        return credential_id == 2

    async def get_credential(self, provider_code: str, user_id=None, credential_id=None):
        return self.credential if credential_id == 2 else None

    async def update_last_used(self, credential_id: int, error: str | None = None):
        return None


class FakeModelRouter:
    def __init__(self, model: ModelInfo, credential: CredentialInfo):
        self._model = model
        self._credential = credential

    async def list_task_types(self):
        return [
            {
                "code": "summary",
                "name": "Summary",
                "description": None,
                "model_type": "chat",
                "temperature": 0.7,
                "max_tokens": 100,
            }
        ]

    async def resolve_routing(self, task_type: str, user_id=None):
        if task_type != "summary":
            return None
        return RoutingConfig(
            task_type=task_type,
            model=self._model,
            credential=self._credential,
            config={"temperature": 0.7},
            prompt_template=None,
            fallback_model=None,
        )

    async def update_routing(self, **_kwargs):
        return True


class FakeRemoteFetcher:
    async def fetch_models(self, provider, credential):
        return [
            RemoteModelInfo(
                model_id="gpt-remote",
                display_name="Remote GPT",
                model_type="chat",
                context_window=None,
                max_output_tokens=None,
                input_cost_per_1k=None,
                output_cost_per_1k=None,
                capabilities={"source": "remote"},
                is_enabled=False,
            )
        ]


@pytest.mark.asyncio
async def test_provider_and_model_endpoints(monkeypatch):
    registry = FakeRegistry()

    providers = await providers_module.list_providers(enabled_only=False, registry=registry)
    assert providers.data[0].code == "openai"

    created = await providers_module.create_provider(
        ProviderCreate(code="openai", name="OpenAI"),
        registry=registry,
    )
    assert created.data.code == "openai"

    updated = await providers_module.update_provider(
        provider_id=1,
        req=ProviderUpdate(name="OpenAI Inc"),
        registry=registry,
    )
    assert updated.data.code == "openai"

    models = await providers_module.list_provider_models("openai", enabled_only=False, registry=registry)
    assert models.data[0].model_id == "gpt-test"

    model_created = await providers_module.create_model(
        "openai",
        ModelCreate(model_id="gpt-test"),
        registry=registry,
    )
    assert model_created.data.model_id == "gpt-test"

    model_updated = await providers_module.update_model(
        model_id=10,
        req=ModelUpdate(display_name="Updated"),
        registry=registry,
    )
    assert model_updated.data.display_name == "GPT Test"

    deleted = await providers_module.delete_model(model_id=10, registry=registry)
    assert deleted.data is True

    all_models = await providers_module.list_all_models(model_type=None, enabled_only=False, registry=registry)
    assert all_models.data[0].model_id == "gpt-test"

    synced = await providers_module.fetch_remote_models(
        provider_code="openai",
        req=ModelSyncRequest(credential_id=2),
        user=SimpleNamespace(user_id=1),
        resolver=FakeResolver(),
        registry=registry,
        fetcher=FakeRemoteFetcher(),
    )
    assert synced.data.inserted == 1

    cleared = await providers_module.delete_models_by_provider("openai", source="remote", registry=registry)
    assert cleared.data["deleted"] == 2

    toggled = await providers_module.batch_toggle_models(
        "openai",
        ModelBatchToggleRequest(ids=[10], enabled=False),
        registry=registry,
    )
    assert toggled.data["updated"] == 1

    sorted_resp = await providers_module.update_model_sort(
        "openai",
        ModelSortRequest(items=[{"id": 10, "sort": 1}]),
        registry=registry,
    )
    assert sorted_resp.data["updated"] == 1


@pytest.mark.asyncio
async def test_credential_and_routing_endpoints(monkeypatch):
    registry = FakeRegistry()
    resolver = FakeResolver()
    model_router = FakeModelRouter(registry.model, resolver.credential)

    created = await providers_module.create_credential(
        req=CredentialCreate(provider_code="openai", api_key="sk-test"),
        user=SimpleNamespace(user_id=1),
        resolver=resolver,
    )
    assert created.data["id"] == 2

    listed = await providers_module.list_credentials(
        user=SimpleNamespace(user_id=1),
        resolver=resolver,
    )
    assert listed.data[0].provider_code == "openai"

    deleted = await providers_module.delete_credential(
        credential_id=2,
        user=SimpleNamespace(user_id=1),
        resolver=resolver,
    )
    assert deleted.data is True

    async def fake_acompletion(**_kwargs):
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="OK"))])

    monkeypatch.setattr(providers_module, "acompletion", fake_acompletion)

    tested = await providers_module.test_credential(
        credential_id=2,
        req=CredentialTestRequest(model_id="gpt-test"),
        user=SimpleNamespace(user_id=1),
        resolver=resolver,
        registry=registry,
    )
    assert tested.data.success is True

    tasks = await providers_module.list_task_types(model_router=model_router)
    assert tasks.data[0].code == "summary"

    routing = await providers_module.get_routing(
        task_type="summary",
        user=SimpleNamespace(user_id=1),
        model_router=model_router,
    )
    assert routing.data.primary_model.model_id == "gpt-test"

    updated = await providers_module.update_routing(
        task_type="summary",
        req=RoutingUpdateRequest(primary_model_id=10),
        user=SimpleNamespace(user_id=1),
        model_router=model_router,
    )
    assert updated.data is True
