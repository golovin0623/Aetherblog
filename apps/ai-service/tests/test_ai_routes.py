"""/api/v1/ai/* 业务端点与流式辅助函数的单元测试。

这些用例聚焦于对前端暴露的形态契约：

- 非流式端点必须返回文档化的 ``*Data`` payload 形态
  （``SummaryData`` / ``TagsData`` / ``TitlesData`` / ``PolishData`` /
  ``OutlineData`` / ``TranslateData``）。
- 流式端点除了下发原始的 delta token 之外，还必须发出终结的
  ``{type:"result", data:<*Data>}`` SSE 事件 —— 见 2026-04 “AI 工具箱
  输出承接” 修复（apps/ai-service/app/api/routes/ai.py）。
- 健壮的解析器（``_parse_tags`` / ``_parse_titles``）必须能处理 JSON
  数组、逗号 / 换行分隔、编号列表、Unicode 引号等多种形态。
- ``LlmRouter._safe_format`` 必须能容忍含字面 ``{`` / ``}`` 的用户内容
  （Phase 4.1 修复）。
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, AsyncIterator

import pytest

from app.api.routes import ai as ai_module
from app.api.routes.ai import (
    _build_stream_result_payload,
    _filter_tags,
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


# ─────────────────────────── 各种 Fake 对象 ───────────────────────────


class FakeCache:
    """与 CacheStore 的 ``get_json`` / ``set_json`` 接口兼容的空操作 cache。"""

    def __init__(self) -> None:
        self.store: dict[str, Any] = {}

    async def get_json(self, key: str) -> Any:
        return self.store.get(key)

    async def set_json(self, key: str, value: Any, ttl: int) -> None:
        self.store[key] = value


class FakeUsageLogger:
    """吞掉 ``record`` 调用，避免触达数据库。"""

    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    async def record(self, **kwargs: Any) -> None:
        self.records.append(kwargs)


class FakeLlm:
    """精简版 LlmRouter 替身，返回预设文本或预设流式事件。"""

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
    """构造一个最简的伪 FastAPI Request，足以满足 usage logging。"""
    return SimpleNamespace(
        url=SimpleNamespace(path="/api/v1/ai/test"),
        state=SimpleNamespace(request_id="req-test"),
    )


def _make_user() -> SimpleNamespace:
    return SimpleNamespace(user_id="user-1", role="admin")


def _make_metrics() -> MetricsStore:
    return MetricsStore(usage_log_alert_threshold=100, usage_log_sample_limit=10)


# ─────────────────────────── 解析器辅助 ───────────────────────────


class TestParseTags:
    def test_parses_json_array(self):
        assert _parse_tags('["python", "ai", "web"]') == ["python", "ai", "web"]

    def test_strips_unicode_quotes(self):
        assert _parse_tags('[\u201cpython\u201d, \u201cai\u201d]') == ["python", "ai"]

    def test_strips_hash_prefix(self):
        # #hashtag 风格
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
        # 单个普通字符串仍应返回单元素列表
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

    def test_degenerate_inputs_return_empty(self):
        # 退化输入：JSON 字面字符 / 仅分隔符 / 仅编号前缀。历史实现会回退到
        # ``_split_list``，把这些当成有效标题返回（``["[]"]`` / ``[","]`` /
        # ``["1.", "2.", "3."]``），引入与本 PR 修复同类的脏数据。新实现
        # 在 collected 为空时返回 ``[]``，才是正确语义。
        assert _parse_titles("[]") == []
        assert _parse_titles(",") == []
        assert _parse_titles("1.\n2.\n3.") == []


class TestParseTagsDegenerate:
    """与 ``_parse_titles`` 同理: 退化输入应返回 ``[]`` 而非脏 token。"""

    def test_empty_brackets(self):
        assert _parse_tags("[]") == []

    def test_only_separators(self):
        assert _parse_tags(",") == []
        assert _parse_tags("，；; 、") == []


class TestSplitListLegacy:
    """确保旧的 ``_split_list`` 行为得以保留，向后兼容。"""

    def test_comma_split(self):
        assert _split_list("a, b, c") == ["a", "b", "c"]

    def test_newline_to_comma(self):
        assert _split_list("a\nb\nc") == ["a", "b", "c"]

    def test_fallback(self):
        assert _split_list("") == [""]


class TestFilterTags:
    """LLM 偶尔把整句话当成标签输出，``_filter_tags`` 兜底丢弃过长项。"""

    def test_drops_overly_long_tag(self):
        result = _filter_tags(
            ["机器学习", "向量数据库", "这是一段被错误当作标签返回的完整句子超过十六字"]
        )
        assert result == ["机器学习", "向量数据库"]

    def test_dedupes_case_insensitively(self):
        assert _filter_tags(["Python", "python", "AI", "ai"]) == ["Python", "AI"]

    def test_keeps_reasonable_english_phrases(self):
        # 16 字符以内的双词英文标签应保留
        assert _filter_tags(["machine learning", "rag"]) == ["machine learning", "rag"]

    def test_falls_back_to_truncated_when_all_filtered(self):
        # 所有 tag 都超长时不能直接清空，否则前端误判提取失败
        result = _filter_tags(["这是一个非常非常非常非常长的标签文本超过限制了"])
        assert len(result) == 1
        assert len(result[0]) <= 16


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
        # "自动检测" 会被归一化为 None
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


# ─────────────────────────── 非流式业务端点 ───────────────────────────


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
    # 非流式端点已切到 _filter_tags(_parse_tags(...)), 长度 ≤ maxTags 且首项保持顺序
    assert len(resp.data.tags) <= 3
    assert resp.data.tags[0] == "python"


@pytest.mark.asyncio
async def test_tags_bypass_cache_skips_get_but_overwrites_set():
    """bypassCache=true 时跳过缓存读, 但新结果必须写回, 否则陈旧条目仍会
    被后续不带 bypassCache 的请求命中 (gemini-code-assist 评审建议)。"""
    cache = FakeCache()
    cache.store["preloaded"] = {"tags": ["stale"], "model": "fake/gpt-test"}
    # 先用一次正常调用让端点写入它真正使用的 cache_key
    seed_llm = FakeLlm(chat_response="stale1, stale2, stale3")
    seed_req = TagsRequest(content="文章 X", maxTags=3)
    await ai_module.tags(
        req=seed_req, request=_make_request(), user=_make_user(),
        cache=cache, llm=seed_llm,
        metrics=_make_metrics(), usage_logger=FakeUsageLogger(),
    )
    # 锁定刚才那个真实 key (排除手动 preloaded)
    real_keys = [k for k in cache.store if k != "preloaded"]
    assert len(real_keys) == 1
    real_key = real_keys[0]
    assert cache.store[real_key]["tags"] == ["stale1", "stale2", "stale3"]

    # 同样 content + maxTags, bypassCache=true: 跳过 GET, 拿到 fresh 结果, 同时覆盖缓存
    fresh_llm = FakeLlm(chat_response="fresh1, fresh2, fresh3")
    fresh_req = TagsRequest(content="文章 X", maxTags=3, bypassCache=True)
    resp = await ai_module.tags(
        req=fresh_req, request=_make_request(), user=_make_user(),
        cache=cache, llm=fresh_llm,
        metrics=_make_metrics(), usage_logger=FakeUsageLogger(),
    )
    assert resp.data.tags == ["fresh1", "fresh2", "fresh3"]
    # 最关键的一条: 缓存已被新结果覆盖
    assert cache.store[real_key]["tags"] == ["fresh1", "fresh2", "fresh3"]


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
async def test_titles_endpoint_strips_json_array_brackets():
    """回归：migration 000038 后 prompt 引导 LLM 输出 JSON 数组,
    非流式端点必须用 ``_parse_titles`` 解析,而不是 ``_split_list`` ——
    否则会被逗号切成 ``["t1"`` / ``"t2"`` / ``"t3"]`` 这种残留括号引号
    的脏数据,前端就会渲染成 `1. ["xxx"  2. "yyy"  ...  6. "zzz"]`。"""
    llm = FakeLlm(
        chat_response='["阿里云百炼 Coding Plan 快速上手指南", "如何获取百炼 API Key 并开始使用?", "Claude Code 与 Codex 的百炼接入说明"]'
    )
    req = TitlesRequest(content="正文示例", maxTitles=6)
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
    assert resp.data.titles == [
        "阿里云百炼 Coding Plan 快速上手指南",
        "如何获取百炼 API Key 并开始使用?",
        "Claude Code 与 Codex 的百炼接入说明",
    ]
    # 任何一条都不应残留 JSON 字面字符
    for t in resp.data.titles:
        assert "[" not in t and "]" not in t and '"' not in t


@pytest.mark.asyncio
async def test_polish_endpoint_does_not_leak_changes_field():
    """回归测试：PolishData.changes 字段已在 2026-04 修复中移除。"""
    llm = FakeLlm(chat_response="润色后的完整正文")
    req = PolishRequest(content="原文", tone="学术")
    resp = await ai_module.polish(
        req=req,
        request=_make_request(),
        user=_make_user(),
        cache=FakeCache(),
        llm=llm,
        metrics=_make_metrics(),
        usage_logger=FakeUsageLogger(),
    )
    assert resp.data is not None
    assert resp.data.polishedContent == "润色后的完整正文"
    # 确认 Pydantic 模型上 `changes` 属性确实已消失。
    assert not hasattr(resp.data, "changes")


@pytest.mark.asyncio
async def test_polish_caches_result_and_serves_from_cache_on_repeat():
    """polish 任务必须挂上 Redis 缓存 (审计 §1.2 / §4.2)。同样
    content + tone + model 第二次调用应直接命中缓存而不再触达 LLM,
    避免迭代修文反复烧 token。"""
    cache = FakeCache()
    llm1 = FakeLlm(chat_response="第一次润色结果")
    req1 = PolishRequest(content="原稿正文", tone="学术")
    await ai_module.polish(
        req=req1, request=_make_request(), user=_make_user(),
        cache=cache, llm=llm1,
        metrics=_make_metrics(), usage_logger=FakeUsageLogger(),
    )
    assert len(llm1.chat_calls) == 1, "第一次必须触达 LLM"
    assert len(cache.store) == 1, "第一次必须落盘到缓存"

    # 第二次同样请求 —— LLM 不应被再次调用
    llm2 = FakeLlm(chat_response="不应被使用的二次响应")
    req2 = PolishRequest(content="原稿正文", tone="学术")
    resp2 = await ai_module.polish(
        req=req2, request=_make_request(), user=_make_user(),
        cache=cache, llm=llm2,
        metrics=_make_metrics(), usage_logger=FakeUsageLogger(),
    )
    assert len(llm2.chat_calls) == 0, "缓存命中, LLM 不应被触达"
    assert resp2.data.polishedContent == "第一次润色结果"


@pytest.mark.asyncio
async def test_polish_skips_cache_when_custom_prompt():
    """custom prompt 让输入空间组合爆炸,命中率极低且容易缓存到一次性
    实验结果。带 promptTemplate 必须跳过缓存读写。"""
    cache = FakeCache()
    llm = FakeLlm(chat_response="实验性 prompt 输出")
    req = PolishRequest(content="原稿", tone="正式", promptTemplate="实验 prompt {{content}}")
    await ai_module.polish(
        req=req, request=_make_request(), user=_make_user(),
        cache=cache, llm=llm,
        metrics=_make_metrics(), usage_logger=FakeUsageLogger(),
    )
    assert len(llm.chat_calls) == 1
    assert len(cache.store) == 0, "custom prompt 不应写缓存"


@pytest.mark.asyncio
async def test_outline_endpoint_returns_markdown_text():
    llm = FakeLlm(chat_response="# 第一章\n## 1.1 背景\n## 1.2 目标")
    req = OutlineRequest(topic="如何写好代码", depth=2, style="professional")
    resp = await ai_module.outline(
        req=req,
        request=_make_request(),
        user=_make_user(),
        cache=FakeCache(),
        llm=llm,
        metrics=_make_metrics(),
        usage_logger=FakeUsageLogger(),
    )
    assert resp.data is not None
    assert "第一章" in resp.data.outline


@pytest.mark.asyncio
async def test_outline_caches_result_with_topic_depth_style_signature():
    """outline 缓存键必须区分 topic / depth / style / existingContent;
    任一变化都应当 miss, 否则会拿到错误深度或风格的旧大纲。"""
    cache = FakeCache()
    llm1 = FakeLlm(chat_response="# Topic A 深度 2 大纲")
    await ai_module.outline(
        req=OutlineRequest(topic="Topic A", depth=2, style="professional"),
        request=_make_request(), user=_make_user(),
        cache=cache, llm=llm1,
        metrics=_make_metrics(), usage_logger=FakeUsageLogger(),
    )
    assert len(llm1.chat_calls) == 1
    assert len(cache.store) == 1

    # 同 topic + 同 depth + 同 style → 缓存命中
    llm2 = FakeLlm(chat_response="不应使用的二次响应")
    resp2 = await ai_module.outline(
        req=OutlineRequest(topic="Topic A", depth=2, style="professional"),
        request=_make_request(), user=_make_user(),
        cache=cache, llm=llm2,
        metrics=_make_metrics(), usage_logger=FakeUsageLogger(),
    )
    assert len(llm2.chat_calls) == 0
    assert "Topic A 深度 2 大纲" in resp2.data.outline

    # depth 改变 → 必须 miss, 不能拿到 depth=2 的陈旧结果
    llm3 = FakeLlm(chat_response="# Topic A 深度 3 全新大纲")
    resp3 = await ai_module.outline(
        req=OutlineRequest(topic="Topic A", depth=3, style="professional"),
        request=_make_request(), user=_make_user(),
        cache=cache, llm=llm3,
        metrics=_make_metrics(), usage_logger=FakeUsageLogger(),
    )
    assert len(llm3.chat_calls) == 1, "depth 变化必须重新生成"
    assert "深度 3" in resp3.data.outline


@pytest.mark.asyncio
async def test_outline_bypass_cache_overwrites_stale_entry():
    """与 tags / summary 一致: bypassCache=true 跳过 GET 但保留 SET,
    确保陈旧缓存被新结果覆盖。"""
    cache = FakeCache()
    seed_llm = FakeLlm(chat_response="# 陈旧大纲")
    await ai_module.outline(
        req=OutlineRequest(topic="主题", depth=2, style="professional"),
        request=_make_request(), user=_make_user(),
        cache=cache, llm=seed_llm,
        metrics=_make_metrics(), usage_logger=FakeUsageLogger(),
    )
    assert len(cache.store) == 1
    [seeded_key] = list(cache.store.keys())

    fresh_llm = FakeLlm(chat_response="# 全新大纲")
    resp = await ai_module.outline(
        req=OutlineRequest(topic="主题", depth=2, style="professional", bypassCache=True),
        request=_make_request(), user=_make_user(),
        cache=cache, llm=fresh_llm,
        metrics=_make_metrics(), usage_logger=FakeUsageLogger(),
    )
    assert len(fresh_llm.chat_calls) == 1
    assert "全新大纲" in resp.data.outline
    # 缓存被覆盖 —— 不再返回陈旧版本
    assert "全新大纲" in cache.store[seeded_key]["outline"]


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


# ─────────────────────────── 流式辅助 ───────────────────────────


def _parse_sse_events(chunks: list[bytes]) -> list[dict]:
    """把若干 ``data: {...}\\n\\n`` chunk 解码回 dict 列表。"""
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
    """流式包装器必须在 ``{type:"done"}`` 之前下发 ``{type:"result"}``。"""
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
    # result 必须先于 done
    assert "result" in types, f"No result event in {types}"
    assert "done" in types
    assert types.index("result") < types.index("done")

    result_event = next(e for e in events if e.get("type") == "result")
    data = result_event["data"]
    assert "tags" in data
    assert data["tags"] == ["python", "ai", "web"]


@pytest.mark.asyncio
async def test_stream_skips_think_content_in_result():
    """``<think>`` 块内的内容不得污染最终 result。"""
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
    # 只有非 think 部分的 "final answer" 才应进入 summary payload。
    assert result_event["data"]["summary"] == "final answer"


@pytest.mark.asyncio
async def test_stream_emits_result_even_without_explicit_done():
    """部分 provider 不下发 'done' 就关闭流 —— 包装器仍必须交付结构化 result。"""
    llm = FakeLlm(
        stream_events=[
            {"type": "delta", "content": "content", "isThink": False},
            # 没有 done 事件
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
    # 在原始 delta 之后应被补上合成的 result + done
    assert "result" in types
    assert "done" in types


# ─────────────────────────── 安全的 prompt 渲染 ───────────────────────────


class TestSafeFormat:
    """Phase 4.1 回归测试：含字面花括号的内容不得触发崩溃。"""

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
        # 未知占位符应原样保留
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
        # 缺少闭合花括号 —— 不应崩溃
        rendered = LlmRouter._safe_format("prefix {content", {"content": "x"})
        assert "{content" in rendered


# ─────────────────────── 消息构造（system/user 拆分）───────────────────────


def _stub_router() -> LlmRouter:
    """绕过依赖环境变量的 __init__，构造一个纯壳 LlmRouter，用于直接测试纯函数。"""
    obj = LlmRouter.__new__(LlmRouter)
    return obj


class TestBuildMessages:
    """system/user 拆分修复的回归套件。

    旧实现把整段模板都渲染进 system 角色，并把 ``content`` 从变量字典中
    剔除，导致字面量 ``{content}`` 占位符被模型看到 —— 这是“summary 输出
    千字问答”bug 的根因。修复后的拆分必须：

    1. 把真实内容放到 user 消息中。
    2. 从 system 消息里去掉 ``{content}`` 标记。
    3. 保留 ``{content}`` 之后的尾部指令。
    4. 替换其它所有占位符（例如 ``{max_length}``）。
    """

    def test_content_placeholder_does_not_leak_into_system(self):
        router = _stub_router()
        msgs = router._build_messages(
            "请用一段话总结（不超过 {max_length} 字）：\n{content}",
            {"content": "今天天气真好", "max_length": 200},
        )
        assert msgs[0]["role"] == "system"
        assert "{content}" not in msgs[0]["content"]
        assert "不超过 200 字" in msgs[0]["content"]
        assert msgs[1] == {"role": "user", "content": "今天天气真好"}

    def test_trailing_instructions_after_content_are_preserved(self):
        router = _stub_router()
        msgs = router._build_messages(
            "请生成 {max} 个标签：\n{content}\n\n要求：以 JSON 数组输出",
            {"content": "示例文章", "max": 5},
        )
        sys_text = msgs[0]["content"]
        assert "请生成 5 个标签" in sys_text
        assert "JSON 数组" in sys_text
        assert msgs[1]["content"] == "示例文章"

    def test_no_template_falls_back_to_user_only(self):
        # task_alias=None 时 (例如 admin/未知任务), 仍走旧逻辑发单条 user 消息,
        # 但 _build_messages 内部会落 ERROR 日志方便排查。
        router = _stub_router()
        msgs = router._build_messages(None, {"content": "hi"})
        assert msgs == [{"role": "user", "content": "hi"}]

    def test_no_template_uses_task_fallback_system_prompt_for_summary(self):
        """SUMMARY-LONGER-THAN-SOURCE 回归锁: prompt_template 为空但 task
        是已知业务任务时, 必须用 _TASK_FALLBACK_SYSTEM_PROMPT 兜底, 不能
        把文章裸发出去当聊天问句。"""
        router = _stub_router()
        msgs = router._build_messages(None, {"content": "今天的文章正文"}, task_alias="summary")
        assert len(msgs) == 2
        assert msgs[0]["role"] == "system"
        assert "摘要" in msgs[0]["content"]
        assert "200 字以内" in msgs[0]["content"]
        assert msgs[1] == {"role": "user", "content": "今天的文章正文"}

    def test_no_template_uses_task_fallback_for_each_known_task(self):
        """所有已知业务任务都必须有 fallback prompt, 防止任何一类 AI 工具
        在 routing/task_types 表为空时退化为裸发模式。"""
        router = _stub_router()
        for task_alias in ("summary", "tags", "titles", "polish", "outline", "translate", "qa"):
            msgs = router._build_messages(None, {"content": "x"}, task_alias=task_alias)
            assert msgs[0]["role"] == "system", f"{task_alias} 缺失 system 消息"
            assert msgs[0]["content"].strip(), f"{task_alias} 的 fallback prompt 为空"
            assert msgs[1] == {"role": "user", "content": "x"}, f"{task_alias} 未把内容放到 user 消息"


class TestMaskSecret:
    """凭证脱敏: 调用日志里只能出现尾 4 位, 严禁泄露明文 api_key。"""

    def test_short_secret_fully_masked(self):
        assert LlmRouter._mask_secret("abc") == "****"

    def test_long_secret_keeps_tail_only(self):
        # 典型 OpenAI key 形如 sk-...XXXX, 必须只露尾 4 位
        assert LlmRouter._mask_secret("sk-1234567890ABCDEF") == "****CDEF"

    def test_empty_secret_returns_empty(self):
        assert LlmRouter._mask_secret("") == ""
        assert LlmRouter._mask_secret(None) == ""


class TestSummarizeMessages:
    """请求审计日志的 messages 缩略行为: 截断长 content, 保留 char_total。"""

    def test_short_content_passes_through(self):
        msgs = [{"role": "user", "content": "hi"}]
        out = LlmRouter._summarize_messages(msgs, snippet_chars=100)
        assert out == [{"role": "user", "char_total": 2, "content_snippet": "hi"}]

    def test_long_content_truncated_with_total_preserved(self):
        long_text = "x" * 1500
        msgs = [{"role": "user", "content": long_text}]
        out = LlmRouter._summarize_messages(msgs, snippet_chars=400)
        assert out[0]["char_total"] == 1500
        assert len(out[0]["content_snippet"]) == 400
        assert out[0]["truncated"] is True

    def test_template_without_content_marker_keeps_content_in_user(self):
        """没有显式 ``{content}`` 占位符的自定义 prompt 仍必须把文章正文
        传给模型 —— 否则管理员设置的 “请直接输出摘要” 之类 prompt 会
        静默丢掉输入。（PR #517 review）
        """
        router = _stub_router()
        msgs = router._build_messages(
            "你是专业摘要助手, 请直接输出摘要", {"content": "今天的文章正文"}
        )
        assert msgs == [
            {"role": "system", "content": "你是专业摘要助手, 请直接输出摘要"},
            {"role": "user", "content": "今天的文章正文"},
        ]

    def test_template_without_content_marker_and_no_content_var(self):
        # 边界场景：完全没有 ``content`` 变量（例如 outline 仅使用 ``topic``）。
        # system 持有模板，user 为空字符串。
        router = _stub_router()
        msgs = router._build_messages("请输出当前时间", {})
        assert msgs == [
            {"role": "system", "content": "请输出当前时间"},
            {"role": "user", "content": ""},
        ]

    def test_brace_literals_in_content_survive(self):
        router = _stub_router()
        weird = "function f() { return { x: 1 }; }"
        msgs = router._build_messages(
            "解释代码（{max_length}字内）:\n{content}",
            {"content": weird, "max_length": 100},
        )
        assert msgs[1]["content"] == weird
        assert "{content}" not in msgs[0]["content"]
        assert "100字内" in msgs[0]["content"]


# ─────────────────────── 推理轨迹标签检测 ───────────────────────


class TestThinkTagRegex:
    """确保扩展后的标签匹配器能识别 Qwen / R1 / 自定义变体，
    同时不会误伤普通正文。"""

    def test_matches_canonical_think(self):
        assert LlmRouter._THINK_OPEN_RE.search("<think>")
        assert LlmRouter._THINK_CLOSE_RE.search("</think>")

    def test_matches_thinking_variant(self):
        assert LlmRouter._THINK_OPEN_RE.search("<thinking>")
        assert LlmRouter._THINK_CLOSE_RE.search("</thinking>")

    def test_matches_reasoning_variant(self):
        assert LlmRouter._THINK_OPEN_RE.search("<reasoning>")
        assert LlmRouter._THINK_CLOSE_RE.search("</reasoning>")

    def test_case_insensitive(self):
        assert LlmRouter._THINK_OPEN_RE.search("<THINK>")
        assert LlmRouter._THINK_OPEN_RE.search("<Thinking>")

    def test_tolerates_internal_whitespace(self):
        assert LlmRouter._THINK_OPEN_RE.search("< think >")
        assert LlmRouter._THINK_CLOSE_RE.search("< / reasoning >")

    def test_does_not_match_lookalikes(self):
        assert LlmRouter._THINK_OPEN_RE.search("<thanks>") is None
        assert LlmRouter._THINK_OPEN_RE.search("<thinkable>") is None
        # ``\s*>`` 的边界条件能把 ``<thinkmore>`` 排除在外
        assert LlmRouter._THINK_OPEN_RE.search("<thinkmore>") is None


# ─────────────────────── 默认 max_tokens 兜底表 ───────────────────────


class TestDefaultMaxTokens:
    """即便 routing 表为空（仅环境变量回退），每个业务 task 也必须有硬
    上限 —— 否则 LiteLLM 会把 ``max_tokens=None`` 直接转发上去，模型
    会一直写到上下文窗口被填满。这正是用户反馈“summary 输出千字”的
    根因。"""

    def test_summary_has_a_cap(self):
        from app.services.llm_router import _TASK_DEFAULT_MAX_TOKENS

        assert _TASK_DEFAULT_MAX_TOKENS["summary"] > 0
        assert _TASK_DEFAULT_MAX_TOKENS["summary"] <= 1000

    def test_all_chat_tasks_capped(self):
        from app.services.llm_router import _TASK_DEFAULT_MAX_TOKENS

        for task in ("summary", "tags", "titles", "polish", "outline", "translate", "qa"):
            assert task in _TASK_DEFAULT_MAX_TOKENS
            assert _TASK_DEFAULT_MAX_TOKENS[task] is not None
            assert _TASK_DEFAULT_MAX_TOKENS[task] > 0


# ─────────────────────── 流式标签检测的 final flush ────────────────────


class TestStreamFinalFlush:
    """PR #517 review 回归：落在尾部 ``guard`` 窗口内的标签不得泄漏
    到最终 delta 事件。"""

    @pytest.mark.asyncio
    async def test_dangling_open_tag_at_end_of_stream_is_stripped(self):
        """模型未关闭 ``<think>``（少见但出现过）。开标签必须被剥除；
        修复前代码会原样输出 "...回答 <think>思考"。"""
        from app.services.llm_router import LlmRouter

        router = LlmRouter.__new__(LlmRouter)

        async def fake_stream(**_kwargs):
            # 整个 payload 足够短，使得主循环的 ``guard`` 窗口让尾部的
            # ``<think>...`` 一直停留在 buffer 里，直到流结束。
            yield "正式答案 "
            yield "<think>"
            yield "未闭合的思考"

        # 用 patch 把 ``stream_chat`` 替换为伪造的 chunk 生成器
        async def fake_iter(**kwargs):
            async for chunk in fake_stream(**kwargs):
                yield chunk

        router.stream_chat = fake_iter  # type: ignore[method-assign]

        events: list[dict] = []
        async for ev in router.stream_chat_with_think_detection(
            prompt_variables={"content": "x"}, model_alias="summary"
        ):
            events.append(ev)

        # 重组可见（非 think）文本。字面 "<think>" 标记不得在任何位置
        # 出现 —— 这正是要回归保护的点。
        visible = "".join(
            e["content"] for e in events
            if e["type"] == "delta" and not e.get("isThink")
        )
        assert "<think>" not in visible
        assert "正式答案" in visible
        # 未闭合的 think 段应被标记为 isThink=True。
        thinking = "".join(
            e["content"] for e in events
            if e["type"] == "delta" and e.get("isThink")
        )
        assert "未闭合的思考" in thinking

    @pytest.mark.asyncio
    async def test_complete_tag_pair_in_trailing_window_is_handled(self):
        """末端 buffer 形如 ``"<think>x</think>y"`` 必须产生干净的
        think + 可见两部分，而不是带原始标签的裸文本。"""
        from app.services.llm_router import LlmRouter

        router = LlmRouter.__new__(LlmRouter)

        async def fake_iter(**_kwargs):
            yield "<think>思考</think>结论"

        router.stream_chat = fake_iter  # type: ignore[method-assign]

        events: list[dict] = []
        async for ev in router.stream_chat_with_think_detection(
            prompt_variables={"content": "x"}, model_alias="summary"
        ):
            events.append(ev)

        visible = "".join(
            e["content"] for e in events
            if e["type"] == "delta" and not e.get("isThink")
        )
        thinking = "".join(
            e["content"] for e in events
            if e["type"] == "delta" and e.get("isThink")
        )
        assert "<think>" not in visible
        assert "</think>" not in visible
        assert "结论" in visible
        assert "思考" in thinking
