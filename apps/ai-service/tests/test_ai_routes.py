"""Unit tests for /api/v1/ai/* business endpoints and stream helpers.

These tests focus on the shape-contracts exposed to the front-end:

- Non-stream endpoints must return the documented ``*Data`` payload shape
  (``SummaryData`` / ``TagsData`` / ``TitlesData`` / ``PolishData`` /
  ``OutlineData`` / ``TranslateData``).
- Stream endpoints must emit a terminal ``{type:"result", data:<*Data>}``
  SSE event in addition to the raw delta tokens — see the 2026-04 "AI 工具箱
  输出承接" fix (apps/ai-service/app/api/routes/ai.py).
- Robust parsers (``_parse_tags`` / ``_parse_titles``) must handle JSON
  arrays, comma / newline separation, numbered lists, Unicode quotes.
- ``LlmRouter._safe_format`` must not break on user content containing
  literal ``{`` / ``}`` (Phase 4.1 fix).
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, AsyncIterator

import pytest

from app.api.routes import ai as ai_module
from app.api.routes.ai import (
    _build_stream_result_payload,
    _parse_tags,
    _parse_titles,
    _split_list,
    _stream_with_think_detection,
)
from app.schemas.ai import (
    OutlineRequest,
    PolishRequest,
    SummaryRequest,
    TagsRequest,
    TitlesRequest,
    TranslateRequest,
)
from app.services.llm_router import LlmRouter
from app.services.metrics import MetricsStore


# ─────────────────────────── Fakes ───────────────────────────


class FakeCache:
    """A no-op cache compatible with CacheStore's ``get_json`` / ``set_json``."""

    def __init__(self) -> None:
        self.store: dict[str, Any] = {}

    async def get_json(self, key: str) -> Any:
        return self.store.get(key)

    async def set_json(self, key: str, value: Any, ttl: int) -> None:
        self.store[key] = value


class FakeUsageLogger:
    """Swallow ``record`` calls without touching the DB."""

    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    async def record(self, **kwargs: Any) -> None:
        self.records.append(kwargs)


class FakeLlm:
    """Minimal LlmRouter stand-in that returns pre-canned text or stream events."""

    def __init__(
        self,
        chat_response: str = "",
        stream_events: list[dict] | None = None,
    ) -> None:
        self.chat_response = chat_response
        self.stream_events = stream_events or []
        self.chat_calls: list[dict] = []

    async def resolve_usage_context(self, task_type: str, **kwargs: Any) -> dict:
        return {
            "model": "fake/gpt-test",
            "provider_code": "fake",
            "model_id": "gpt-test",
            "input_cost_per_1m": 0.0,
            "output_cost_per_1m": 0.0,
            "cached_input_cost_per_1m": 0.0,
        }

    async def chat(self, **kwargs: Any) -> str:
        self.chat_calls.append(kwargs)
        return self.chat_response

    async def stream_chat_with_think_detection(self, **_kwargs: Any) -> AsyncIterator[dict]:
        for event in self.stream_events:
            yield event


def _make_request() -> SimpleNamespace:
    """Fake FastAPI Request object with just enough to satisfy usage logging."""
    return SimpleNamespace(
        url=SimpleNamespace(path="/api/v1/ai/test"),
        state=SimpleNamespace(request_id="req-test"),
    )


def _make_user() -> SimpleNamespace:
    return SimpleNamespace(user_id="user-1", role="admin")


def _make_metrics() -> MetricsStore:
    return MetricsStore(usage_log_alert_threshold=100, usage_log_sample_limit=10)


# ─────────────────────────── Parser helpers ───────────────────────────


class TestParseTags:
    def test_parses_json_array(self):
        assert _parse_tags('["python", "ai", "web"]') == ["python", "ai", "web"]

    def test_strips_unicode_quotes(self):
        assert _parse_tags('[\u201cpython\u201d, \u201cai\u201d]') == ["python", "ai"]

    def test_strips_hash_prefix(self):
        # #hashtag style
        assert _parse_tags("#python, #ai, #web") == ["python", "ai", "web"]

    def test_chinese_delimiters(self):
        assert _parse_tags("Python、人工智能；机器学习，深度学习") == [
            "Python",
            "人工智能",
            "机器学习",
            "深度学习",
        ]

    def test_numbered_list(self):
        text = "1. Python\n2. AI\n3. Web"
        assert _parse_tags(text) == ["Python", "AI", "Web"]

    def test_newline_with_comma_mix(self):
        text = "python, ai\nweb, ml"
        assert _parse_tags(text) == ["python", "ai", "web", "ml"]

    def test_empty_returns_empty_list(self):
        assert _parse_tags("") == []
        assert _parse_tags("   \n  ") == []

    def test_fallback_on_unparseable(self):
        # Single plain string should still return a single-item list
        result = _parse_tags("justonetag")
        assert result == ["justonetag"]


