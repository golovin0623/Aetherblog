"""灵境 Agent 对话：vision 内容通道 / usage 事件 / 模型定价下发。

覆盖三块能力的 fail-closed 校验与协议形态：
  1. content-parts（文本 + 内联图片 data URL）的 schema 校验与文本提取；
  2. stream_options.include_usage 的真实用量下发、估算兜底与降级重试；
  3. /agent/models 的 inputCostPer1M / outputCostPer1M 定价来源优先级。
"""

from __future__ import annotations

import base64
import json
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.routes import agent as agent_module
from app.api.routes.agent import AgentChatMessage, AgentChatRequest
from app.services.usage_logger import estimate_tokens
from tests.support import FakeConn, FakePool
from tests.test_agent_routes import (
    FakeAgentRouter,
    FakeMetrics,
    FakeUsageLogger,
    _aiter,
    _collect_sse_events,
    _request,
    _resolved_route,
    _stream_part,
)


def _image_data_url(payload: bytes = b"\x89PNG-fake-image-bytes") -> str:
    return "data:image/png;base64," + base64.b64encode(payload).decode()


def _image_part(url: str | None = None) -> dict[str, Any]:
    return {"type": "image_url", "image_url": {"url": url or _image_data_url()}}


def _text_part(text: str = "看这张图") -> dict[str, Any]:
    return {"type": "text", "text": text}


def _vision_request(**overrides: Any) -> AgentChatRequest:
    values: dict[str, Any] = {
        "sessionId": "s-vision",
        "messages": [
            AgentChatMessage(role="user", content=[_text_part(), _image_part()]),
        ],
    }
    values.update(overrides)
    return AgentChatRequest(**values)


# ============================================================================
# content-parts schema 校验
# ============================================================================

def test_content_parts_accepts_text_and_data_url_image() -> None:
    message = AgentChatMessage(role="user", content=[_text_part("A"), _image_part(), _text_part("B")])

    assert agent_module._message_text(message) == "AB"
    assert agent_module._message_image_count(message) == 1


def test_message_text_returns_plain_string_content_unchanged() -> None:
    message = AgentChatMessage(role="user", content="纯文本")

    assert agent_module._message_text(message) == "纯文本"
    assert agent_module._message_image_count(message) == 0


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example.com/a.png",
        "http://127.0.0.1/internal.png",
        "data:image/svg+xml;base64,QUJD",
        "data:application/pdf;base64,QUJD",
        "data:image/png;base64,not!!valid@@base64",
    ],
)
def test_content_parts_rejects_non_inline_or_non_image_urls(url: str) -> None:
    with pytest.raises(ValidationError):
        AgentChatMessage(role="user", content=[_image_part(url)])


def test_content_parts_rejects_invalid_base64_padding() -> None:
    # 字符集合法（regex 放行）但 '=' 位置非法，解码阶段必须拒绝。
    with pytest.raises(ValidationError):
        AgentChatMessage(role="user", content=[_image_part("data:image/png;base64,QUJ=RA")])


def test_content_parts_rejects_image_over_5mb() -> None:
    oversized = _image_data_url(b"\x00" * (5 * 1024 * 1024 + 16))
    with pytest.raises(ValidationError):
        AgentChatMessage(role="user", content=[_image_part(oversized)])


def test_content_parts_accepts_image_at_5mb_boundary() -> None:
    boundary = _image_data_url(b"\x00" * (5 * 1024 * 1024))
    message = AgentChatMessage(role="user", content=[_image_part(boundary)])
    assert agent_module._message_image_count(message) == 1


def test_content_parts_rejects_empty_array() -> None:
    with pytest.raises(ValidationError):
        AgentChatMessage(role="user", content=[])


def test_content_parts_rejects_more_than_four_images_per_message() -> None:
    with pytest.raises(ValidationError):
        AgentChatMessage(role="user", content=[_image_part() for _ in range(5)])
    # 4 张是上限内。
    message = AgentChatMessage(role="user", content=[_image_part() for _ in range(4)])
    assert agent_module._message_image_count(message) == 4


