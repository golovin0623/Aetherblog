from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.api.routes import agent as agent_module
from app.api.routes.agent import AgentChatMessage, AgentChatRequest
from app.services.llm_router import LlmRouter
from tests.support import FakeConn, FakePool


def _resolved_route(*, override: bool = True) -> LlmRouter._ResolvedRoute:
    return LlmRouter._ResolvedRoute(
        model="openai/gemini-3.1-pro-preview",
        provider_code="google-proxy",
        model_id="gemini-3.1-pro-preview",
        input_cost_per_1m=None,
        output_cost_per_1m=None,
        cached_input_cost_per_1m=None,
        api_key="sk-test",
        api_base=None,
        temperature=0.7,
        max_tokens=None,
        prompt_template=None,
        override=override,
    )


class FakeAgentRouter:
    def __init__(self, *, override_result: Any = None, override_error: Exception | None = None) -> None:
        self.model_router = SimpleNamespace(resolve_routing=None)
        self.override_result = override_result
        self.override_error = override_error
        self.override_calls: list[dict[str, Any]] = []

    async def _resolve_override(self, **kwargs: Any) -> Any:
        self.override_calls.append(kwargs)
        if self.override_error:
            raise self.override_error
        return self.override_result

    async def _guard_api_base(self, _api_base: str | None) -> None:
        return None


class FakeMetrics:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def record(self, **kwargs: Any) -> None:
        self.calls.append(kwargs)


class FakeUsageLogger:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def record(self, **kwargs: Any) -> None:
        self.calls.append(kwargs)


async def _aiter(items: list[Any]):
    for item in items:
        yield item


def _stream_part(delta: Any) -> SimpleNamespace:
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)])


@pytest.mark.asyncio
async def test_resolve_for_agent_honors_model_picker_override() -> None:
    router = FakeAgentRouter(override_result=_resolved_route())

    resolved = await agent_module._resolve_for_agent(
        router,
        user_id=7,
        model_id="gemini-3.1-pro-preview",
        provider_code="google-proxy",
    )

    assert resolved.override is True
    assert resolved.model_id == "gemini-3.1-pro-preview"
    assert router.override_calls == [
        {
            "model_id": "gemini-3.1-pro-preview",
            "provider_code": "google-proxy",
            "user_id": 7,
            "model_alias": "agent",
            "allow_override": True,
        }
    ]


