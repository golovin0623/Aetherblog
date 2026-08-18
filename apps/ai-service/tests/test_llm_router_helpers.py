"""llm_router 路由解析辅助函数的单元测试。

覆盖：模型名 provider 前缀归一、chat 能力判定（NON_CHAT denylist）、
温度锁定家族识别、max_tokens / 成本预算裁剪、LiteLLM 前缀规则、
ai_task_types prompt 兜底查询、以及环境变量回退路径的 usage context 解析。
"""
from __future__ import annotations

import math
from types import SimpleNamespace

import pytest

from app.services.llm_router import (
    LlmRouter,
    _budgeted_max_tokens,
    _effective_max_tokens,
    _estimate_chat_usage,
    _is_chat_capable_model,
    _model_locks_temperature,
    _normalize_model_parts,
    _stringify_messages_for_budget,
)
from app.services.usage_logger import estimate_tokens
from tests.support import FakeConn, FakePool


# ------------------------------------------------------------------
# _normalize_model_parts / _is_chat_capable_model / 温度锁
# ------------------------------------------------------------------
@pytest.mark.parametrize(
    ("model", "expected"),
    [
        (None, (None, None)),
        ("", (None, None)),
        ("gpt-4o", (None, "gpt-4o")),
        ("openai/gpt-4o", ("openai", "gpt-4o")),
        ("openrouter/anthropic/claude-3", ("openrouter", "anthropic/claude-3")),
    ],
)
def test_normalize_model_parts(model, expected):
    assert _normalize_model_parts(model) == expected


def test_is_chat_capable_model_denylist_and_capability_flag():
    assert _is_chat_capable_model(SimpleNamespace(model_type=None, capabilities={})) is True
    assert _is_chat_capable_model(SimpleNamespace(model_type="chat", capabilities={"chat": True})) is True
    # denylist：embedding / tts 等非 chat 类型
    assert _is_chat_capable_model(SimpleNamespace(model_type="EMBEDDING", capabilities={})) is False
    assert _is_chat_capable_model(SimpleNamespace(model_type="tts", capabilities={})) is False
    # capabilities.chat 显式 False 一票否决
    assert _is_chat_capable_model(SimpleNamespace(model_type="chat", capabilities={"chat": False})) is False
    # capabilities 非 dict 时按空 dict 处理
    assert _is_chat_capable_model(SimpleNamespace(model_type="chat", capabilities=["oops"])) is True


@pytest.mark.parametrize(
    ("model", "locked"),
    [
        (None, False),
        ("", False),
        ("gpt-4o", False),
        ("claude-3-opus", False),
        ("gpt-5-codex", True),
        ("openai/gpt-5-mini", True),  # 带 provider 前缀仍能识别
        ("azure/o3-mini", True),
        ("o4-mini", True),
        ("o1", True),
    ],
)
def test_model_locks_temperature_prefix_family(model, locked):
    assert _model_locks_temperature(model) is locked


# ------------------------------------------------------------------
# max_tokens / 成本预算
# ------------------------------------------------------------------
def test_effective_max_tokens_picks_smallest_positive():
    assert _effective_max_tokens(None, None) is None
    assert _effective_max_tokens(0, -5) is None  # 非正数视为未设置
    assert _effective_max_tokens(100, 50) == 50
    assert _effective_max_tokens(None, 80) == 80
    assert _effective_max_tokens(80, None) == 80


def test_stringify_messages_handles_non_string_content():
    text = _stringify_messages_for_budget(
        [
            {"role": "user", "content": "第一段"},
            {"role": "user", "content": [{"type": "image_url"}]},
        ]
    )
    assert text == "第一段\n[{'type': 'image_url'}]"


def test_budgeted_max_tokens_without_budget_uses_configured_cap():
    assert (
        _budgeted_max_tokens(
            configured_max_tokens=600,
            requested_max_tokens=None,
            max_cost_usd=None,
            messages=[{"content": "hi"}],
            input_cost_per_1m=None,
            output_cost_per_1m=None,
            cached_input_cost_per_1m=None,
        )
        == 600
    )


