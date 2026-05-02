"""Embedding 输入超长截断单元测试。

回归防护：post_id=11 (23682 chars / >8192 tokens) 这类长文以前会被
``text-embedding-3-large`` 直接 400 拒掉, 整篇 ``embed.failed``。
``LlmRouter._truncate_for_embedding`` 在网络调用前裁剪到 token 预算，
保证长博文也能成功索引。任何对截断逻辑的破坏都该让本测试失败。
"""
from __future__ import annotations

from app.services.llm_router import LlmRouter


def test_truncate_returns_short_text_unchanged():
    text, orig, sent = LlmRouter._truncate_for_embedding("hello world", 8000)
    assert text == "hello world"
    assert orig == sent
    assert orig > 0


def test_truncate_handles_empty_text():
    assert LlmRouter._truncate_for_embedding("", 8000) == ("", 0, 0)


def test_truncate_handles_zero_budget():
    # max_tokens<=0 视为关闭截断（no-op，不要让 0 把所有文本变空字符串）
    assert LlmRouter._truncate_for_embedding("hello", 0) == ("hello", 0, 0)


def test_truncate_caps_long_text_to_budget():
    # 模拟真实长博文：~23682 字符中英混排，远超 8192 token 上限。
    chunks = []
    for i in range(500):
        chunks.append(f"我们在生产环境观察到了一个奇怪的现象 #{i}, ")
        chunks.append("GET /api/v1/admin/search/posts returned 200 OK ")
        chunks.append("with embeddingStatus=FAILED. ")
        chunks.append("这通常意味着 LiteLLM 调用 aembedding 时被 provider 直接 400. ")
        chunks.append(f"Invalid input maximum input length is 8192 tokens (item {i}). ")
    long_text = "".join(chunks)[:23682]

    truncated, original, sent = LlmRouter._truncate_for_embedding(long_text, 8000)

    assert sent <= 8000, f"sent tokens must respect budget: {sent}"
    assert original >= sent, "original count cannot be smaller than sent count"
    assert len(truncated) < len(long_text), "long text should actually shrink"
    # tiktoken 路径下 sent 必须等于预算；fallback 路径下 sent 也是 8000；
    # 两条路径都不允许 sent < 1（否则会发空字符串去 embedding API）。
    assert sent >= 1


def test_truncate_no_op_when_under_budget():
    text = "短文本，token 数远低于 8000 token 预算。" * 10
    truncated, original, sent = LlmRouter._truncate_for_embedding(text, 8000)
    # 不会被截断，输出与输入一致
    assert truncated == text
    assert original == sent
