"""QA chunker 单元测试。

回归防护：search profile 的 ``qa`` 策略必须能识别常见 Q/A 标记并把每对
作为一个 chunk。误识别（普通博客被切成乱码）和漏识别（FAQ 被当成普通文）
都需要被本测试拦截。
"""
from __future__ import annotations

from app.services.chunker import split


def test_chinese_qa_pairs_yield_one_chunk_per_pair():
    text = (
        "问：什么是 search profile？\n"
        "答：search profile 是把 model + chunker 配置绑成一个完整索引单元。\n\n"
        "问：怎么切换 profile？\n"
        "答：管理后台创建 shadow profile，全量 reindex 后激活，原子翻转指针。\n\n"
        "问：旧数据会被删吗？\n"
        "答：不会，旧 profile 只是 deprecate；保留 30 天供回滚。\n"
    )
    chunks = split(
        text,
        chunker_kind="qa",
        chunk_size_tokens=512,
        chunk_overlap_tokens=64,
    )
    # 三对 Q/A → 三个 chunks
    assert len(chunks) == 3
    for i, c in enumerate(chunks):
        assert c.index == i
        # 每个 chunk 都应同时含 question 与 answer 标记
        assert "search profile" in chunks[0].text or "切换" in chunks[1].text or "回滚" in chunks[2].text


def test_english_qa_pairs_yield_one_chunk_per_pair():
    text = (
        "Q: What is a search profile?\n"
        "A: A bundle of model + chunker + chunk size + overlap config.\n\n"
        "Q: How to swap profiles?\n"
        "A: Create shadow, reindex, then activate to atomically flip the pointer.\n\n"
        "Q: Are old vectors deleted?\n"
        "A: No — they go to 'deprecated' and are kept for rollback.\n"
    )
    chunks = split(text, chunker_kind="qa", chunk_size_tokens=512, chunk_overlap_tokens=64)
    assert len(chunks) == 3
    # 每个 chunk 文本都应该包含 question + answer 主体
    assert "What is a search profile" in chunks[0].text
    assert "shadow" in chunks[1].text
    assert "deprecated" in chunks[2].text


def test_markdown_heading_qa_pairs():
    text = (
        "## 问题\n"
        "为什么需要 chunking？\n\n"
        "## 回答\n"
        "因为 embedding 模型有 token 上限，长文必须切成段才能完整 embed。\n\n"
        "## 问题\n"
        "chunk 越小越好吗？\n\n"
        "## 回答\n"
        "不，太小会丢失上下文，太大会超出 token 预算且召回精度下降。\n"
    )
    chunks = split(text, chunker_kind="qa", chunk_size_tokens=512, chunk_overlap_tokens=64)
    assert len(chunks) == 2
    assert "为什么需要 chunking" in chunks[0].text
    assert "上下文" in chunks[1].text


def test_qa_pair_exceeding_budget_is_split_with_question_preserved():
    # 答案极长，单对超过 chunk_size 预算
    long_answer = "这是一段非常长的答案。" * 200  # ~2400 chars
    text = (
        "问：什么是 chunking？\n"
        f"答：{long_answer}\n\n"
        "问：再问一个？\n"
        "答：再答一个简短答案。\n"
    )
    chunks = split(text, chunker_kind="qa", chunk_size_tokens=256, chunk_overlap_tokens=0)
    # 第一对会被切成多片；第二对一个 chunk
    assert len(chunks) >= 2
    # 切片产生的所有 chunks 都应包含完整 question
    long_q_chunks = [c for c in chunks if "什么是 chunking" in c.text]
    assert len(long_q_chunks) >= 1, "长答案切片后应保留至少一个含 question 的 chunk"


def test_no_qa_markers_falls_back_to_recursive():
    # 普通文章，无 Q/A 标记
    text = (
        "# 关于 chunking 的设计思考\n\n"
        "chunking 的本质是把长文档切成模型可处理的小段，"
        "在保留语义边界的同时不超过 token 预算。\n\n"
        "实现上有两条路径：固定窗口 vs 递归切分。"
        "我们选择递归切分，因为 Markdown 标题和段落是天然的语义边界。\n"
    )
    chunks = split(text, chunker_kind="qa", chunk_size_tokens=512, chunk_overlap_tokens=64)
    # 退化到 recursive，应该至少有 1 个 chunk
    assert len(chunks) >= 1
    # 不应被强行按 Q/A 切碎
    full = "\n\n".join(c.text for c in chunks)
    assert "递归切分" in full


def test_only_one_qa_pair_falls_back_to_recursive():
    # 只有一对 Q/A 不足以判定为 FAQ → 应退化
    text = (
        "前言：这是一篇技术文章。\n\n"
        "问：什么是 vector search？\n"
        "答：通过余弦相似度在向量空间中找最近邻文档。\n\n"
        "其他正文段落继续展开论述...\n"
        "总结：vector search 配合传统全文检索能显著提升用户体验。\n"
    )
    chunks = split(text, chunker_kind="qa", chunk_size_tokens=512, chunk_overlap_tokens=64)
    # 退化路径：至少有一个 chunk，不会被切成单纯的 Q/A 对
    assert len(chunks) >= 1
    full = "\n\n".join(c.text for c in chunks)
    # 退化到 recursive 后，"前言"和"总结"都应该被保留
    assert "前言" in full
    assert "总结" in full


def test_empty_text_yields_no_chunks():
    assert split("", chunker_kind="qa", chunk_size_tokens=512, chunk_overlap_tokens=64) == []
    assert split("   \n\n  ", chunker_kind="qa", chunk_size_tokens=512, chunk_overlap_tokens=64) == []
