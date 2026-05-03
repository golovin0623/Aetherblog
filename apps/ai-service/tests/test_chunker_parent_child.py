"""parent_child chunker 单元测试。

回归防护：
- ``Chunk.parent_text`` 字段写入正确（child 是 parent 的子串）
- 短文档不会爆出多个 parent
- 长文档跨 parent 时 parent_text 切换正确
"""
from __future__ import annotations

from app.services.chunker import Chunk, split


def test_short_text_yields_single_parent_with_children_sharing_parent_text():
    # 短文（< parent_size）→ 1 个 parent，N 个 children 都共享 parent_text
    text = "短文章。" * 30  # ~120 chars，远低于 256×4=1024 token
    chunks = split(
        text,
        chunker_kind="parent_child",
        chunk_size_tokens=256,
        chunk_overlap_tokens=0,
    )
    assert len(chunks) >= 1
    # 所有 chunks 共享同一个 parent_text
    parent_texts = {c.parent_text for c in chunks}
    assert len(parent_texts) == 1
    # parent_text 包含全部内容
    parent = next(iter(parent_texts))
    assert parent is not None
    # child.text 应该是 parent_text 的子串（或等于 parent）
    for c in chunks:
        assert c.text in c.parent_text, f"child #{c.index} text not in its parent_text"


def test_long_text_yields_multiple_parents():
    # 构造长文，超过 parent_size = 256 × 4 = 1024 token
    paragraphs = []
    for i in range(80):
        paragraphs.append(
            f"第 {i} 段 paragraph mixes 中文 and English 内容用于验证 parent_child 切片器。"
            f"This paragraph #{i} contributes meaningful tokens, "
            f"我们关注 parent / child 边界的正确性。"
        )
    long_text = "\n\n".join(paragraphs)

    chunks = split(
        long_text,
        chunker_kind="parent_child",
        chunk_size_tokens=128,  # child=128, parent=128*4=512
        chunk_overlap_tokens=0,
    )

    # 应至少切出 2 个 parent，跨多个 children
    assert len(chunks) >= 2
    # 所有 chunks 都应有 parent_text
    for c in chunks:
        assert c.parent_text is not None
        assert c.text in c.parent_text, (
            f"child #{c.index} text not in its parent_text"
        )

    # 至少有 2 个不同的 parent_text（说明切出了多个 parent）
    parent_texts = {c.parent_text for c in chunks}
    assert len(parent_texts) >= 2, (
        f"expected multiple parents, got only {len(parent_texts)}"
    )


def test_chunks_are_dataclass_with_parent_text_field():
    chunks = split(
        "test content here",
        chunker_kind="parent_child",
        chunk_size_tokens=256,
        chunk_overlap_tokens=0,
    )
    assert len(chunks) >= 1
    assert isinstance(chunks[0], Chunk)
    assert chunks[0].index == 0
    assert chunks[0].parent_text is not None


def test_other_strategies_have_none_parent_text():
    # 其他策略下 parent_text 必须是 None（避免污染存储层）
    for kind in ("recursive", "fixed", "markdown", "qa"):
        chunks = split(
            "## 标题\n\n段落内容。",
            chunker_kind=kind,
            chunk_size_tokens=512,
            chunk_overlap_tokens=64,
        )
        for c in chunks:
            assert c.parent_text is None, (
                f"strategy={kind} chunk #{c.index} should have parent_text=None"
            )


def test_chunk_index_continuous():
    text = "段落内容。\n\n" * 20
    chunks = split(
        text,
        chunker_kind="parent_child",
        chunk_size_tokens=64,
        chunk_overlap_tokens=0,
    )
    assert [c.index for c in chunks] == list(range(len(chunks)))


def test_empty_text_yields_no_chunks():
    assert split(
        "", chunker_kind="parent_child", chunk_size_tokens=256, chunk_overlap_tokens=0
    ) == []
    assert split(
        "  \n\n  ",
        chunker_kind="parent_child",
        chunk_size_tokens=256,
        chunk_overlap_tokens=0,
    ) == []