@pytest.mark.asyncio
async def test_resolve_for_agent_rejects_invalid_override() -> None:
    router = FakeAgentRouter(override_error=ValueError("Requested model not found"))

    with pytest.raises(HTTPException) as exc:
        await agent_module._resolve_for_agent(
            router,
            user_id=7,
            model_id="missing-model",
            provider_code="google-proxy",
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == "Requested model not found"


@pytest.mark.asyncio
async def test_list_agent_models_exposes_provider_icon_capabilities_and_extend_params() -> None:
    def fetch(_query: str, _args: tuple[Any, ...]) -> list[dict[str, Any]]:
        return [
            {
                "id": 1,
                "provider_id": 11,
                "provider_code": "openai",
                "provider_name": "OpenAI",
                "provider_icon": "OpenAI",
                "provider_priority": 100,
                "model_id": "gpt-5",
                "display_name": "GPT-5",
                "model_type": "chat",
                "context_window": None,
                "max_output_tokens": None,
                "input_cost_per_1k": None,
                "output_cost_per_1k": None,
                "capabilities": json.dumps(
                    {
                        "abilities": {
                            "functionCall": True,
                            "vision": True,
                            "reasoning": True,
                            "structuredOutput": True,
                        },
                        "settings": {
                            "extendParams": ["gpt5ReasoningEffort", "textVerbosity"],
                            "searchImpl": "params",
                        },
                        "source": "builtin",
                        "released_at": "2025-08-07",
                        "maxToken": 400000,
                        "maxOutputTokens": 128000,
                        "description": "Flagship model",
                    }
                ),
                "is_enabled": True,
                "has_user_cred": True,
            }
        ]

    response = await agent_module.list_agent_models(
        request=None,
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        pool=FakePool(FakeConn(fetch=fetch)),
    )

    assert response.data is not None
    item = response.data[0]
    assert item.providerIcon == "OpenAI"
    assert item.contextWindow == 400000
    assert item.maxOutputTokens == 128000
    assert item.abilities["functionCall"] is True
    assert item.abilities["vision"] is True
    assert item.abilities["structuredOutput"] is True
    assert item.extendParams == ["gpt5ReasoningEffort", "textVerbosity"]
    assert item.settings["searchImpl"] == "params"
    assert item.source == "builtin"
    assert item.releasedAt == "2025-08-07"
    assert item.description == "Flagship model"
    assert item.scope == "user"
    assert item.isDefault is True


@pytest.mark.asyncio
async def test_agent_chat_passes_payload_model_to_resolver(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_resolve_for_agent(llm_router: Any, **kwargs: Any) -> LlmRouter._ResolvedRoute:
        captured["llm_router"] = llm_router
        captured.update(kwargs)
        return _resolved_route()

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    router = FakeAgentRouter()
    payload = AgentChatRequest(
        sessionId="s1",
        mode="chat",
        messages=[AgentChatMessage(role="user", content="ping")],
        modelId="gemini-3.1-pro-preview",
        providerCode="google-proxy",
    )

    response = await agent_module.agent_chat(
        request=None,
        payload=payload,
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=router,
        pool=object(),
    )

    assert response.status_code == 200
    assert captured == {
        "llm_router": router,
        "user_id": 7,
        "model_id": "gemini-3.1-pro-preview",
        "provider_code": "google-proxy",
    }


@pytest.mark.asyncio
async def test_agent_stream_splits_tagged_thinking_content() -> None:
    stream = _aiter([
        _stream_part(SimpleNamespace(content="结论前<think>分析")),
        _stream_part(SimpleNamespace(content="继续</think>正文")),
    ])

    events = [event async for event in agent_module._stream_litellm_agent_events(stream)]

    assert events == [
        {"type": "delta", "content": "结论前"},
        {"type": "think", "content": "分析继续"},
        {"type": "delta", "content": "正文"},
    ]


@pytest.mark.asyncio
async def test_agent_stream_emits_reasoning_content_as_think_event() -> None:
    stream = _aiter([
        _stream_part(SimpleNamespace(reasoning_content="先分析约束", content=None)),
        _stream_part(SimpleNamespace(content="最终回答")),
    ])

    events = [event async for event in agent_module._stream_litellm_agent_events(stream)]

    assert events == [
        {"type": "think", "content": "先分析约束"},
        {"type": "delta", "content": "最终回答"},
    ]


@pytest.mark.asyncio
async def test_agent_stream_emits_thinking_blocks_as_think_event() -> None:
    stream = _aiter([
        _stream_part(SimpleNamespace(
            thinking_blocks=[
                {"type": "thinking", "thinking": "先确认文章主旨"},
                {"type": "redacted_thinking", "data": "opaque"},
                SimpleNamespace(type="thinking", thinking="再提炼三点"),
            ],
            content=None,
        )),
        _stream_part(SimpleNamespace(content="最终回答")),
    ])

    events = [event async for event in agent_module._stream_litellm_agent_events(stream)]

    assert events == [
        {"type": "think", "content": "先确认文章主旨再提炼三点"},
        {"type": "delta", "content": "最终回答"},
    ]


@pytest.mark.asyncio
async def test_agent_stream_emits_provider_specific_reasoning_as_think_event() -> None:
    stream = _aiter([
        _stream_part(SimpleNamespace(
            provider_specific_fields={
                "reasoning_content": "代理把思考放在 provider_specific_fields",
            },
            content=None,
        )),
        _stream_part(SimpleNamespace(content="最终回答")),
    ])

    events = [event async for event in agent_module._stream_litellm_agent_events(stream)]

    assert events == [
        {"type": "think", "content": "代理把思考放在 provider_specific_fields"},
        {"type": "delta", "content": "最终回答"},
    ]


@pytest.mark.asyncio
async def test_agent_stream_splits_gemini_thought_content_parts() -> None:
    stream = _aiter([
        _stream_part(SimpleNamespace(content=[
            {"type": "text", "text": "先形成思考摘要", "thought": True},
            {"type": "text", "text": "最终回答", "thought": False},
        ])),
    ])

    events = [event async for event in agent_module._stream_litellm_agent_events(stream)]

    assert events == [
        {"type": "think", "content": "先形成思考摘要"},
        {"type": "delta", "content": "最终回答"},
    ]


@pytest.mark.asyncio
async def test_agent_stream_classifies_named_thinking_content_parts() -> None:
    stream = _aiter([
        _stream_part(SimpleNamespace(content=[
            {"type": "thinking", "thinking": "先读取引用文章"},
            {"type": "text", "text": "最终回答"},
        ])),
    ])

    events = [event async for event in agent_module._stream_litellm_agent_events(stream)]

    assert events == [
        {"type": "think", "content": "先读取引用文章"},
        {"type": "delta", "content": "最终回答"},
    ]


@pytest.mark.asyncio
async def test_build_atlas_context_uses_last_user_message_for_semantic_recall(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import atlas_recall as atlas_recall_module

    captured: dict[str, Any] = {}
    llm_router = object()
    pool = object()

    async def fake_recall_atlas_context(_pool: Any, _llm: Any, **kwargs: Any):
        captured["pool"] = _pool
        captured["llm"] = _llm
        captured.update(kwargs)
        return atlas_recall_module.AtlasRecallContext(
            knowledge_points=[
                {
                    "id": 8,
                    "title": "语义召回 KP",
                    "body_markdown": "",
                    "type": "claim",
                    "status": "evergreen",
                    "confidence": 0.8,
                    "provenance": "user",
                    "similarity": 0.76,
                    "recall_source": "semantic",
                }
            ]
        )

    monkeypatch.setattr(atlas_recall_module, "recall_atlas_context", fake_recall_atlas_context)
    monkeypatch.setattr(atlas_recall_module, "render_atlas_context", lambda _ctx: "rendered atlas")

    rendered = await agent_module._build_atlas_context_for_chat(
        pool,
        atlas_scope=agent_module.AgentAtlasScope(
            kpIds=[7],
            neighborhoodDepth=2,
            includeEvidence=False,
            semanticRecall=True,
            semanticLimit=5,
        ),
        user_id=9,
        llm_router=llm_router,
        messages=[
            AgentChatMessage(role="user", content="旧问题"),
            AgentChatMessage(role="assistant", content="旧回答"),
            AgentChatMessage(role="user", content="证据链如何影响 Atlas 召回？"),
        ],
    )

    assert rendered == "rendered atlas"
    assert captured == {
        "pool": pool,
        "llm": llm_router,
        "user_id": 9,
        "query": "证据链如何影响 Atlas 召回？",
        "kp_ids": [7],
        "carrier_ids": [],
        "semantic_limit": 5,
        "neighborhood_depth": 2,
        "include_evidence": False,
    }


@pytest.mark.asyncio
async def test_build_atlas_context_uses_empty_scope_for_semantic_recall(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import atlas_recall as atlas_recall_module

    captured: dict[str, Any] = {}
    llm_router = object()
    pool = object()

    async def fake_recall_atlas_context(_pool: Any, _llm: Any, **kwargs: Any):
        captured["pool"] = _pool
        captured["llm"] = _llm
        captured.update(kwargs)
        return atlas_recall_module.AtlasRecallContext()

    monkeypatch.setattr(atlas_recall_module, "recall_atlas_context", fake_recall_atlas_context)
    monkeypatch.setattr(atlas_recall_module, "render_atlas_context", lambda _ctx: "empty scope atlas")

    rendered = await agent_module._build_atlas_context_for_chat(
        pool,
        atlas_scope=agent_module.AgentAtlasScope(
            kpIds=[],
            neighborhoodDepth=1,
            includeEvidence=True,
            semanticRecall=True,
            semanticLimit=8,
        ),
        user_id=9,
        llm_router=llm_router,
        messages=[AgentChatMessage(role="user", content="哪些知识点可以解释当前问题？")],
    )

    assert rendered == "empty scope atlas"
    assert captured == {
        "pool": pool,
        "llm": llm_router,
        "user_id": 9,
        "query": "哪些知识点可以解释当前问题？",
        "kp_ids": [],
        "carrier_ids": [],
        "semantic_limit": 8,
        "neighborhood_depth": 1,
        "include_evidence": True,
    }


@pytest.mark.asyncio
async def test_agent_chat_records_usage_log_for_stream(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_completion_kwargs: dict[str, Any] = {}

    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any) -> LlmRouter._ResolvedRoute:
        return _resolved_route()

    async def fake_acompletion(**kwargs: Any):
        captured_completion_kwargs.update(kwargs)
        return _aiter([
            _stream_part(SimpleNamespace(reasoning_content="先想", content=None)),
            _stream_part(SimpleNamespace(content="最终回答")),
        ])

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    metrics = FakeMetrics()
    usage_logger = FakeUsageLogger()
    request = SimpleNamespace(
        url=SimpleNamespace(path="/api/v1/agent/chat"),
        state=SimpleNamespace(request_id="req-agent"),
    )
    payload = AgentChatRequest(
        sessionId="s1",
        mode="chat",
        messages=[AgentChatMessage(role="user", content="ping")],
        modelId="gemini-3.1-pro-preview",
        providerCode="google-proxy",
    )

    response = await agent_module.agent_chat(
        request=request,
        payload=payload,
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=object(),
        metrics=metrics,
        usage_logger=usage_logger,
    )

    body = ""
    async for chunk in response.body_iterator:
        body += chunk.decode() if isinstance(chunk, bytes) else chunk

    assert '"type": "think"' in body
    assert '"type": "delta"' in body
    assert usage_logger.calls == [
        {
            "user_id": "7",
            "endpoint": "/api/v1/agent/chat",
            "task_type": "agent_chat",
            "provider_code": "google-proxy",
            "model_id": "gemini-3.1-pro-preview",
            "model": "openai/gemini-3.1-pro-preview",
            "input_cost_per_1m": None,
            "output_cost_per_1m": None,
            "cached_input_cost_per_1m": None,
            "request_chars": usage_logger.calls[0]["request_chars"],
            "response_chars": len("先想最终回答"),
            "tokens_in": usage_logger.calls[0]["tokens_in"],
            "tokens_out": usage_logger.calls[0]["tokens_out"],
            "latency_ms": usage_logger.calls[0]["latency_ms"],
            "success": True,
            "cached": False,
            "error_code": None,
            "request_id": "req-agent",
        }
    ]
    assert usage_logger.calls[0]["request_chars"] > len("ping")
    assert usage_logger.calls[0]["tokens_in"] > 0
    assert usage_logger.calls[0]["tokens_out"] > 0
    assert metrics.calls[0]["endpoint"] == "/api/v1/agent/chat"
    assert metrics.calls[0]["success"] is True
    assert captured_completion_kwargs["reasoning_effort"] == "low"
    assert captured_completion_kwargs["extra_body"] == {
        "extra_body": {"google": {"thinking_config": {"include_thoughts": True}}},
    }
    assert captured_completion_kwargs["allowed_openai_params"] == [
        "reasoning_effort",
        "extra_body",
    ]