def test_content_parts_rejects_more_than_sixteen_parts() -> None:
    # DoS 防线：片段数封顶必须在逐片段解析之前短路。片段故意缺 "text" 字段——
    # 若 per-part 校验先跑，报错会是缺字段而不是中文片段数文案。
    with pytest.raises(ValidationError, match="消息内容片段过多"):
        AgentChatMessage(role="user", content=[{"type": "text"}] * 17)
    # 16 个片段是上限内。
    message = AgentChatMessage(
        role="user",
        content=[_text_part(str(i)) for i in range(16)],
    )
    assert agent_module._message_text(message) == "".join(str(i) for i in range(16))


def test_request_rejects_more_than_eight_images_total() -> None:
    messages = [
        AgentChatMessage(role="user", content=[_image_part() for _ in range(3)])
        for _ in range(3)
    ]
    with pytest.raises(ValidationError):
        AgentChatRequest(sessionId="s-images", messages=messages)


def test_enforce_message_limits_counts_only_text_parts() -> None:
    # 大图 + 短文本不应触发 8000 字符文本硬限。
    big_image = _image_data_url(b"\x00" * (1024 * 1024))
    ok = AgentChatRequest(
        sessionId="s-limits",
        messages=[AgentChatMessage(role="user", content=[_text_part("短问题"), _image_part(big_image)])],
    )
    agent_module._enforce_message_limits(ok)

    with pytest.raises(HTTPException) as exc:
        agent_module._enforce_message_limits(
            AgentChatRequest(
                sessionId="s-limits-2",
                messages=[AgentChatMessage(role="user", content=[_text_part("超" * 9000)])],
            )
        )
    assert exc.value.status_code == 413


