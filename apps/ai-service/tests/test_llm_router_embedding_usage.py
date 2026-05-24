from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.services import llm_router as llm_router_module
from app.services.credential_resolver import CredentialInfo
from app.services.llm_router import LlmRouter
from app.services.model_router import RoutingConfig
from app.services.provider_registry import ModelInfo


class FakeUsageLogger:
    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    async def record(self, **kwargs: Any) -> None:
        self.records.append(kwargs)


class FakeMetrics:
    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    def record(self, **kwargs: Any) -> None:
        self.records.append(kwargs)


def _make_embedding_model() -> ModelInfo:
    return ModelInfo(
        id=1,
        provider_id=1,
        provider_code="oneapi",
        model_id="qwen3-embedding-8b",
        display_name="qwen3-embedding-8b",
        model_type="embedding",
        context_window=8192,
        max_output_tokens=None,
        input_cost_per_1k=None,
        output_cost_per_1k=None,
        input_cost_per_1m=0.1,
        output_cost_per_1m=0.0,
        cached_input_cost_per_1m=None,
        capabilities={},
        is_enabled=True,
    )


def _make_credential() -> CredentialInfo:
    return CredentialInfo(
        id=1,
        provider_id=1,
        provider_code="oneapi",
        api_type="openai_compat",
        api_key="sk-test",
        base_url="https://oneapi.example.com/v1",
        extra_config={},
        is_default=True,
    )


def _make_router(usage_logger: FakeUsageLogger, metrics: FakeMetrics) -> LlmRouter:
    model = _make_embedding_model()
    credential = _make_credential()
    routing = RoutingConfig(
        task_type="embedding",
        model=model,
        credential=credential,
        config={},
        prompt_template=None,
        fallback_model=None,
    )
    fake_model_router = SimpleNamespace(
        resolve_routing=AsyncMock(return_value=routing),
        pool=None,
    )
    router = LlmRouter(
        model_router=fake_model_router,
        usage_logger=usage_logger,
        metrics=metrics,
    )
    router.settings.mock_mode = False
    return router


@pytest.mark.asyncio
async def test_embed_records_usage_when_endpoint_context_is_provided(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    usage_logger = FakeUsageLogger()
    metrics = FakeMetrics()
    router = _make_router(usage_logger, metrics)

    async def fake_guard(_api_base: str | None) -> None:
        return None

    async def fake_aembedding(**kwargs: Any) -> Any:
        return SimpleNamespace(data=[{"embedding": [0.1, 0.2, 0.3]}])

    monkeypatch.setattr(router, "_guard_api_base", fake_guard)
    monkeypatch.setattr(llm_router_module, "aembedding", fake_aembedding)

    result = await router.embed(
        "hello embedding",
        user_id=7,
        usage_endpoint="/api/v1/admin/search/profiles/p/reindex/stream",
        request_id="req-embed-1",
    )

    assert result == [0.1, 0.2, 0.3]
    assert usage_logger.records
    record = usage_logger.records[0]
    assert record["user_id"] == "7"
    assert record["endpoint"] == "/api/v1/admin/search/profiles/p/reindex/stream"
    assert record["task_type"] == "embedding"
    assert record["model"] == "openai/qwen3-embedding-8b"
    assert record["provider_code"] == "oneapi"
    assert record["model_id"] == "qwen3-embedding-8b"
    assert record["tokens_in"] > 0
    assert record["tokens_out"] == 0
    assert record["success"] is True
    assert record["request_id"] == "req-embed-1"
    assert metrics.records[0]["endpoint"] == record["endpoint"]
    assert metrics.records[0]["model"] == record["model"]


@pytest.mark.asyncio
async def test_embed_records_failed_usage_before_reraising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    usage_logger = FakeUsageLogger()
    metrics = FakeMetrics()
    router = _make_router(usage_logger, metrics)

    async def fake_guard(_api_base: str | None) -> None:
        return None

    async def fake_aembedding(**kwargs: Any) -> Any:
        raise RuntimeError("upstream timeout")

    monkeypatch.setattr(router, "_guard_api_base", fake_guard)
    monkeypatch.setattr(llm_router_module, "aembedding", fake_aembedding)

    with pytest.raises(RuntimeError, match="upstream timeout"):
        await router.embed(
            "hello embedding",
            user_id=7,
            usage_endpoint="/api/v1/admin/search/profiles/p/reindex/stream",
            request_id="req-embed-2",
        )

    assert usage_logger.records
    record = usage_logger.records[0]
    assert record["success"] is False
    assert record["error_code"] == "RuntimeError: upstream timeout"
    assert record["tokens_in"] > 0
    assert metrics.records[0]["success"] is False