def test_budgeted_max_tokens_rejects_prompt_exceeding_token_budget():
    with pytest.raises(ValueError, match="maxTokens"):
        _budgeted_max_tokens(
            configured_max_tokens=None,
            requested_max_tokens=1,
            max_cost_usd=None,
            messages=[{"content": "hello world " * 200}],
            input_cost_per_1m=None,
            output_cost_per_1m=None,
            cached_input_cost_per_1m=None,
        )


def test_budgeted_max_tokens_rejects_non_positive_cost_budget():
    with pytest.raises(ValueError, match="maxCostUsd"):
        _budgeted_max_tokens(
            configured_max_tokens=None,
            requested_max_tokens=None,
            max_cost_usd=0,
            messages=[{"content": "hi"}],
            input_cost_per_1m=1.0,
            output_cost_per_1m=1.0,
            cached_input_cost_per_1m=None,
        )


def test_budgeted_max_tokens_rejects_prompt_cost_exceeding_budget():
    # $1/token 的天价输入：任何 prompt 都直接超预算
    with pytest.raises(ValueError, match="maxCostUsd"):
        _budgeted_max_tokens(
            configured_max_tokens=None,
            requested_max_tokens=None,
            max_cost_usd=0.001,
            messages=[{"content": "hello world"}],
            input_cost_per_1m=1_000_000.0,
            output_cost_per_1m=1.0,
            cached_input_cost_per_1m=None,
        )


def test_budgeted_max_tokens_returns_cap_when_output_price_unknown():
    assert (
        _budgeted_max_tokens(
            configured_max_tokens=200,
            requested_max_tokens=None,
            max_cost_usd=0.5,
            messages=[{"content": "hi"}],
            input_cost_per_1m=None,
            output_cost_per_1m=None,
            cached_input_cost_per_1m=None,
        )
        == 200
    )


def test_budgeted_max_tokens_derives_affordable_output_tokens():
    messages = [{"content": "hello"}]
    prompt_tokens = estimate_tokens("hello")
    max_cost = 1.0
    input_cost = 1.0  # 每 1M token $1
    output_cost = 2.0
    remaining = max_cost - (prompt_tokens / 1_000_000) * input_cost
    expected = max(1, math.floor((remaining / output_cost) * 1_000_000))

    result = _budgeted_max_tokens(
        configured_max_tokens=None,
        requested_max_tokens=None,
        max_cost_usd=max_cost,
        messages=messages,
        input_cost_per_1m=input_cost,
        output_cost_per_1m=output_cost,
        cached_input_cost_per_1m=None,
    )
    assert result == expected


def test_estimate_chat_usage_prefers_cached_input_price():
    messages = [{"content": "问题内容"}]
    content = "回答内容较长一些"
    prompt_tokens, completion_tokens, cost = _estimate_chat_usage(
        messages=messages,
        content=content,
        input_cost_per_1m=1.0,
        output_cost_per_1m=2.0,
        cached_input_cost_per_1m=0.5,
    )

    assert prompt_tokens == estimate_tokens("问题内容")
    assert completion_tokens == estimate_tokens(content)
    expected_cost = (prompt_tokens / 1_000_000) * 0.5 + (completion_tokens / 1_000_000) * 2.0
    assert cost == pytest.approx(expected_cost)


def test_estimate_chat_usage_empty_content_and_missing_prices():
    prompt_tokens, completion_tokens, cost = _estimate_chat_usage(
        messages=[{"content": "hi"}],
        content="",
        input_cost_per_1m=None,
        output_cost_per_1m=None,
        cached_input_cost_per_1m=None,
    )
    assert prompt_tokens > 0
    assert completion_tokens == 0
    assert cost == 0