def test_build_chat_messages_serializes_content_parts_for_litellm() -> None:
    req = _vision_request()
    messages = agent_module._build_chat_messages(req)

    user_message = messages[-1]
    assert isinstance(user_message["content"], list)
    assert user_message["content"][0] == {"type": "text", "text": "看这张图"}
    assert user_message["content"][1]["type"] == "image_url"
    assert user_message["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_last_user_query_skips_image_parts() -> None:
    req = _vision_request()
    assert agent_module._last_user_query(req.messages) == "看这张图"


def test_usage_request_text_replaces_images_with_placeholder() -> None:
    req = _vision_request()
    text = agent_module._agent_usage_request_text(agent_module._build_chat_messages(req))
    assert "[image]" in text
    assert "base64" not in text


# ============================================================================
# vision 能力闸门
# ============================================================================

def _caps_row(caps: dict[str, Any] | None) -> dict[str, Any] | None:
    if caps is None:
        return None
    return {"capabilities": json.dumps(caps)}


@pytest.mark.asyncio
async def test_vision_gate_rejects_model_without_vision_ability() -> None:
    pool = FakePool(FakeConn(fetchrow=lambda _q, _a: _caps_row({"abilities": {"vision": False}})))

    with pytest.raises(HTTPException) as exc:
        await agent_module._ensure_vision_capability(pool, _resolved_route(), _vision_request())

    assert exc.value.status_code == 400
    assert exc.value.detail == "所选模型不支持图片输入，请更换支持视觉能力的模型"


@pytest.mark.asyncio
async def test_vision_gate_fails_closed_when_model_row_missing() -> None:
    pool = FakePool(FakeConn(fetchrow=lambda _q, _a: None))

    with pytest.raises(HTTPException) as exc:
        await agent_module._ensure_vision_capability(pool, _resolved_route(), _vision_request())

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_vision_gate_allows_model_with_vision_ability() -> None:
    pool = FakePool(FakeConn(fetchrow=lambda _q, _a: _caps_row({"abilities": {"vision": True}})))

    await agent_module._ensure_vision_capability(pool, _resolved_route(), _vision_request())


@pytest.mark.asyncio
async def test_vision_gate_skips_lookup_for_text_only_request() -> None:
    conn = FakeConn()
    await agent_module._ensure_vision_capability(
        FakePool(conn),
        _resolved_route(),
        AgentChatRequest(sessionId="s-text", messages=[AgentChatMessage(role="user", content="纯文本")]),
    )
    assert conn.fetchrow_calls == []


@pytest.mark.asyncio
async def test_agent_chat_blocks_image_payload_before_provider_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    async def forbidden_acompletion(**_kwargs: Any):
        raise AssertionError("vision gate must reject before the provider is called")

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", forbidden_acompletion)

    pool = FakePool(FakeConn(fetchrow=lambda _q, _a: _caps_row({"abilities": {"vision": False}})))
    with pytest.raises(HTTPException) as exc:
        await agent_module.agent_chat(
            request=_request(),
            payload=_vision_request(),
            user=SimpleNamespace(user_id="system", role="admin"),
            forwarded_user_id="7",
            llm_router=FakeAgentRouter(),
            pool=pool,
            metrics=FakeMetrics(),
            usage_logger=FakeUsageLogger(),
        )

    assert exc.value.status_code == 400
    assert "不支持图片输入" in exc.value.detail


# ============================================================================
# usage 事件（真实用量 / 估算兜底 / 降级重试）
# ============================================================================

def _usage_chunk(prompt: int, completion: int, total: int | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[],
        usage=SimpleNamespace(
            prompt_tokens=prompt,
            completion_tokens=completion,
            total_tokens=total if total is not None else prompt + completion,
        ),
    )


@pytest.mark.asyncio
async def test_stream_events_yield_usage_after_content() -> None:
    stream = _aiter([
        _stream_part(SimpleNamespace(content="正文")),
        SimpleNamespace(choices=[], usage={"prompt_tokens": 10, "completion_tokens": 3}),
    ])

    events = [event async for event in agent_module._stream_litellm_agent_events(stream)]

    assert events == [
        {"type": "delta", "content": "正文"},
        {"type": "usage", "promptTokens": 10, "completionTokens": 3, "totalTokens": 13},
    ]


@pytest.mark.asyncio
async def test_agent_chat_emits_real_usage_event_and_records_real_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_kwargs: dict[str, Any] = {}

    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    async def fake_acompletion(**kwargs: Any):
        captured_kwargs.update(kwargs)
        return _aiter([
            _stream_part(SimpleNamespace(content="最终回答")),
            _usage_chunk(120, 45),
        ])

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    usage_logger = FakeUsageLogger()
    response = await agent_module.agent_chat(
        request=_request(),
        payload=AgentChatRequest(
            sessionId="s-usage",
            messages=[AgentChatMessage(role="user", content="ping")],
        ),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=object(),
        metrics=FakeMetrics(),
        usage_logger=usage_logger,
    )
    events = await _collect_sse_events(response)

    assert [event["type"] for event in events] == ["delta", "usage", "done"]
    assert events[1] == {
        "type": "usage",
        "promptTokens": 120,
        "completionTokens": 45,
        "totalTokens": 165,
        "estimated": False,
    }
    assert captured_kwargs["stream_options"] == {"include_usage": True}
    # 落库优先使用真实 usage，而不是本地估算。
    assert usage_logger.calls[0]["tokens_in"] == 120
    assert usage_logger.calls[0]["tokens_out"] == 45


@pytest.mark.asyncio
async def test_agent_chat_falls_back_to_estimated_usage_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    async def fake_acompletion(**_kwargs: Any):
        return _aiter([_stream_part(SimpleNamespace(content="没有用量的回答"))])

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    response = await agent_module.agent_chat(
        request=_request(),
        payload=AgentChatRequest(
            sessionId="s-estimated",
            messages=[AgentChatMessage(role="user", content="ping")],
        ),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=object(),
        metrics=FakeMetrics(),
        usage_logger=FakeUsageLogger(),
    )
    events = await _collect_sse_events(response)

    assert [event["type"] for event in events] == ["delta", "usage", "done"]
    usage = events[1]
    assert usage["estimated"] is True
    assert usage["promptTokens"] > 0
    assert usage["completionTokens"] > 0
    assert usage["totalTokens"] == usage["promptTokens"] + usage["completionTokens"]


def test_extract_stream_usage_preserves_missing_side_as_none() -> None:
    # 单侧缺失时保留 None——填 0 会被下游当成真值，计费口径静默降低。
    chunk = SimpleNamespace(
        choices=[],
        usage=SimpleNamespace(prompt_tokens=None, completion_tokens=45, total_tokens=None),
    )
    assert agent_module._extract_stream_usage(chunk) == {
        "promptTokens": None,
        "completionTokens": 45,
        "totalTokens": None,
    }


def test_extract_stream_usage_returns_none_when_both_sides_missing() -> None:
    # 两侧都缺时整体视为「没有真实 usage」，即便 total 单独出现也不采信。
    chunk = SimpleNamespace(
        choices=[],
        usage=SimpleNamespace(prompt_tokens=None, completion_tokens=None, total_tokens=999),
    )
    assert agent_module._extract_stream_usage(chunk) is None


def test_agent_usage_event_estimates_only_the_missing_side() -> None:
    event = agent_module._agent_usage_event(
        {"promptTokens": None, "completionTokens": 45, "totalTokens": None},
        request_text="问" * 400,
        output_text="答" * 40,
    )
    assert event["estimated"] is True
    assert event["completionTokens"] == 45
    assert event["promptTokens"] == estimate_tokens("问" * 400)
    assert event["totalTokens"] == event["promptTokens"] + 45


@pytest.mark.asyncio
async def test_agent_chat_marks_partial_provider_usage_as_estimated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """部分网关只回单侧 usage：缺失侧回退估算且 estimated 必须为 true。"""

    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    async def fake_acompletion(**_kwargs: Any):
        return _aiter([
            _stream_part(SimpleNamespace(content="最终回答")),
            SimpleNamespace(
                choices=[],
                usage=SimpleNamespace(prompt_tokens=None, completion_tokens=45, total_tokens=None),
            ),
        ])

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    usage_logger = FakeUsageLogger()
    response = await agent_module.agent_chat(
        request=_request(),
        payload=AgentChatRequest(
            sessionId="s-partial-usage",
            messages=[AgentChatMessage(role="user", content="ping")],
        ),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=object(),
        metrics=FakeMetrics(),
        usage_logger=usage_logger,
    )
    events = await _collect_sse_events(response)

    assert [event["type"] for event in events] == ["delta", "usage", "done"]
    usage = events[1]
    # 真值侧保留真值，缺失侧为估算值（>0），整条标 estimated。
    assert usage["estimated"] is True
    assert usage["completionTokens"] == 45
    assert usage["promptTokens"] > 0
    assert usage["totalTokens"] == usage["promptTokens"] + 45
    # 落库同口径：tokens_out 用真值，tokens_in 用与 SSE 事件一致的估算值。
    assert usage_logger.calls[0]["tokens_out"] == 45
    assert usage_logger.calls[0]["tokens_in"] == usage["promptTokens"]


@pytest.mark.asyncio
async def test_agent_chat_error_path_never_emits_usage_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    async def failing_stream():
        yield _stream_part(SimpleNamespace(content="部分输出"))
        raise RuntimeError("provider broke mid-stream")

    async def fake_acompletion(**_kwargs: Any):
        return failing_stream()

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    response = await agent_module.agent_chat(
        request=_request(),
        payload=AgentChatRequest(
            sessionId="s-error",
            messages=[AgentChatMessage(role="user", content="ping")],
        ),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=object(),
        metrics=FakeMetrics(),
        usage_logger=FakeUsageLogger(),
    )
    events = await _collect_sse_events(response)

    assert [event["type"] for event in events] == ["delta", "error"]


def test_stream_options_rejection_detects_naming_variants() -> None:
    # 不同网关的报错文案对参数名写法不一，归一化后都要能触发降级。
    for message in (
        "Provider error: stream_options is not supported",
        "Unknown parameter: streamOptions",
        "stream-options rejected by upstream gateway",
        "Stream Options is not available for this model",
    ):
        assert agent_module._looks_like_stream_options_rejection(RuntimeError(message)), message
    # 无关错误不能误触发降级（否则真实故障被吞成静默重试）。
    for message in ("rate limit exceeded", "invalid api key", "stream closed unexpectedly"):
        assert not agent_module._looks_like_stream_options_rejection(RuntimeError(message)), message


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "rejection_message",
    [
        "Provider error: stream_options is not supported",
        # 变体文案（camelCase / 连字符）也必须走同一条降级路径。
        "Unsupported parameter: streamOptions",
        "stream-options rejected by upstream gateway",
    ],
)
async def test_agent_chat_retries_without_stream_options_when_rejected(
    monkeypatch: pytest.MonkeyPatch,
    rejection_message: str,
) -> None:
    calls: list[dict[str, Any]] = []

    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    async def fake_acompletion(**kwargs: Any):
        calls.append(kwargs)
        if len(calls) == 1:
            raise RuntimeError(rejection_message)
        return _aiter([_stream_part(SimpleNamespace(content="降级后的回答"))])

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    response = await agent_module.agent_chat(
        request=_request(),
        payload=AgentChatRequest(
            sessionId="s-degrade",
            messages=[AgentChatMessage(role="user", content="ping")],
        ),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=object(),
        metrics=FakeMetrics(),
        usage_logger=FakeUsageLogger(),
    )
    events = await _collect_sse_events(response)

    assert len(calls) == 2
    assert calls[0]["stream_options"] == {"include_usage": True}
    assert "stream_options" not in calls[1]
    assert [event["type"] for event in events] == ["delta", "usage", "done"]
    assert events[1]["estimated"] is True