class TestParseTitles:
    def test_numbered_list(self):
        text = "1. First Title\n2. Second Title\n3. Third Title"
        assert _parse_titles(text) == ["First Title", "Second Title", "Third Title"]

    def test_bulleted_list(self):
        text = "- First\n- Second\n• Third\n* Fourth"
        assert _parse_titles(text) == ["First", "Second", "Third", "Fourth"]

    def test_json_array(self):
        assert _parse_titles('["A", "B", "C"]') == ["A", "B", "C"]

    def test_strips_surrounding_quotes(self):
        text = '1. "The First"\n2. \u201cThe Second\u201d'
        assert _parse_titles(text) == ["The First", "The Second"]

    def test_empty(self):
        assert _parse_titles("") == []


class TestSplitListLegacy:
    """Ensure legacy ``_split_list`` behavior is preserved for backward compatibility."""

    def test_comma_split(self):
        assert _split_list("a, b, c") == ["a", "b", "c"]

    def test_newline_to_comma(self):
        assert _split_list("a\nb\nc") == ["a", "b", "c"]

    def test_fallback(self):
        assert _split_list("") == [""]


# ─────────────────────────── _build_stream_result_payload ───────────────────────────


class TestBuildStreamResultPayload:
    def test_summary(self):
        payload = _build_stream_result_payload(
            task_type="summary",
            full_text="这是一段摘要。",
            prompt_variables={"content": "...", "max_length": 200},
            model="fake/gpt-test",
        )
        assert payload is not None
        assert payload["summary"] == "这是一段摘要。"
        assert payload["characterCount"] == len("这是一段摘要。")
        assert payload["model"] == "fake/gpt-test"

    def test_tags_truncates_to_max_tags(self):
        payload = _build_stream_result_payload(
            task_type="tags",
            full_text="a, b, c, d, e, f, g",
            prompt_variables={"content": "...", "max_tags": 3},
            model="fake/gpt-test",
        )
        assert payload is not None
        assert payload["tags"] == ["a", "b", "c"]

    def test_tags_with_json_output(self):
        payload = _build_stream_result_payload(
            task_type="tags",
            full_text='["python", "ai"]',
            prompt_variables={"content": "...", "max_tags": 5},
            model="fake/gpt-test",
        )
        assert payload is not None
        assert payload["tags"] == ["python", "ai"]

    def test_titles_numbered_list(self):
        payload = _build_stream_result_payload(
            task_type="titles",
            full_text="1. First\n2. Second\n3. Third",
            prompt_variables={"content": "...", "max_titles": 2},
            model="fake/gpt-test",
        )
        assert payload is not None
        assert payload["titles"] == ["First", "Second"]

    def test_polish(self):
        payload = _build_stream_result_payload(
            task_type="polish",
            full_text="润色后的内容",
            prompt_variables={"content": "原文", "tone": "专业"},
            model="fake/gpt-test",
        )
        assert payload is not None
        assert payload["polishedContent"] == "润色后的内容"

    def test_outline(self):
        payload = _build_stream_result_payload(
            task_type="outline",
            full_text="# 第一章\n## 1.1 背景",
            prompt_variables={"topic": "测试", "depth": 2, "style": "professional"},
            model="fake/gpt-test",
        )
        assert payload is not None
        assert payload["outline"].startswith("# 第一章")
        assert payload["characterCount"] > 0

    def test_translate(self):
        payload = _build_stream_result_payload(
            task_type="translate",
            full_text="Hello, world.",
            prompt_variables={
                "content": "你好，世界。",
                "target_language": "en",
                "source_language": "自动检测",
            },
            model="fake/gpt-test",
        )
        assert payload is not None
        assert payload["translatedContent"] == "Hello, world."
        assert payload["targetLanguage"] == "en"
        # "自动检测" is normalized to None
        assert payload["sourceLanguage"] is None

    def test_empty_text_returns_none(self):
        assert (
            _build_stream_result_payload(
                task_type="summary",
                full_text="",
                prompt_variables={},
                model="",
            )
            is None
        )

    def test_unknown_task_returns_none(self):
        assert (
            _build_stream_result_payload(
                task_type="unknown",
                full_text="content",
                prompt_variables={},
                model="",
            )
            is None
        )


# ─────────────────────────── Non-stream business endpoints ───────────────────────────