# ------------------------------------------------------------------
# _prefix_model_for_litellm
# ------------------------------------------------------------------
@pytest.mark.parametrize(
    ("model_id", "api_type", "expected"),
    [
        ("gpt-4o", None, "gpt-4o"),
        ("gpt-4o", "openai_compat", "openai/gpt-4o"),
        ("openai/gpt-4o", "openai_compat", "openai/gpt-4o"),  # 不重复加前缀
        ("my-model", "custom", "openai/my-model"),
        ("gpt-4o", "azure", "azure/gpt-4o"),
        ("azure/gpt-4o", "azure", "azure/gpt-4o"),
        ("claude-3-opus", "anthropic", "claude-3-opus"),
        ("gemini-2.0-flash", "google", "gemini-2.0-flash"),
    ],
)
def test_prefix_model_for_litellm(model_id, api_type, expected):
    assert LlmRouter._prefix_model_for_litellm(model_id, api_type) == expected


# ------------------------------------------------------------------
# _load_task_type_prompt：ai_task_types 兜底查询
# ------------------------------------------------------------------
@pytest.mark.asyncio
async def test_load_task_type_prompt_requires_alias_and_router_pool():
    router = LlmRouter()
    assert await router._load_task_type_prompt(None) is None  # 无别名
    assert await router._load_task_type_prompt("summary") is None  # 无 model_router

    router.model_router = SimpleNamespace(pool=None)
    assert await router._load_task_type_prompt("summary") is None  # router 无 pool


@pytest.mark.asyncio
async def test_load_task_type_prompt_reads_template_from_task_types():
    def fetchrow(query, args):
        assert "FROM ai_task_types" in query
        assert args == ("summary",)
        return {"prompt_template": "请生成 200 字以内的摘要:\n{content}"}

    router = LlmRouter()
    router.model_router = SimpleNamespace(pool=FakePool(FakeConn(fetchrow=fetchrow)))
    assert await router._load_task_type_prompt("summary") == "请生成 200 字以内的摘要:\n{content}"


@pytest.mark.asyncio
async def test_load_task_type_prompt_handles_missing_blank_and_db_error():
    router = LlmRouter()

    router.model_router = SimpleNamespace(pool=FakePool(FakeConn(fetchrow=lambda _q, _a: None)))
    assert await router._load_task_type_prompt("summary") is None  # 行不存在

    router.model_router = SimpleNamespace(
        pool=FakePool(FakeConn(fetchrow=lambda _q, _a: {"prompt_template": "   "}))
    )
    assert await router._load_task_type_prompt("summary") is None  # 空白模板

    def boom(_q, _a):
        raise RuntimeError("db down")

    router.model_router = SimpleNamespace(pool=FakePool(FakeConn(fetchrow=boom)))
    assert await router._load_task_type_prompt("summary") is None  # 查询异常吞掉


# ------------------------------------------------------------------
# 路由解析回退路径（无 model_router → 环境变量兜底）
# ------------------------------------------------------------------
@pytest.mark.asyncio
async def test_resolve_usage_context_env_fallback_has_no_pricing():
    router = LlmRouter()
    context = await router.resolve_usage_context("summary")

    assert context["model"] == router.resolve_model("summary")
    _provider, model_id = _normalize_model_parts(context["model"])
    assert context["model_id"] == (model_id or context["model"])
    assert context["input_cost_per_1m"] is None
    assert context["output_cost_per_1m"] is None
    assert context["cached_input_cost_per_1m"] is None


@pytest.mark.asyncio
async def test_resolve_effective_model_env_fallback_matches_alias_mapping():
    router = LlmRouter()
    assert await router.resolve_effective_model("summary") == router.resolve_model("summary")
    # 未知别名原样透传
    assert router.resolve_model("no-such-alias") == "no-such-alias"


@pytest.mark.asyncio
async def test_model_override_without_router_is_rejected():
    router = LlmRouter()
    with pytest.raises(ValueError, match="override"):
        await router.resolve_effective_model("summary", model_id="gpt-4o", allow_override=True)


@pytest.mark.asyncio
async def test_has_task_routing_false_when_routing_lookup_fails():
    router = LlmRouter()
    assert await router.has_task_routing("summary") is False  # 无 model_router

    class _FailingModelRouter:
        async def resolve_routing(self, _task, _user_id):
            raise RuntimeError("db unavailable")

    router.model_router = _FailingModelRouter()
    assert await router.has_task_routing("summary") is False  # 查询异常降级为 False