# ============================================================================
# /agent/models 定价下发
# ============================================================================

def _model_row(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": 1,
        "provider_id": 11,
        "provider_code": "openai",
        "provider_name": "OpenAI",
        "provider_icon": None,
        "provider_priority": 100,
        "model_id": "gpt-5",
        "display_name": "GPT-5",
        "model_type": "chat",
        "context_window": None,
        "max_output_tokens": None,
        "input_cost_per_1k": None,
        "output_cost_per_1k": None,
        "capabilities": "{}",
        "is_enabled": True,
        "has_user_cred": False,
    }
    row.update(overrides)
    return row


@pytest.mark.asyncio
async def test_list_agent_models_exposes_pricing_per_1m() -> None:
    def fetch(_query: str, _args: tuple[Any, ...]) -> list[dict[str, Any]]:
        return [
            # per_1k 列优先（asyncpg 返回 Decimal），×1000 换算成 per_1m。
            _model_row(
                id=1,
                model_id="gpt-5",
                input_cost_per_1k=Decimal("0.0025"),
                output_cost_per_1k=Decimal("0.01"),
            ),
            # per_1k 缺失时回退 capabilities.pricing。
            _model_row(
                id=2,
                model_id="gpt-5-mini",
                capabilities=json.dumps({"pricing": {"input": 1.25, "output": 5.0}}),
            ),
            # 两个来源都缺 → None 传播，不得杜撰 0。
            _model_row(id=3, model_id="gpt-5-nano"),
        ]

    response = await agent_module.list_agent_models(
        request=None,
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        pool=FakePool(FakeConn(fetch=fetch)),
    )

    assert response.data is not None
    by_model = {item.modelId: item for item in response.data}
    assert by_model["gpt-5"].inputCostPer1M == 2.5
    assert by_model["gpt-5"].outputCostPer1M == 10.0
    assert by_model["gpt-5-mini"].inputCostPer1M == 1.25
    assert by_model["gpt-5-mini"].outputCostPer1M == 5.0
    assert by_model["gpt-5-nano"].inputCostPer1M is None
    assert by_model["gpt-5-nano"].outputCostPer1M is None