@pytest.mark.asyncio
async def test_summary_endpoint_returns_summary_data():
    llm = FakeLlm(chat_response="这是测试生成的摘要。")
    req = SummaryRequest(content="这是一段用来测试的文章正文，需要生成摘要。")
    resp = await ai_module.summary(
        req=req,
        request=_make_request(),
        user=_make_user(),
        cache=FakeCache(),
        llm=llm,
        metrics=_make_metrics(),
        usage_logger=FakeUsageLogger(),
    )
    assert resp.data is not None
    assert resp.data.summary == "这是测试生成的摘要。"
    assert resp.data.characterCount == len("这是测试生成的摘要。")
    assert resp.data.model == "fake/gpt-test"


@pytest.mark.asyncio
async def test_tags_endpoint_parses_comma_separated_output():
    llm = FakeLlm(chat_response="python, ai, web, ml, devops")
    req = TagsRequest(content="文章讲的是 Python AI Web 开发", maxTags=3)
    resp = await ai_module.tags(
        req=req,
        request=_make_request(),
        user=_make_user(),
        cache=FakeCache(),
        llm=llm,
        metrics=_make_metrics(),
        usage_logger=FakeUsageLogger(),
    )
    assert resp.data is not None
    assert isinstance(resp.data.tags, list)
    # Note: non-stream endpoint still uses the legacy _split_list, which
    # yields at most maxTags entries — asserts the truncation behavior.
    assert len(resp.data.tags) <= 3
    assert resp.data.tags[0] == "python"


@pytest.mark.asyncio
async def test_titles_endpoint_returns_titles_array():
    llm = FakeLlm(chat_response="Title A, Title B, Title C")
    req = TitlesRequest(content="正文示例", maxTitles=5)
    resp = await ai_module.titles(
        req=req,
        request=_make_request(),
        user=_make_user(),
        cache=FakeCache(),
        llm=llm,
        metrics=_make_metrics(),
        usage_logger=FakeUsageLogger(),
    )
    assert resp.data is not None
    assert isinstance(resp.data.titles, list)
    assert len(resp.data.titles) >= 1


@pytest.mark.asyncio
async def test_polish_endpoint_does_not_leak_changes_field():
    """Regression: PolishData.changes was removed in the 2026-04 fix."""
    llm = FakeLlm(chat_response="润色后的完整正文")
    req = PolishRequest(content="原文", tone="学术")
    resp = await ai_module.polish(
        req=req,
        request=_make_request(),
        user=_make_user(),
        llm=llm,
        metrics=_make_metrics(),
        usage_logger=FakeUsageLogger(),
    )
    assert resp.data is not None
    assert resp.data.polishedContent == "润色后的完整正文"
    # Ensure the `changes` attribute no longer exists on the Pydantic model.
    assert not hasattr(resp.data, "changes")


@pytest.mark.asyncio
async def test_outline_endpoint_returns_markdown_text():
    llm = FakeLlm(chat_response="# 第一章\n## 1.1 背景\n## 1.2 目标")
    req = OutlineRequest(topic="如何写好代码", depth=2, style="professional")
    resp = await ai_module.outline(
        req=req,
        request=_make_request(),
        user=_make_user(),
        llm=llm,
        metrics=_make_metrics(),
        usage_logger=FakeUsageLogger(),
    )
    assert resp.data is not None
    assert "第一章" in resp.data.outline


@pytest.mark.asyncio
async def test_translate_endpoint_returns_translated_content():
    llm = FakeLlm(chat_response="Hello, world.")
    req = TranslateRequest(content="你好，世界。", targetLanguage="en")
    resp = await ai_module.translate(
        req=req,
        request=_make_request(),
        user=_make_user(),
        cache=FakeCache(),
        llm=llm,
        metrics=_make_metrics(),
        usage_logger=FakeUsageLogger(),
    )
    assert resp.data is not None
    assert resp.data.translatedContent == "Hello, world."
    assert resp.data.targetLanguage == "en"


# ─────────────────────────── Stream helper ───────────────────────────


def _parse_sse_events(chunks: list[bytes]) -> list[dict]:
    """Decode a list of ``data: {...}\\n\\n`` chunks back into dicts."""
    events: list[dict] = []
    for chunk in chunks:
        text = chunk.decode("utf-8").strip()
        if not text.startswith("data: "):
            continue
        payload = text[len("data: ") :]
        try:
            events.append(json.loads(payload))
        except json.JSONDecodeError:
            pass
    return events


