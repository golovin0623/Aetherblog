from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services.provider_registry import ProviderRegistry
from tests.support import FakeConn, FakePool


def _provider_row():
    return {
        "id": 1,
        "code": "openai",
        "name": "OpenAI",
        "display_name": "OpenAI",
        "api_type": "openai_compat",
        "base_url": "https://api.openai.com",
        "doc_url": None,
        "icon": None,
        "is_enabled": True,
        "priority": 1,
        "capabilities": '{"source":"builtin"}',
        "config_schema": {"fields": []},
    }


def _model_row():
    return {
        "id": 10,
        "provider_id": 1,
        "provider_code": "openai",
        "model_id": "gpt-test",
        "display_name": "GPT Test",
        "model_type": "chat",
        "context_window": 8000,
        "max_output_tokens": 2048,
        "input_cost_per_1k": 0.001,
        "output_cost_per_1k": 0.002,
        "capabilities": '{"source":"builtin"}',
        "is_enabled": True,
    }


@pytest.mark.asyncio
async def test_list_and_get_provider_with_cache():
    def fetch(_query, _args):
        return [_provider_row()]

    def fetchrow(_query, _args):
        return _provider_row()

    conn = FakeConn(fetch=fetch, fetchrow=fetchrow)
    registry = ProviderRegistry(FakePool(conn))

    providers = await registry.list_providers(enabled_only=False)
    assert providers[0].code == "openai"

    first = await registry.get_provider("openai")
    second = await registry.get_provider("openai")
    assert first is second
    assert len(conn.fetchrow_calls) == 1


@pytest.mark.asyncio
async def test_list_and_get_models():
    def fetch(_query, _args):
        return [_model_row()]

    def fetchrow(_query, _args):
        return _model_row()

    registry = ProviderRegistry(FakePool(FakeConn(fetch=fetch, fetchrow=fetchrow)))
    models = await registry.list_models(provider_code="openai", enabled_only=False)
    assert models[0].model_id == "gpt-test"

    model = await registry.get_model("gpt-test", "openai")
    assert model is not None
    assert model.input_cost_per_1k == 0.001


@pytest.mark.asyncio
async def test_create_update_delete_provider_model():
    def fetchrow(_query, _args):
        return _provider_row()

    conn = FakeConn(fetchrow=fetchrow)
    registry = ProviderRegistry(FakePool(conn))

    created = await registry.create_provider(
        code="openai",
        name="OpenAI",
        display_name="OpenAI",
        api_type="openai_compat",
        base_url=None,
        doc_url=None,
        icon=None,
        is_enabled=True,
        priority=1,
        capabilities={},
        config_schema=None,
    )
    assert created.code == "openai"

    updated = await registry.update_provider(1, {"name": "OpenAI Inc."})
    assert updated is not None

    deleted = await registry.delete_provider(1)
    assert deleted is True


@pytest.mark.asyncio
async def test_model_mutations_and_bulk_ops():
    def fetchrow(query, _args):
        if "FROM ai_providers" in query:
            return _provider_row()
        return _model_row()

    def fetch(query, _args):
        if "DELETE FROM ai_models" in query:
            return [{"id": 1}, {"id": 2}]
        if "UPDATE ai_models" in query:
            return [{"id": 1}]
        return []

    conn = FakeConn(fetch=fetch, fetchrow=fetchrow)
    registry = ProviderRegistry(FakePool(conn))

    created = await registry.create_model(
        provider_code="openai",
        model_id="gpt-test",
        display_name="GPT Test",
        model_type="chat",
        context_window=1000,
        max_output_tokens=100,
        input_cost_per_1k=0.0,
        output_cost_per_1k=0.0,
        capabilities={},
        is_enabled=True,
    )
    assert created is not None

    updated = await registry.update_model(10, {"display_name": "Updated"})
    assert updated is not None

    deleted = await registry.delete_model(10)
    assert deleted is True

    models = [
        SimpleNamespace(
            model_id="gpt-a",
            display_name="A",
            model_type="chat",
            context_window=1000,
            max_output_tokens=100,
            input_cost_per_1k=0.0,
            output_cost_per_1k=0.0,
            capabilities={"source": "remote"},
            is_enabled=False,
        )
    ]
    inserted = await registry.bulk_insert_models("openai", models)
    assert inserted == 1
    assert conn.executemany_calls

    deleted_count = await registry.delete_models_by_provider("openai", source="remote")
    assert deleted_count == 2

    toggled = await registry.batch_toggle_models([1, 2], enabled=False)
    assert toggled == 1

    sorted_count = await registry.update_models_sort([{"id": 1, "sort": 10}])
    assert sorted_count == 1


@pytest.mark.asyncio
async def test_get_provider_and_model_by_id():
    def fetchrow(query, _args):
        if "FROM ai_providers" in query:
            return _provider_row()
        return _model_row()

    registry = ProviderRegistry(FakePool(FakeConn(fetchrow=fetchrow)))
    provider = await registry.get_provider_by_id(1)
    model = await registry.get_model_by_id(10)
    assert provider is not None
    assert model is not None
