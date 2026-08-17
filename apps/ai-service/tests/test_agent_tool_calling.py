"""灵境 Agent 工具调用（function calling）协议与执行循环。

覆盖：
  1. delta 分片拼装 tool_calls（多分片 arguments 连接、dict/对象双形态）；
  2. SSE 事件序列：tool_call → tool_result → 后续 delta → usage → done；
  3. 工具循环上限 4 轮强制收敛（撤 tools + 注入 system 提示）；
  4. 工具异常 → isError:true 且对话继续不崩；
  5. enableTools=false / 模型无 functionCall → wire 请求不含 tools 键；
  6. search_posts SQL（假连接）与 search_knowledge_base（recall_kbs mock）；
  7. usage 聚合覆盖全部轮次（累加 / 缺失侧回退估算）；
  8. mock_mode 下固定 tool_call → tool_result → delta 联调序列。
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import pytest

from app.api.routes import agent as agent_module
from app.api.routes.agent import AgentChatMessage, AgentChatRequest
from app.services import agent_tools as agent_tools_module
from app.services.agent_tools import (
    SearchPostsArgs,
    build_agent_tools,
    run_agent_tool,
)
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


def _tool_call_fragment(
    *,
    index: int = 0,
    call_id: str | None = None,
    name: str | None = None,
    arguments: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        index=index,
        id=call_id,
        function=SimpleNamespace(name=name, arguments=arguments),
    )


def _tool_delta(*fragments: Any) -> SimpleNamespace:
    return SimpleNamespace(content=None, tool_calls=list(fragments))


def _usage_chunk(prompt: int, completion: int, total: int | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[],
        usage=SimpleNamespace(
            prompt_tokens=prompt,
            completion_tokens=completion,
            total_tokens=total if total is not None else prompt + completion,
        ),
    )


def _function_call_capabilities_row(_query: str, _args: tuple[Any, ...]) -> dict[str, Any]:
    return {"capabilities": json.dumps({"abilities": {"functionCall": True}})}


def _tool_chat_request(**overrides: Any) -> AgentChatRequest:
    values: dict[str, Any] = {
        "sessionId": "s-tools",
        "messages": [AgentChatMessage(role="user", content="帮我找 aether 相关文章")],
        "enableTools": True,
    }
    values.update(overrides)
    return AgentChatRequest(**values)


# ============================================================================
# 1. delta 分片拼装
# ============================================================================

def test_tool_call_assembler_joins_multi_fragment_arguments() -> None:
    assembler = agent_module._ToolCallAssembler()
    assembler.feed([
        _tool_call_fragment(index=0, call_id="call_1", name="search_posts", arguments='{"que'),
    ])
    assembler.feed([
        _tool_call_fragment(index=0, arguments='ry": "aether"'),
        _tool_call_fragment(index=1, call_id="call_2", name="search_", arguments='{"query"'),
    ])
    assembler.feed([
        _tool_call_fragment(index=0, arguments="}"),
        _tool_call_fragment(index=1, name="knowledge_base", arguments=': "rag"}'),
    ])

    assert assembler.result() == [
        {"id": "call_1", "name": "search_posts", "arguments": '{"query": "aether"}', "oversized": False},
        {"id": "call_2", "name": "search_knowledge_base", "arguments": '{"query": "rag"}', "oversized": False},
    ]


def test_tool_call_assembler_accepts_dict_fragments_and_defaults() -> None:
    assembler = agent_module._ToolCallAssembler()
    assembler.feed([
        {"index": None, "id": None, "function": {"name": "search_posts", "arguments": None}},
        {"index": 0, "function": {"arguments": '{"query": "x"}'}},
        # 无 name 的残片不成调用，必须被丢弃。
        {"index": 3, "function": {"arguments": '{"orphan": true}'}},
    ])

    assert assembler.result() == [
        {"id": "call_0", "name": "search_posts", "arguments": '{"query": "x"}', "oversized": False},
    ]


def test_tool_call_assembler_caps_oversized_arguments_and_stops_accumulating() -> None:
    """arguments 累加超过 8KB：标记 oversized、截断到硬限、后续分片全部丢弃。"""
    assembler = agent_module._ToolCallAssembler()
    assembler.feed([
        _tool_call_fragment(index=0, call_id="call_big", name="search_posts", arguments="a" * 8000),
    ])
    # 该分片使累计超过 8192 字节 → oversized + 截断。
    assembler.feed([_tool_call_fragment(index=0, arguments="b" * 8000)])
    # oversized 之后的分片必须被丢弃（不再增长内存）。
    assembler.feed([_tool_call_fragment(index=0, arguments="c" * 8000)])
    # 中文多字节：截断点不产生半个字符。
    assembler.feed([
        _tool_call_fragment(index=1, call_id="call_cjk", name="search_posts", arguments="汉" * 3000),
    ])

    calls = assembler.result()
    big = calls[0]
    assert big["oversized"] is True
    assert len(big["arguments"].encode("utf-8")) == agent_module._TOOL_ARGUMENTS_MAX_BYTES
    assert big["arguments"].startswith("a" * 8000)
    assert "c" not in big["arguments"]

    cjk = calls[1]
    assert cjk["oversized"] is True
    assert len(cjk["arguments"].encode("utf-8")) <= agent_module._TOOL_ARGUMENTS_MAX_BYTES
    # UTF-8 截断不产生半个字符（截断后仍是完整的「汉」序列）。
    assert set(cjk["arguments"]) == {"汉"}


@pytest.mark.asyncio
async def test_stream_events_emit_internal_tool_calls_event_after_content() -> None:
    stream = _aiter([
        _stream_part(SimpleNamespace(content="我先查一下")),
        _stream_part(_tool_delta(
            _tool_call_fragment(index=0, call_id="call_1", name="search_posts", arguments='{"query": '),
        )),
        _stream_part(_tool_delta(_tool_call_fragment(index=0, arguments='"aether"}'))),
        _usage_chunk(9, 4),
    ])

    events = [event async for event in agent_module._stream_litellm_agent_events(stream)]

    assert events == [
        {"type": "delta", "content": "我先查一下"},
        {
            "type": "tool_calls",
            "toolCalls": [
                {
                    "id": "call_1",
                    "name": "search_posts",
                    "arguments": '{"query": "aether"}',
                    "oversized": False,
                },
            ],
        },
        {"type": "usage", "promptTokens": 9, "completionTokens": 4, "totalTokens": 13},
    ]


# ============================================================================
# 2. 事件序列 + usage 跨轮累加
# ============================================================================

@pytest.mark.asyncio
async def test_agent_chat_tool_round_emits_call_result_delta_usage_done(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    completion_calls: list[dict[str, Any]] = []

    async def fake_acompletion(**kwargs: Any):
        completion_calls.append(kwargs)
        if len(completion_calls) == 1:
            return _aiter([
                _stream_part(_tool_delta(
                    _tool_call_fragment(
                        index=0, call_id="call_1", name="search_posts", arguments='{"query": "aeth',
                    ),
                )),
                _stream_part(_tool_delta(_tool_call_fragment(index=0, arguments='er", "limit": 2}'))),
                _usage_chunk(11, 3),
            ])
        return _aiter([
            _stream_part(SimpleNamespace(content="根据检索结果，推荐这两篇。")),
            _usage_chunk(20, 7),
        ])

    def fetch(query: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
        assert "p.status = 'PUBLISHED'" in query
        assert "p.deleted = FALSE" in query
        assert "p.is_hidden = FALSE" in query
        assert "ILIKE $1" in query
        assert args == ("%aether%", 2)
        return [
            {"id": 5, "title": "Aether 架构", "summary": "架构演进摘要"},
            {"id": 8, "title": "Aether Codex", "summary": None},
        ]

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    response = await agent_module.agent_chat(
        request=_request(),
        payload=_tool_chat_request(),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=FakePool(FakeConn(fetch=fetch, fetchrow=_function_call_capabilities_row)),
        metrics=FakeMetrics(),
        usage_logger=FakeUsageLogger(),
    )
    events = await _collect_sse_events(response)

    assert [event["type"] for event in events] == [
        "tool_call", "tool_result", "delta", "usage", "done",
    ]
    assert events[0] == {
        "type": "tool_call",
        "id": "call_1",
        "name": "search_posts",
        "arguments": '{"query": "aether", "limit": 2}',
    }
    assert events[1]["id"] == "call_1"
    assert events[1]["name"] == "search_posts"
    assert events[1]["isError"] is False
    assert json.loads(events[1]["result"]) == [
        {"id": 5, "title": "Aether 架构", "summary": "架构演进摘要"},
        {"id": 8, "title": "Aether Codex", "summary": ""},
    ]
    # usage 覆盖全部两轮（累加），两侧皆为 provider 真值。
    assert events[3] == {
        "type": "usage",
        "promptTokens": 31,
        "completionTokens": 10,
        "totalTokens": 41,
        "estimated": False,
    }

    # 第 1 轮 wire 请求带 tools schema；第 2 轮上下文包含 assistant(tool_calls)+tool。
    assert [t["function"]["name"] for t in completion_calls[0]["tools"]] == ["search_posts"]
    round2_messages = completion_calls[1]["messages"]
    assistant_message = round2_messages[-2]
    tool_message = round2_messages[-1]
    assert assistant_message["role"] == "assistant"
    assert assistant_message["content"] is None
    assert assistant_message["tool_calls"] == [
        {
            "id": "call_1",
            "type": "function",
            "function": {"name": "search_posts", "arguments": '{"query": "aether", "limit": 2}'},
        }
    ]
    assert tool_message["role"] == "tool"
    assert tool_message["tool_call_id"] == "call_1"
    assert tool_message["content"] == events[1]["result"]


@pytest.mark.asyncio
async def test_agent_chat_missing_round_usage_falls_back_to_estimated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    calls = 0

    async def fake_acompletion(**_kwargs: Any):
        nonlocal calls
        calls += 1
        if calls == 1:
            # 第一轮没有 usage 收尾 chunk。
            return _aiter([
                _stream_part(_tool_delta(
                    _tool_call_fragment(
                        index=0, call_id="call_1", name="search_posts", arguments='{"query": "a"}',
                    ),
                )),
            ])
        return _aiter([
            _stream_part(SimpleNamespace(content="最终回答")),
            _usage_chunk(20, 7),
        ])

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    usage_logger = FakeUsageLogger()
    response = await agent_module.agent_chat(
        request=_request(),
        payload=_tool_chat_request(),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=FakePool(FakeConn(fetchrow=_function_call_capabilities_row)),
        metrics=FakeMetrics(),
        usage_logger=usage_logger,
    )
    events = await _collect_sse_events(response)

    usage_event = events[-2]
    assert usage_event["type"] == "usage"
    # 任一轮缺真值 → 整侧退化估算，绝不把部分轮次真值冒充全程真值。
    assert usage_event["estimated"] is True
    assert usage_event["promptTokens"] > 0
    assert usage_event["completionTokens"] > 0
    assert usage_logger.calls[0]["success"] is True


def test_agent_usage_aggregator_single_round_matches_passthrough() -> None:
    aggregator = agent_module._AgentUsageAggregator()
    assert aggregator.result() is None

    aggregator.add({"promptTokens": 10, "completionTokens": 5, "totalTokens": 15})
    assert aggregator.result() == {
        "promptTokens": 10,
        "completionTokens": 5,
        "totalTokens": 15,
    }

    aggregator.add({"promptTokens": None, "completionTokens": 4, "totalTokens": None})
    assert aggregator.result() == {
        "promptTokens": None,
        "completionTokens": 9,
        "totalTokens": None,
    }


@pytest.mark.asyncio
async def test_agent_chat_estimated_prompt_usage_accumulates_across_rounds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """P2-H：provider 全程不回真实 usage 时，prompt 估算必须逐轮累加。

    两轮 LLM 调用（工具轮 + 最终作答轮）各自消耗了完整上下文的 prompt
    tokens；SSE usage 事件与落库都必须等于「各轮调用前上下文估算之和」，
    而不是只按最终上下文估一次（低估）。
    """

    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    completion_calls: list[dict[str, Any]] = []

    async def fake_acompletion(**kwargs: Any):
        # loop_messages 在轮间被原地 append，必须按调用时点快照，
        # 否则两次捕获引用同一个最终列表。
        completion_calls.append({**kwargs, "messages": list(kwargs["messages"])})
        if len(completion_calls) == 1:
            # 第一轮：只回工具调用，不回 usage。
            return _aiter([
                _stream_part(_tool_delta(
                    _tool_call_fragment(
                        index=0, call_id="call_1", name="search_posts", arguments='{"query": "a"}',
                    ),
                )),
            ])
        # 第二轮：最终回答，同样不回 usage。
        return _aiter([_stream_part(SimpleNamespace(content="最终回答"))])

    # 确定性估算：每段文本按字符数计 token，方便精确断言累加值。
    monkeypatch.setattr(agent_module, "estimate_tokens", lambda text: len(text or ""))
    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    def fetch(_query: str, _args: tuple[Any, ...]) -> list[dict[str, Any]]:
        return [{"id": 1, "title": "命中", "summary": "s"}]

    usage_logger = FakeUsageLogger()
    response = await agent_module.agent_chat(
        request=_request(),
        payload=_tool_chat_request(),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=FakePool(FakeConn(fetch=fetch, fetchrow=_function_call_capabilities_row)),
        metrics=FakeMetrics(),
        usage_logger=usage_logger,
    )
    events = await _collect_sse_events(response)

    # 期望值 = 每轮调用前发送给 LLM 的完整上下文估算之和。
    round_estimates = [
        len(agent_module._agent_usage_request_text(call["messages"]))
        for call in completion_calls
    ]
    assert len(round_estimates) == 2
    expected_prompt = sum(round_estimates)

    usage_event = events[-2]
    assert usage_event["type"] == "usage"
    assert usage_event["estimated"] is True
    assert usage_event["promptTokens"] == expected_prompt
    # 第二轮上下文包含第一轮全部消息 → 累加值必然严格大于任何单轮估算
    # （旧实现只按最终上下文估一次，恰等于 round_estimates[-1]）。
    assert usage_event["promptTokens"] > max(round_estimates)

    # 落库与 SSE usage 事件同口径。
    assert usage_logger.calls[0]["tokens_in"] == expected_prompt
    assert usage_logger.calls[0]["success"] is True


# ============================================================================
# 3. 循环上限强制收敛
# ============================================================================

@pytest.mark.asyncio
async def test_agent_chat_forces_convergence_after_four_tool_rounds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    completion_calls: list[dict[str, Any]] = []

    async def fake_acompletion(**kwargs: Any):
        completion_calls.append(kwargs)
        if "tools" in kwargs:
            round_no = len(completion_calls)
            return _aiter([
                _stream_part(_tool_delta(
                    _tool_call_fragment(
                        index=0,
                        call_id=f"call_{round_no}",
                        name="search_posts",
                        arguments='{"query": "再查一次"}',
                    ),
                )),
            ])
        return _aiter([_stream_part(SimpleNamespace(content="不再调用工具，直接作答。"))])

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    response = await agent_module.agent_chat(
        request=_request(),
        payload=_tool_chat_request(),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=FakePool(FakeConn(fetchrow=_function_call_capabilities_row)),
        metrics=FakeMetrics(),
        usage_logger=FakeUsageLogger(),
    )
    events = await _collect_sse_events(response)

    # 4 轮工具 + 1 轮最终作答 = 5 次 LLM 调用；前 4 次带 tools，第 5 次不带。
    assert len(completion_calls) == 5
    assert all("tools" in call for call in completion_calls[:4])
    assert "tools" not in completion_calls[4]
    # 超限后注入 system 提示强制直接作答。
    final_messages = completion_calls[4]["messages"]
    assert final_messages[-1] == {
        "role": "system",
        "content": agent_module._TOOL_ROUND_LIMIT_PROMPT,
    }
    assert [event["type"] for event in events] == (
        ["tool_call", "tool_result"] * 4 + ["delta", "usage", "done"]
    )
    assert events[-2]["estimated"] is True


# ============================================================================
# 4. 工具异常不崩对话
# ============================================================================

@pytest.mark.asyncio
async def test_agent_chat_tool_failure_yields_is_error_and_conversation_continues(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    calls = 0

    async def fake_acompletion(**_kwargs: Any):
        nonlocal calls
        calls += 1
        if calls == 1:
            return _aiter([
                _stream_part(_tool_delta(
                    _tool_call_fragment(
                        index=0, call_id="call_1", name="search_posts", arguments='{"query": "x"}',
                    ),
                )),
            ])
        return _aiter([
            _stream_part(SimpleNamespace(content="工具失败也继续回答。")),
            _usage_chunk(6, 2),
        ])

    def failing_fetch(_query: str, _args: tuple[Any, ...]) -> list[dict[str, Any]]:
        raise RuntimeError("postgres://admin:super-secret@internal-db/private")

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    usage_logger = FakeUsageLogger()
    response = await agent_module.agent_chat(
        request=_request(),
        payload=_tool_chat_request(),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=FakePool(FakeConn(fetch=failing_fetch, fetchrow=_function_call_capabilities_row)),
        metrics=FakeMetrics(),
        usage_logger=usage_logger,
    )
    events = await _collect_sse_events(response)

    assert [event["type"] for event in events] == [
        "tool_call", "tool_result", "delta", "usage", "done",
    ]
    assert events[1]["isError"] is True
    assert events[1]["result"] == "工具执行失败"
    # 内部错误细节（DSN）不允许泄漏到 SSE。
    assert "super-secret" not in json.dumps(events, ensure_ascii=False)
    assert usage_logger.calls[0]["success"] is True


@pytest.mark.asyncio
async def test_agent_chat_unknown_tool_name_gets_error_result_without_execution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    calls = 0

    async def fake_acompletion(**_kwargs: Any):
        nonlocal calls
        calls += 1
        if calls == 1:
            return _aiter([
                _stream_part(_tool_delta(
                    _tool_call_fragment(
                        index=0, call_id="call_1", name="delete_everything", arguments="{}",
                    ),
                )),
            ])
        return _aiter([_stream_part(SimpleNamespace(content="收到"))])

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    response = await agent_module.agent_chat(
        request=_request(),
        payload=_tool_chat_request(),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=FakePool(FakeConn(fetchrow=_function_call_capabilities_row)),
        metrics=FakeMetrics(),
        usage_logger=FakeUsageLogger(),
    )
    events = await _collect_sse_events(response)

    assert events[1]["type"] == "tool_result"
    assert events[1]["isError"] is True
    assert events[1]["result"] == "未知工具：仅支持服务端白名单工具"
    assert events[-1] == {"type": "done"}


@pytest.mark.asyncio
async def test_agent_chat_oversized_tool_arguments_rejected_without_execution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """P2-F：arguments 累加超 8KB —— 截断下发、不执行、回填也用截断版。"""

    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    completion_calls: list[dict[str, Any]] = []

    async def fake_acompletion(**kwargs: Any):
        completion_calls.append({**kwargs, "messages": list(kwargs["messages"])})
        if len(completion_calls) == 1:
            # 20KB arguments 分片流：远超 8192 字节硬限。
            return _aiter([
                _stream_part(_tool_delta(
                    _tool_call_fragment(
                        index=0, call_id="call_big", name="search_posts",
                        arguments='{"query": "' + "x" * 6000,
                    ),
                )),
                _stream_part(_tool_delta(_tool_call_fragment(index=0, arguments="y" * 8000))),
                _stream_part(_tool_delta(_tool_call_fragment(index=0, arguments="z" * 6000 + '"}'))),
            ])
        return _aiter([_stream_part(SimpleNamespace(content="收到"))])

    executed: list[str] = []

    def fetch(_query: str, _args: tuple[Any, ...]) -> list[dict[str, Any]]:
        executed.append("fetch")
        return []

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    response = await agent_module.agent_chat(
        request=_request(),
        payload=_tool_chat_request(),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=FakePool(FakeConn(fetch=fetch, fetchrow=_function_call_capabilities_row)),
        metrics=FakeMetrics(),
        usage_logger=FakeUsageLogger(),
    )
    events = await _collect_sse_events(response)

    assert [event["type"] for event in events] == [
        "tool_call", "tool_result", "delta", "usage", "done",
    ]
    call_event, result_event = events[0], events[1]
    suffix = agent_module._TOOL_ARGUMENTS_TRUNCATED_SUFFIX
    # SSE tool_call：截断到 8KB + 提示后缀，绝不透传完整 20KB。
    assert call_event["arguments"].endswith(suffix)
    truncated = call_event["arguments"][: -len(suffix)]
    assert len(truncated.encode("utf-8")) == agent_module._TOOL_ARGUMENTS_MAX_BYTES
    # 不执行工具，直接 isError 回执。
    assert executed == []
    assert result_event == {
        "type": "tool_result",
        "id": "call_big",
        "name": "search_posts",
        "result": agent_module._TOOL_ARGUMENTS_OVERSIZED_RESULT,
        "isError": True,
    }
    # 第二轮上下文回填同样用截断版（含后缀），tool 消息为拒绝文案。
    round2_messages = completion_calls[1]["messages"]
    assistant_message, tool_message = round2_messages[-2], round2_messages[-1]
    assert assistant_message["tool_calls"][0]["function"]["arguments"] == call_event["arguments"]
    assert tool_message == {
        "role": "tool",
        "tool_call_id": "call_big",
        "content": agent_module._TOOL_ARGUMENTS_OVERSIZED_RESULT,
    }


@pytest.mark.asyncio
async def test_agent_chat_merges_overflow_tool_calls_into_single_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """P2-F：单轮第 9 个起的调用不逐个下发 / 回填，合并为一条 isError 回执。"""

    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    completion_calls: list[dict[str, Any]] = []
    total_calls = 11  # 8 个执行 + 3 个超限

    async def fake_acompletion(**kwargs: Any):
        completion_calls.append({**kwargs, "messages": list(kwargs["messages"])})
        if len(completion_calls) == 1:
            return _aiter([
                _stream_part(_tool_delta(*[
                    _tool_call_fragment(
                        index=i, call_id=f"call_{i}", name="search_posts",
                        arguments=json.dumps({"query": f"q{i}"}),
                    )
                    for i in range(total_calls)
                ])),
            ])
        return _aiter([_stream_part(SimpleNamespace(content="收敛作答"))])

    def fetch(_query: str, _args: tuple[Any, ...]) -> list[dict[str, Any]]:
        return []

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    response = await agent_module.agent_chat(
        request=_request(),
        payload=_tool_chat_request(),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=FakePool(FakeConn(fetch=fetch, fetchrow=_function_call_capabilities_row)),
        metrics=FakeMetrics(),
        usage_logger=FakeUsageLogger(),
    )
    events = await _collect_sse_events(response)

    # 8 对 tool_call/tool_result + 1 条合并回执 + delta/usage/done。
    assert [event["type"] for event in events] == (
        ["tool_call", "tool_result"] * 8 + ["tool_result", "delta", "usage", "done"]
    )
    executed_ids = [event["id"] for event in events if event["type"] == "tool_call"]
    assert executed_ids == [f"call_{i}" for i in range(8)]
    merged = events[16]
    assert merged == {
        "type": "tool_result",
        "id": "call_8",
        "name": "search_posts",
        "result": "本轮工具调用超过上限，已忽略 3 个",
        "isError": True,
    }

    # 上下文回填：assistant 只带 9 个 tool_calls（8 执行 + 1 回执挂载点），
    # tool 消息共 9 条（8 结果 + 1 合并回执）；第 10、11 个调用彻底不出现。
    round2_messages = completion_calls[1]["messages"]
    assistant_message = next(
        m for m in round2_messages if m.get("role") == "assistant" and m.get("tool_calls")
    )
    backfilled_ids = [c["id"] for c in assistant_message["tool_calls"]]
    assert backfilled_ids == [f"call_{i}" for i in range(9)]
    tool_messages = [m for m in round2_messages if m.get("role") == "tool"]
    assert [m["tool_call_id"] for m in tool_messages] == [f"call_{i}" for i in range(9)]
    assert tool_messages[-1]["content"] == "本轮工具调用超过上限，已忽略 3 个"
    assert "call_9" not in json.dumps(round2_messages, ensure_ascii=False)


# ============================================================================
# 5. enableTools=false / 无 functionCall → wire 不含 tools
# ============================================================================

@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("payload_overrides", "fetchrow"),
    [
        # enableTools 缺省（False）：连能力查询都不该发生。
        ({"enableTools": False}, None),
        # 显式开启但模型 abilities.functionCall 非 true：静默降级。
        (
            {},
            lambda _q, _a: {"capabilities": json.dumps({"abilities": {"functionCall": False}})},
        ),
        # capabilities 行缺失：同样静默降级。
        ({}, lambda _q, _a: None),
    ],
)
async def test_agent_chat_without_function_call_ability_never_sends_tools(
    monkeypatch: pytest.MonkeyPatch,
    payload_overrides: dict[str, Any],
    fetchrow: Any,
) -> None:
    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    completion_calls: list[dict[str, Any]] = []

    async def fake_acompletion(**kwargs: Any):
        completion_calls.append(kwargs)
        return _aiter([_stream_part(SimpleNamespace(content="普通回答"))])

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    conn = FakeConn(fetchrow=fetchrow)
    response = await agent_module.agent_chat(
        request=_request(),
        payload=_tool_chat_request(**payload_overrides),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=FakePool(conn),
        metrics=FakeMetrics(),
        usage_logger=FakeUsageLogger(),
    )
    events = await _collect_sse_events(response)

    assert [event["type"] for event in events] == ["delta", "usage", "done"]
    assert len(completion_calls) == 1
    assert "tools" not in completion_calls[0]
    if payload_overrides.get("enableTools") is False:
        assert conn.fetchrow_calls == []


@pytest.mark.asyncio
async def test_agent_chat_ignores_tool_calls_when_tools_not_offered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """provider 未被授权 tools 却回吐 tool_calls（幻觉）时：不执行、不下发。"""

    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route()

    async def fake_acompletion(**_kwargs: Any):
        return _aiter([
            _stream_part(SimpleNamespace(content="正文")),
            _stream_part(_tool_delta(
                _tool_call_fragment(
                    index=0, call_id="call_x", name="search_posts", arguments="{}",
                ),
            )),
        ])

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", fake_acompletion)

    response = await agent_module.agent_chat(
        request=_request(),
        payload=_tool_chat_request(enableTools=False),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=FakePool(FakeConn()),
        metrics=FakeMetrics(),
        usage_logger=FakeUsageLogger(),
    )
    events = await _collect_sse_events(response)

    assert [event["type"] for event in events] == ["delta", "usage", "done"]


# ============================================================================
# 6. 工具实现：search_posts / search_knowledge_base / run_agent_tool
# ============================================================================

def test_build_agent_tools_registers_kb_tool_only_with_authorized_kb_ids() -> None:
    with_kb = build_agent_tools(object(), object(), kb_ids=[3, 3, -1, 0, 9])
    without_kb = build_agent_tools(object(), object(), kb_ids=[])

    assert [tool.name for tool in with_kb] == ["search_knowledge_base", "search_posts"]
    assert [tool.name for tool in without_kb] == ["search_posts"]
    schema = with_kb[0].openai_schema()
    assert schema["type"] == "function"
    assert schema["function"]["name"] == "search_knowledge_base"
    assert schema["function"]["parameters"]["required"] == ["query"]


@pytest.mark.asyncio
async def test_search_posts_tool_escapes_like_wildcards_and_truncates_summary() -> None:
    captured: dict[str, Any] = {}

    def fetch(query: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
        captured["query"] = query
        captured["args"] = args
        return [{"id": 1, "title": "命中", "summary": "s" * 500}]

    tool = build_agent_tools(FakePool(FakeConn(fetch=fetch)), object(), kb_ids=None)[0]
    assert tool.name == "search_posts"

    result, is_error = await run_agent_tool(tool, '{"query": "aether_%blog", "limit": 3}')

    assert is_error is False
    assert captured["args"] == ("%aether\\_\\%blog%", 3)
    assert "p.password IS NULL" in captured["query"]
    payload = json.loads(result)
    assert payload[0]["id"] == 1
    assert len(payload[0]["summary"]) <= 200


@pytest.mark.asyncio
async def test_search_knowledge_base_tool_recalls_only_authorized_kbs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import kb_recall as kb_recall_module

    captured: dict[str, Any] = {}

    async def fake_recall_kbs(_pool: Any, _llm: Any, **kwargs: Any):
        captured.update(kwargs)
        return [
            kb_recall_module.KBHit(
                kb_id=9,
                kb_slug="research",
                kb_name="研究资料",
                kb_file_id=12,
                file_title="路线图",
                chunk_index=2,
                snippet="片段" * 400,
                similarity=0.87654,
            )
        ]

    monkeypatch.setattr(kb_recall_module, "recall_kbs", fake_recall_kbs)

    tool = build_agent_tools(object(), object(), kb_ids=[9, 4])[0]
    result, is_error = await run_agent_tool(tool, '{"query": "召回范围"}')

    assert is_error is False
    assert captured["kb_ids"] == [9, 4]
    assert captured["query"] == "召回范围"
    payload = json.loads(result)
    assert payload["hits"][0]["title"] == "路线图"
    assert payload["hits"][0]["score"] == 0.877
    assert len(payload["hits"][0]["snippet"]) <= 300


@pytest.mark.asyncio
async def test_run_agent_tool_rejects_invalid_arguments() -> None:
    tool = build_agent_tools(object(), object(), kb_ids=None)[0]

    assert await run_agent_tool(tool, "not-json") == ("工具参数不是合法 JSON", True)
    assert await run_agent_tool(tool, "[1,2]") == ("工具参数必须是 JSON 对象", True)

    result, is_error = await run_agent_tool(tool, json.dumps({"query": "q" * 501}))
    assert is_error is True
    assert result.startswith("工具参数校验失败")

    result, is_error = await run_agent_tool(tool, json.dumps({"query": "ok", "limit": 99}))
    assert is_error is True
    assert "limit" in result


@pytest.mark.asyncio
async def test_run_agent_tool_times_out_and_truncates_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def slow_handler(_args: SearchPostsArgs) -> str:
        await asyncio.sleep(0.2)
        return "never"

    async def big_handler(_args: SearchPostsArgs) -> str:
        return "x" * 5000

    slow_tool = agent_tools_module.AgentToolSpec(
        name="slow",
        description="",
        parameters={"type": "object", "properties": {}},
        args_model=SearchPostsArgs,
        handler=slow_handler,
    )
    big_tool = agent_tools_module.AgentToolSpec(
        name="big",
        description="",
        parameters={"type": "object", "properties": {}},
        args_model=SearchPostsArgs,
        handler=big_handler,
    )

    monkeypatch.setattr(agent_tools_module, "TOOL_TIMEOUT_SECONDS", 0.01)
    assert await run_agent_tool(slow_tool, '{"query": "q"}') == ("工具执行超时", True)

    result, is_error = await run_agent_tool(big_tool, '{"query": "q"}')
    assert is_error is False
    assert len(result) == agent_tools_module.TOOL_RESULT_MAX_CHARS
    assert result.endswith("…")


# ============================================================================
# 7. mock_mode 联调序列
# ============================================================================

@pytest.mark.asyncio
async def test_agent_chat_mock_mode_emits_fixed_tool_sequence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_resolve_for_agent(_llm_router: Any, **_kwargs: Any):
        return _resolved_route(override=False)

    async def forbidden_acompletion(**_kwargs: Any):
        raise AssertionError("mock mode must not call the provider")

    monkeypatch.setattr(agent_module, "_resolve_for_agent", fake_resolve_for_agent)
    monkeypatch.setattr(agent_module, "acompletion", forbidden_acompletion)
    monkeypatch.setattr(agent_module.settings, "mock_mode", True)

    usage_logger = FakeUsageLogger()
    response = await agent_module.agent_chat(
        request=_request(),
        payload=_tool_chat_request(),
        user=SimpleNamespace(user_id="system", role="admin"),
        forwarded_user_id="7",
        llm_router=FakeAgentRouter(),
        pool=object(),
        metrics=FakeMetrics(),
        usage_logger=usage_logger,
    )
    events = await _collect_sse_events(response)

    assert events[0]["type"] == "tool_call"
    assert events[0]["name"] == "search_posts"
    assert json.loads(events[0]["arguments"]) == {"query": "mock", "limit": 5}
    assert events[1]["type"] == "tool_result"
    assert events[1]["id"] == events[0]["id"]
    assert events[1]["isError"] is False
    assert json.loads(events[1]["result"])[0]["title"] == "Mock 文章"
    assert all(event["type"] == "delta" for event in events[2:-2])
    assert events[-2]["type"] == "usage"
    assert events[-1] == {"type": "done"}
    assert usage_logger.calls[0]["success"] is True