@pytest.mark.asyncio
async def test_stream_emits_result_event_before_done_for_tags():
    """The stream wrapper must emit ``{type:"result"}`` before ``{type:"done"}``."""
    llm = FakeLlm(
        stream_events=[
            {"type": "delta", "content": "pyth", "isThink": False},
            {"type": "delta", "content": "on, ai, ", "isThink": False},
            {"type": "delta", "content": "web", "isThink": False},
            {"type": "done"},
        ]
    )
    chunks: list[bytes] = []
    async for chunk in _stream_with_think_detection(
        request=_make_request(),
        llm=llm,
        prompt_variables={"content": "...", "max_tags": 5},
        model_alias="tags",
        user_id="user-1",
        custom_prompt=None,
        model_id=None,
        provider_code=None,
        model="fake/gpt-test",
        usage_context={"provider_code": "fake", "model_id": "gpt-test"},
        metrics=_make_metrics(),
        usage_logger=FakeUsageLogger(),
        start_time=0.0,
        request_text="test",
    ):
        chunks.append(chunk)

    events = _parse_sse_events(chunks)
    types = [e.get("type") for e in events]
    # result must precede done
    assert "result" in types, f"No result event in {types}"
    assert "done" in types
    assert types.index("result") < types.index("done")

    result_event = next(e for e in events if e.get("type") == "result")
    data = result_event["data"]
    assert "tags" in data
    assert data["tags"] == ["python", "ai", "web"]


@pytest.mark.asyncio
async def test_stream_skips_think_content_in_result():
    """Content inside ``<think>`` blocks must NOT contaminate the final result."""
    llm = FakeLlm(
        stream_events=[
            {"type": "delta", "content": "let me think...", "isThink": True},
            {"type": "delta", "content": "final answer", "isThink": False},
            {"type": "done"},
        ]
    )
    chunks: list[bytes] = []
    async for chunk in _stream_with_think_detection(
        request=_make_request(),
        llm=llm,
        prompt_variables={"content": "..."},
        model_alias="summary",
        user_id="user-1",
        custom_prompt=None,
        model_id=None,
        provider_code=None,
        model="fake/gpt-test",
        usage_context={},
        metrics=_make_metrics(),
        usage_logger=FakeUsageLogger(),
        start_time=0.0,
        request_text="test",
    ):
        chunks.append(chunk)

    events = _parse_sse_events(chunks)
    result_event = next(e for e in events if e.get("type") == "result")
    # Only the non-think "final answer" should end up in the summary payload.
    assert result_event["data"]["summary"] == "final answer"


@pytest.mark.asyncio
async def test_stream_emits_result_even_without_explicit_done():
    """Some providers close the stream without emitting 'done' — the wrapper
    must still deliver the structured result."""
    llm = FakeLlm(
        stream_events=[
            {"type": "delta", "content": "content", "isThink": False},
            # No done event
        ]
    )
    chunks: list[bytes] = []
    async for chunk in _stream_with_think_detection(
        request=_make_request(),
        llm=llm,
        prompt_variables={"content": "..."},
        model_alias="summary",
        user_id="user-1",
        custom_prompt=None,
        model_id=None,
        provider_code=None,
        model="fake/gpt-test",
        usage_context={},
        metrics=_make_metrics(),
        usage_logger=FakeUsageLogger(),
        start_time=0.0,
        request_text="test",
    ):
        chunks.append(chunk)

    events = _parse_sse_events(chunks)
    types = [e.get("type") for e in events]
    # Synthetic result + done should be appended after the raw delta
    assert "result" in types
    assert "done" in types


# ─────────────────────────── Safe prompt rendering ───────────────────────────


class TestSafeFormat:
    """Phase 4.1 regression tests: content with literal braces must not crash."""

    def test_preserves_literal_braces_in_content(self):
        template = "请为以下内容生成摘要：\n{content}"
        rendered = LlmRouter._safe_format(
            template,
            {"content": "代码片段：{ key: value }"},
        )
        assert rendered == "请为以下内容生成摘要：\n代码片段：{ key: value }"

    def test_code_block_with_braces_does_not_break(self):
        template = "润色以下代码：\n{content}"
        user_content = "function f() { return { x: 1 }; }"
        rendered = LlmRouter._safe_format(template, {"content": user_content})
        assert user_content in rendered

    def test_unknown_placeholder_preserved_verbatim(self):
        template = "Prefix {unknown_key} suffix"
        rendered = LlmRouter._safe_format(template, {"content": "x"})
        # Unknown placeholder passes through untouched
        assert rendered == "Prefix {unknown_key} suffix"

    def test_multiple_substitutions(self):
        template = "topic={topic} depth={depth}"
        rendered = LlmRouter._safe_format(
            template,
            {"topic": "AI", "depth": 3},
        )
        assert rendered == "topic=AI depth=3"

    def test_empty_template(self):
        assert LlmRouter._safe_format("", {"a": 1}) == ""

    def test_none_value_becomes_empty_string(self):
        rendered = LlmRouter._safe_format("value={x}", {"x": None})
        assert rendered == "value="

    def test_unterminated_brace_preserved(self):
        # Missing closing brace — should not crash
        rendered = LlmRouter._safe_format("prefix {content", {"content": "x"})
        assert "{content" in rendered
