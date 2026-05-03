"""LlmRouter fallback path coverage.

审计 §1.3 P1.3 跟进。schema (ai_task_routing.fallback_model_id) + 加载逻辑
(model_router.resolve_routing) + 运行时切换 (LlmRouter.chat / stream_chat)
全链路其实早就实现了, 但零测试覆盖, 唯一保证是 docker logs 里 grep
"primary_failed_using_fallback" 字样, 任何对 try/except 边界的微调 (例如
PR 把 Exception 改成更窄的类型) 都可能让 fallback 变成"摆设"。

本文件锁住三件最容易被未来 refactor 破坏的合约:
  1. chat 在 primary acompletion 抛出且 routing.fallback_model 非空时, 透
     明切到 fallback model 并返回其输出。
  2. chat 在 primary 抛出但路由没有 fallback (或路由是 user-override, 即
     resolved.override=True) 时, 必须把原始异常重新抛出 -- 不能默默吞掉。
  3. stream_chat 仅在第一个 chunk 到达 *之前* 失败时才切到 fallback;
     一旦已经 yield 过内容, 中途切换会产出半截破损 SSE 流, 必须直接抛。
"""
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


# ============================================================
# 辅助构造器
# ============================================================

def _make_model(model_id: str, provider_code: str = "openai") -> ModelInfo:
    return ModelInfo(
        id=hash(model_id) & 0xFFFF,
        provider_id=1,
        provider_code=provider_code,
        model_id=model_id,
        display_name=model_id,
        model_type="chat",
        context_window=8000,
        max_output_tokens=2048,
        input_cost_per_1k=None,
        output_cost_per_1k=None,
        input_cost_per_1m=None,
        output_cost_per_1m=None,
        cached_input_cost_per_1m=None,
        capabilities={},
        is_enabled=True,
    )


def _make_credential(api_key: str = "sk-test", provider_code: str = "openai") -> CredentialInfo:
    return CredentialInfo(
        id=1,
        provider_id=1,
        provider_code=provider_code,
        api_type="openai",
        api_key=api_key,
        base_url=None,
        extra_config={},
        is_default=True,
    )


def _make_routing(
    *,
    primary: ModelInfo,
    fallback: ModelInfo | None,
    credential: CredentialInfo,
) -> RoutingConfig:
    return RoutingConfig(
        task_type="summary",
        model=primary,
        credential=credential,
        config={"temperature": 0.7, "max_tokens": 200},
        prompt_template="default",
        fallback_model=fallback,
    )


def _make_resolved(
    *,
    model: str = "openai/gpt-test",
    override: bool = False,
) -> LlmRouter._ResolvedRoute:
    return LlmRouter._ResolvedRoute(
        model=model,
        provider_code="openai",
        model_id=model.split("/", 1)[-1],
        input_cost_per_1m=None,
        output_cost_per_1m=None,
        cached_input_cost_per_1m=None,
        api_key="sk-test",
        api_base=None,
        temperature=0.7,
        max_tokens=200,
        prompt_template="default",
        override=override,
    )


def _wire_router(
    monkeypatch: pytest.MonkeyPatch,
    *,
    routing: RoutingConfig | None,
    fallback_credential: CredentialInfo | None = None,
    resolved_override: bool = False,
) -> LlmRouter:
    """构造一个最小 LlmRouter, 把所有 DB 触点 stub 成可控值。"""
    fake_resolver = SimpleNamespace()
    fake_resolver.get_credential = AsyncMock(return_value=fallback_credential)

    fake_model_router = SimpleNamespace()
    fake_model_router.credential_resolver = fake_resolver
    fake_model_router.resolve_routing = AsyncMock(return_value=routing)
    fake_model_router.pool = None  # _load_task_type_prompt 看到 pool=None 直接返回

    router = LlmRouter(model_router=fake_model_router)
    router.settings.mock_mode = False

    async def fake_resolve_route(*_args: Any, **_kwargs: Any) -> LlmRouter._ResolvedRoute:
        return _make_resolved(override=resolved_override)

    async def fake_guard_api_base(_self: Any, _api_base: str | None) -> None:
        return None

    monkeypatch.setattr(LlmRouter, "_resolve_route", fake_resolve_route)
    # _guard_api_base 是 instance method, 直接用 lambda 覆盖
    monkeypatch.setattr(
        LlmRouter,
        "_guard_api_base",
        lambda self, _api_base=None: _noop_coro(),
    )
    return router


