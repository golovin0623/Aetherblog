from __future__ import annotations

import pytest

from app.services.model_router import ModelRouter, RoutingConfig
from app.services.provider_registry import ModelInfo
from app.services.credential_resolver import CredentialInfo
from tests.support import FakeConn, FakePool


class FakeRegistry:
    def __init__(self, model: ModelInfo, fallback: ModelInfo | None = None):
        self.model = model
        self.fallback = fallback

    async def get_model(self, model_id: str, provider_code: str | None = None):
        if model_id == self.model.model_id:
            return self.model
        if self.fallback and model_id == self.fallback.model_id:
            return self.fallback
        return None


class FakeResolver:
    def __init__(self, credential: CredentialInfo | None):
        self.credential = credential

    async def get_credential(self, provider_code: str, user_id=None, credential_id=None):
        return self.credential


@pytest.mark.asyncio
async def test_resolve_routing_and_list_tasks():
    row = {
        "id": 1,
        "config_override": {"temperature": 0.5},
        "credential_id": 2,
        "custom_prompt": "custom",
        "task_code": "summary",
        "default_temperature": 0.7,
        "default_max_tokens": 100,
        "default_prompt": "default",
        "primary_model_id": 10,
        "primary_model": "gpt-test",
        "primary_provider_code": "openai",
        "primary_base_url": None,
        "fallback_model_id": None,
        "fallback_model": None,
        "fallback_provider_code": None,
    }

    def fetchrow(_query, _args):
        return row

    def fetch(_query, _args):
        return [
            {
                "code": "summary",
                "name": "Summary",
                "description": "desc",
                "default_model_type": "chat",
                "default_temperature": 0.6,
                "default_max_tokens": 120,
            }
        ]

    model = ModelInfo(
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
    credential = CredentialInfo(
        id=2,
        provider_id=1,
        provider_code="openai",
        api_type="openai_compat",
        api_key="sk-test",
        base_url="https://api.openai.com/v1",
        extra_config={},
        is_default=True,
    )

    router = ModelRouter(FakePool(FakeConn(fetch=fetch, fetchrow=fetchrow)), FakeRegistry(model), FakeResolver(credential))

    routing = await router.resolve_routing("summary", user_id=1)
    assert isinstance(routing, RoutingConfig)
    assert routing.config["temperature"] == 0.5

    tasks = await router.list_task_types()
    assert tasks[0]["code"] == "summary"


@pytest.mark.asyncio
async def test_update_routing_executes():
    executed = {"count": 0}

    def execute(_query, _args):
        executed["count"] += 1
        return "OK"

    router = ModelRouter(FakePool(FakeConn(execute=execute)), FakeRegistry(ModelInfo(
        id=1,
        provider_id=1,
        provider_code="openai",
        model_id="gpt-test",
        display_name="GPT",
        model_type="chat",
        context_window=None,
        max_output_tokens=None,
        input_cost_per_1k=None,
        output_cost_per_1k=None,
        capabilities={},
        is_enabled=True,
    )), FakeResolver(None))

    success = await router.update_routing(task_type="summary", config_override={"temperature": 0.2}, update_config=True)
    assert success is True
    assert executed["count"] == 1


@pytest.mark.asyncio
async def test_resolve_routing_missing_returns_none():
    def fetchrow(_query, _args):
        return None

    router = ModelRouter(FakePool(FakeConn(fetchrow=fetchrow)), FakeRegistry(ModelInfo(
        id=1,
        provider_id=1,
        provider_code="openai",
        model_id="gpt-test",
        display_name="GPT",
        model_type="chat",
        context_window=None,
        max_output_tokens=None,
        input_cost_per_1k=None,
        output_cost_per_1k=None,
        capabilities={},
        is_enabled=True,
    )), FakeResolver(None))
    routing = await router.resolve_routing("summary")
    assert routing is None
