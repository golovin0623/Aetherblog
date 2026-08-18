"""usage_logger 纯函数与成功写入路径的单元测试。

覆盖 estimate_tokens 的 tiktoken 缺失 / 异常回退、endpoint → task 解析、
model 归一化、成本估算缺省、错误分类词表、以及 record() 的字段归一与截断。
"""
from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest

import app.services.usage_logger as usage_logger_module
from app.services.usage_logger import UsageLogger, estimate_tokens
from tests.support import FakeConn, FakePool


# ------------------------------------------------------------------
# estimate_tokens
# ------------------------------------------------------------------
def test_estimate_tokens_empty_text_is_zero():
    assert estimate_tokens("") == 0


def test_estimate_tokens_falls_back_to_char_quarter_without_tiktoken(monkeypatch):
    monkeypatch.setattr(usage_logger_module, "tiktoken", None)
    assert estimate_tokens("abcdefgh") == 2  # 8 // 4
    # 不足 4 字符时至少估 1 个 token
    assert estimate_tokens("ab") == 1


def test_estimate_tokens_falls_back_when_encoding_raises(monkeypatch):
    def _boom(_name):
        raise RuntimeError("encoding unavailable")

    monkeypatch.setattr(usage_logger_module, "tiktoken", SimpleNamespace(get_encoding=_boom))
    assert estimate_tokens("abcdefghijkl") == 3  # 12 // 4


# ------------------------------------------------------------------
# _extract_task / _normalize_model
# ------------------------------------------------------------------
@pytest.mark.parametrize(
    ("endpoint", "expected"),
    [
        ("", "unknown"),
        ("/api/v1/ai/summary", "summary"),
        ("/api/v1/ai/summary/stream", "summary"),
        ("/api/v1/ai", "ai"),  # "ai" 之后没有段位 → 落到最后一段
        ("/health", "health"),
        ("///", "unknown"),
    ],
)
def test_extract_task_from_endpoint(endpoint, expected):
    assert UsageLogger._extract_task(endpoint) == expected


@pytest.mark.parametrize(
    ("model", "expected"),
    [
        (None, ("", "")),
        ("", ("", "")),
        ("gpt-4o-mini", ("", "gpt-4o-mini")),
        ("openai/gpt-4o-mini", ("openai", "gpt-4o-mini")),
        ("openrouter/anthropic/claude-3", ("openrouter", "anthropic/claude-3")),
    ],
)
def test_normalize_model_splits_provider_prefix(model, expected):
    assert UsageLogger._normalize_model(model) == expected


# ------------------------------------------------------------------
# _estimate_cost / _classify_error
# ------------------------------------------------------------------
def test_estimate_cost_missing_prices_default_to_zero():
    cost = UsageLogger._estimate_cost(
        tokens_in=1000,
        tokens_out=1000,
        input_cost_per_1m=None,
        output_cost_per_1m=None,
        cached_input_cost_per_1m=None,
        cached=True,
    )
    assert cost == Decimal("0.00000000")


class _ReadTimeoutError(Exception):
    pass


class _ConnectionTerminated(Exception):
    pass


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (RuntimeError("request timeout after 30s"), "timeout"),
        (_ReadTimeoutError("upstream stalled"), "timeout"),  # 类型名包含 timeout
        (RuntimeError("connection refused"), "network"),
        (RuntimeError("broken pipe while writing"), "network"),
        (_ConnectionTerminated("stream ended"), "network"),  # 类型名包含 connection
        (RuntimeError("duplicate key value"), "db_write"),
        (RuntimeError("null value in column user_id"), "db_write"),
        (RuntimeError("permission denied for table ai_usage_logs"), "db_write"),
        (ValueError("bad input"), "unknown"),
    ],
)
def test_classify_error_keyword_families(exc, expected):
    assert UsageLogger._classify_error(exc) == expected


# ------------------------------------------------------------------
# record() 成功路径：字段归一 + 长度截断 + 成本估算
# ------------------------------------------------------------------
@pytest.mark.asyncio
async def test_record_normalizes_fields_and_truncates_long_codes():
    conn = FakeConn()
    logger = UsageLogger(FakePool(conn))

    await logger.record(
        user_id="u-1",
        endpoint="/api/v1/ai/summary",
        model="openai/gpt-4o-mini",
        request_chars=400,
        response_chars=800,
        tokens_in=100,
        tokens_out=200,
        latency_ms=321,
        success=False,
        cached=False,
        error_code="E" * 200,
        request_id="R" * 300,
        input_cost_per_1m=1.0,
        output_cost_per_1m=2.0,
        cached_input_cost_per_1m=0.5,
    )

    assert len(conn.execute_calls) == 1
    _query, args = conn.execute_calls[0]
    (
        user_id, endpoint, task_type, provider_code, model_id, model,
        _req_chars, _resp_chars, tokens_in, tokens_out, total_tokens,
        _latency, cost, success, cached, error_code, request_id,
    ) = args
    assert user_id == "u-1"
    assert endpoint == "/api/v1/ai/summary"
    assert task_type == "summary"  # 从 endpoint 推断
    assert provider_code == "openai"  # 从 model 前缀归一
    assert model_id == "gpt-4o-mini"
    assert model == "openai/gpt-4o-mini"
    assert (tokens_in, tokens_out, total_tokens) == (100, 200, 300)
    # 未 cached：1.0 * 100/1M + 2.0 * 200/1M = 0.0005
    assert cost == Decimal("0.00050000")
    assert success is False and cached is False
    assert len(error_code) == 120  # varchar(128) 防溢出截断
    assert len(request_id) == 120


@pytest.mark.asyncio
async def test_record_cached_request_uses_cached_input_price():
    conn = FakeConn()
    logger = UsageLogger(FakePool(conn))

    await logger.record(
        user_id="u-1",
        endpoint="/api/v1/ai/qa",
        model="deepseek-chat",  # 无 provider 前缀 → provider 空
        request_chars=1,
        response_chars=1,
        tokens_in=100,
        tokens_out=200,
        latency_ms=10,
        success=True,
        cached=True,
        error_code=None,
        request_id=None,
        input_cost_per_1m=1.0,
        output_cost_per_1m=2.0,
        cached_input_cost_per_1m=0.5,
    )

    _query, args = conn.execute_calls[0]
    provider_code, model_id = args[3], args[4]
    cost = args[12]
    assert provider_code == ""
    assert model_id == "deepseek-chat"
    # cached：0.5 * 100/1M + 2.0 * 200/1M = 0.00045
    assert cost == Decimal("0.00045000")