async def _noop_coro() -> None:
    return None


# ============================================================
# chat() 路径
# ============================================================

@pytest.mark.asyncio
async def test_chat_falls_back_when_primary_throws(monkeypatch: pytest.MonkeyPatch) -> None:
    """primary acompletion 抛出 + 路由有 fallback → 切到 fallback 返回内容。"""
    primary = _make_model("gpt-primary")
    fallback = _make_model("gpt-fallback")
    cred = _make_credential()
    routing = _make_routing(primary=primary, fallback=fallback, credential=cred)
    router = _wire_router(monkeypatch, routing=routing, fallback_credential=cred)

    call_log: list[str] = []

    async def fake_acompletion(**kwargs: Any) -> Any:
        call_log.append(kwargs["model"])
        if kwargs["model"] == "openai/gpt-test":  # primary
            raise RuntimeError("primary boom")
        # fallback
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="fallback content"))]
        )

    monkeypatch.setattr(llm_router_module, "acompletion", fake_acompletion)

    result = await router.chat("hello", model_alias="summary")

    assert result == "fallback content"
    # 调用了两次: 一次 primary (失败), 一次 fallback (成功)
    assert len(call_log) == 2
    assert call_log[0] == "openai/gpt-test"
    assert call_log[1].endswith("gpt-fallback")


@pytest.mark.asyncio
async def test_chat_raises_when_no_fallback_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """primary 抛出 + 路由无 fallback → 必须重新抛出原异常, 不能吞。"""
    primary = _make_model("gpt-primary")
    cred = _make_credential()
    routing = _make_routing(primary=primary, fallback=None, credential=cred)
    router = _wire_router(monkeypatch, routing=routing)

    async def fake_acompletion(**_kwargs: Any) -> Any:
        raise RuntimeError("primary boom")

    monkeypatch.setattr(llm_router_module, "acompletion", fake_acompletion)

    with pytest.raises(RuntimeError, match="primary boom"):
        await router.chat("hello", model_alias="summary")


@pytest.mark.asyncio
async def test_chat_does_not_fall_back_when_user_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """resolved.override=True (用户在 UI 选了 modelId) → 不应触发 fallback。"""
    primary = _make_model("gpt-primary")
    fallback = _make_model("gpt-fallback")
    cred = _make_credential()
    routing = _make_routing(primary=primary, fallback=fallback, credential=cred)
    router = _wire_router(
        monkeypatch,
        routing=routing,
        fallback_credential=cred,
        resolved_override=True,
    )

    call_log: list[str] = []

    async def fake_acompletion(**kwargs: Any) -> Any:
        call_log.append(kwargs["model"])
        raise RuntimeError("primary boom")

    monkeypatch.setattr(llm_router_module, "acompletion", fake_acompletion)

    with pytest.raises(RuntimeError, match="primary boom"):
        await router.chat("hello", model_alias="summary", model_id="gpt-test")

    # 仅尝试了 primary, 没有切到 fallback (override 路径)
    assert len(call_log) == 1


@pytest.mark.asyncio
async def test_chat_raises_primary_when_fallback_lookup_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """fallback credential 查询失败时, 不应淹没原始 primary 异常。"""
    primary = _make_model("gpt-primary")
    fallback = _make_model("gpt-fallback")
    cred = _make_credential()
    routing = _make_routing(primary=primary, fallback=fallback, credential=cred)
    router = _wire_router(monkeypatch, routing=routing, fallback_credential=cred)
    router.model_router.credential_resolver.get_credential = AsyncMock(
        side_effect=RuntimeError("fallback credential db down")
    )

    async def fake_acompletion(**_kwargs: Any) -> Any:
        raise RuntimeError("primary boom")

    monkeypatch.setattr(llm_router_module, "acompletion", fake_acompletion)

    with pytest.raises(RuntimeError, match="primary boom"):
        await router.chat("hello", model_alias="summary")


# ============================================================
# stream_chat() 路径
# ============================================================

class _AsyncIter:
    """简易 async iterator over a list of chunks."""

    def __init__(self, chunks: list[Any]) -> None:
        self._chunks = chunks
        self._idx = 0

    def __aiter__(self) -> "_AsyncIter":
        return self

    async def __anext__(self) -> Any:
        if self._idx >= len(self._chunks):
            raise StopAsyncIteration
        item = self._chunks[self._idx]
        self._idx += 1
        if isinstance(item, Exception):
            raise item
        return item


