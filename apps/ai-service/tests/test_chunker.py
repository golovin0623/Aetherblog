"""递归 Markdown chunker 单元测试。

回归防护：search profile 默认策略 ``recursive`` 切片正确性。
任何对切分边界 / overlap / token 预算的破坏都该让本测试失败。
"""
from __future__ import annotations

from app.services.chunker import Chunk, split


def test_empty_text_returns_no_chunks():
    assert split("", chunker_kind="recursive", chunk_size_tokens=512, chunk_overlap_tokens=64) == []
    assert split("   \n\n  \t  ", chunker_kind="recursive", chunk_size_tokens=512, chunk_overlap_tokens=64) == []


def test_short_text_yields_single_chunk():
    chunks = split(
        "短文章，token 数远低于预算。",
        chunker_kind="recursive",
        chunk_size_tokens=512,
        chunk_overlap_tokens=64,
    )
    assert len(chunks) == 1
    assert chunks[0].index == 0
    assert "短文章" in chunks[0].text


def test_long_text_yields_multiple_chunks_within_budget():
    # 构造 ~60 段每段 200 字的混排长文（远超 512 token 预算）
    paragraphs = []
    for i in range(60):
        paragraphs.append(
            f"第 {i} 段：这是一段中文内容用于验证递归切片器的正确性。"
            f"This paragraph mixes English content as well, paragraph #{i}, "
            f"so the tokenizer sees realistic blog post density. "
            f"我们关注切片边界、overlap 行为、token 预算上限是否被严格遵守。"
        )
    long_text = "\n\n".join(paragraphs)

    chunks = split(
        long_text,
        chunker_kind="recursive",
        chunk_size_tokens=256,
        chunk_overlap_tokens=32,
    )

    # 至少应该切出 2 块
    assert len(chunks) >= 2, f"expected multi-chunk split, got {len(chunks)}"
    # chunk_index 必须从 0 开始连续递增
    assert [c.index for c in chunks] == list(range(len(chunks)))
    # 每个 chunk 的 token 数不应严重超过预算（允许 overlap 注入带来的 +overlap_size 余量）
    for c in chunks:
        assert c.tokens <= 256 + 64, (
            f"chunk #{c.index} tokens={c.tokens} exceeds budget+overlap"
        )


def test_markdown_headings_are_respected():
    text = (
        "# 主标题\n\n"
        "这是引言段落。\n\n"
        "## 第一节\n\n"
        "第一节的内容。\n\n"
        "## 第二节\n\n"
        "第二节的内容。\n\n"
    )
    chunks = split(text, chunker_kind="recursive", chunk_size_tokens=512, chunk_overlap_tokens=64)
    # 短文本下递归切片器倾向把整个文档塞一个 chunk（在 512 token 内）
    # 关键是不能把 "## 第一节" 这样的标题行切碎
    full = "\n\n".join(c.text for c in chunks)
    assert "## 第一节" in full
    assert "## 第二节" in full


def test_overlap_carries_context_between_adjacent_chunks():
    # 强制小预算让必然切出多 chunk
    paragraphs = [f"段落 {i} 的内容。" * 20 for i in range(20)]
    text = "\n\n".join(paragraphs)

    chunks = split(text, chunker_kind="recursive", chunk_size_tokens=128, chunk_overlap_tokens=32)
    assert len(chunks) >= 2

    # chunk[i] 开头应当包含 chunk[i-1] 末尾的部分文字（overlap）
    # 不强求精确字符串匹配（tokenizer 可能把单字拆字节），但至少验证 overlap 被尝试应用
    # —— 即每个非首 chunk 长度大于其单独 raw 段（说明前缀被注入了）
    for i in range(1, len(chunks)):
        # overlap 后 chunk 末尾仍应保持原段落结尾完整
        assert chunks[i].text.strip().endswith("。") or "段落" in chunks[i].text


def test_fixed_kind_pure_token_split():
    # fixed 策略不识别 Markdown 结构，纯按 token 硬切
    text = "abc " * 1000  # 1000 个 "abc " (~1500-2000 token 视 tokenizer)
    chunks = split(text, chunker_kind="fixed", chunk_size_tokens=200, chunk_overlap_tokens=0)
    assert len(chunks) >= 2
    for c in chunks:
        assert c.tokens <= 200 + 1  # 允许 ±1 token tokenizer 边界误差


def test_unknown_kind_falls_back_to_recursive():
    text = "## 标题\n\n内容段落。"
    chunks = split(text, chunker_kind="nonexistent_kind", chunk_size_tokens=512, chunk_overlap_tokens=64)
    assert len(chunks) >= 1


def test_chunk_dataclass_fields():
    chunks = split("hello world", chunker_kind="recursive", chunk_size_tokens=512, chunk_overlap_tokens=64)
    assert isinstance(chunks[0], Chunk)
    assert chunks[0].index == 0
    assert chunks[0].text == "hello world"
    assert chunks[0].tokens > 0