def _delta_chunk(content: str) -> Any:
    """LiteLLM-style stream chunk."""
    return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=content))])


@pytest.mark.asyncio
async def test_stream_chat_falls_back_before_first_chunk(monkeypatch: pytest.MonkeyPatch) -> None:
    """primary stream 在第一个 chunk 之前抛 → 切到 fallback 完成流。"""
    primary = _make_model("gpt-primary")
    fallback = _make_model("gpt-fallback")
    cred = _make_credential()
    routing = _make_routing(primary=primary, fallback=fallback, credential=cred)
    router = _wire_router(monkeypatch, routing=routing, fallback_credential=cred)

    call_log: list[str] = []

    async def fake_acompletion(**kwargs: Any) -> Any:
        call_log.append(kwargs["model"])
        if kwargs["model"] == "openai/gpt-test":
            # primary: 还没产出任何 chunk 就抛
            raise RuntimeError("primary boom before first chunk")
        # fallback: 正常吐两个 chunk
        return _AsyncIter([_delta_chunk("fb-1"), _delta_chunk("fb-2")])

    monkeypatch.setattr(llm_router_module, "acompletion", fake_acompletion)

    chunks: list[str] = []
    async for piece in router.stream_chat("hello", model_alias="summary"):
        chunks.append(piece)

    assert chunks == ["fb-1", "fb-2"]
    assert len(call_log) == 2  # primary + fallback


@pytest.mark.asyncio
async def test_stream_chat_does_not_fall_back_after_first_chunk(monkeypatch: pytest.MonkeyPatch) -> None:
    """primary 已经 yield 过 chunk 后才失败 → 必须抛, 不能切到 fallback (会破坏前端已渲染部分)。"""
    primary = _make_model("gpt-primary")
    fallback = _make_model("gpt-fallback")
    cred = _make_credential()
    routing = _make_routing(primary=primary, fallback=fallback, credential=cred)
    router = _wire_router(monkeypatch, routing=routing, fallback_credential=cred)

    fallback_invoked = False

    async def fake_acompletion(**kwargs: Any) -> Any:
        nonlocal fallback_invoked
        if kwargs["model"] == "openai/gpt-test":
            # primary: 先吐 1 个 chunk, 再抛
            return _AsyncIter([_delta_chunk("primary-1"), RuntimeError("mid-stream boom")])
        fallback_invoked = True
        return _AsyncIter([_delta_chunk("should-never-render")])

    monkeypatch.setattr(llm_router_module, "acompletion", fake_acompletion)

    received: list[str] = []
    with pytest.raises(RuntimeError, match="mid-stream boom"):
        async for piece in router.stream_chat("hello", model_alias="summary"):
            received.append(piece)

    # 已 yield 的内容保留, 后续 fallback **绝不**被调用
    assert received == ["primary-1"]
    assert fallback_invoked is False


@pytest.mark.asyncio
async def test_stream_chat_raises_when_no_fallback_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """primary stream 起手抛 + 路由无 fallback → 重新抛出原异常。"""
    primary = _make_model("gpt-primary")
    cred = _make_credential()
    routing = _make_routing(primary=primary, fallback=None, credential=cred)
    router = _wire_router(monkeypatch, routing=routing)

    async def fake_acompletion(**_kwargs: Any) -> Any:
        raise RuntimeError("stream boom")

    monkeypatch.setattr(llm_router_module, "acompletion", fake_acompletion)

    with pytest.raises(RuntimeError, match="stream boom"):
        async for _ in router.stream_chat("hello", model_alias="summary"):
            pass


@pytest.mark.asyncio
async def test_stream_chat_raises_primary_when_fallback_lookup_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """stream 起手失败后若 fallback 凭证查询也失败, 应抛回 primary 异常。"""
    primary = _make_model("gpt-primary")
    fallback = _make_model("gpt-fallback")
    cred = _make_credential()
    routing = _make_routing(primary=primary, fallback=fallback, credential=cred)
    router = _wire_router(monkeypatch, routing=routing, fallback_credential=cred)
    router.model_router.credential_resolver.get_credential = AsyncMock(
        side_effect=RuntimeError("fallback credential db down")
    )

    async def fake_acompletion(**_kwargs: Any) -> Any:
        raise RuntimeError("stream boom")

    monkeypatch.setattr(llm_router_module, "acompletion", fake_acompletion)

    with pytest.raises(RuntimeError, match="stream boom"):
        async for _ in router.stream_chat("hello", model_alias="summary"):
            pass
