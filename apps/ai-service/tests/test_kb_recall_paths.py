"""kb_recall 召回成功路径与 render_kb_context 渲染 / 截断逻辑的单元测试。

与 test_kb_recall.py（strict 语义与失败分支）互补：这里覆盖
CUSTOM / SYSTEM_POSTS 两条数据源的成功映射、全局排序合并、kb_ids 去重限流、
维度 → pgvector cast 类型选择，以及上下文渲染的截断行为。
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services import kb_recall
from app.services.kb_recall import KBHit, KBRecallUnavailable, _cast_type_for_dim, render_kb_context


class _Conn:
    """按查询文本分发的假连接。

    * knowledge_bases 元数据按 kb_id 查表
    * search_profiles 返回预置 active profile（SYSTEM_POSTS 路径）
    * kb_embeddings / post_embeddings 召回分别按 kb_id / 固定行返回
    """

    def __init__(self, *, kb_meta=None, search_profile=None, custom_rows=None, post_rows=None):
        self.kb_meta = kb_meta or {}
        self.search_profile = search_profile
        self.custom_rows = custom_rows or {}
        self.post_rows = post_rows or []
        self.kb_meta_lookups = 0

    async def fetchrow(self, query, *args):
        if "FROM knowledge_bases" in query:
            self.kb_meta_lookups += 1
            meta = self.kb_meta.get(args[0])
            if isinstance(meta, Exception):
                raise meta
            return meta
        if "FROM search_profiles" in query:
            return self.search_profile
        return None

    async def fetch(self, query, *args):
        if "FROM kb_embeddings" in query:
            return self.custom_rows.get(args[1], [])  # $2 = kb_id
        if "FROM post_embeddings" in query:
            return self.post_rows
        return []


class _Acquire:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, *_args):
        return None


class _Pool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        return _Acquire(self.conn)


class _LLM:
    def __init__(self, embedding=(0.1, 0.2, 0.3)):
        self.embedding = list(embedding)

    async def embed(self, *_args, **_kwargs):
        return self.embedding


def _profile(monkeypatch, *, top_k=5):
    async def _fetch(_pool, _kb_id):
        return SimpleNamespace(id=8, model_id="embedding-test", top_k=top_k, score_threshold=0.2)

    monkeypatch.setattr(kb_recall, "fetch_kb_active_profile", _fetch)


def _hit(**overrides) -> KBHit:
    base = dict(
        kb_id=1, kb_slug="kb", kb_name="知识库", kb_file_id=10,
        file_title="文件A", chunk_index=0, snippet="正文片段", similarity=0.9,
    )
    base.update(overrides)
    return KBHit(**base)


# ------------------------------------------------------------------
# _cast_type_for_dim
# ------------------------------------------------------------------
@pytest.mark.parametrize(
    ("dim", "expected"),
    [(3, "vector"), (2000, "vector"), (2001, "halfvec"), (4000, "halfvec"), (4001, "vector")],
)
def test_cast_type_for_dim_boundaries(dim, expected):
    assert _cast_type_for_dim(dim) == expected


# ------------------------------------------------------------------
# render_kb_context
# ------------------------------------------------------------------
def test_render_kb_context_empty_hits_returns_none():
    assert render_kb_context([]) is None


def test_render_kb_context_formats_header_and_untitled_fallback():
    rendered = render_kb_context([
        _hit(similarity=0.834),
        _hit(file_title=None, chunk_index=3, snippet="  两侧空白应被去除  ", similarity=0.5),
    ])

    assert rendered is not None
    assert rendered.startswith("# 知识库召回")
    assert "## [知识库] · 文件: 文件A · chunk #0 · score=0.83" in rendered
    assert "## [知识库] · 文件: (未命名) · chunk #3 · score=0.50" in rendered
    assert "  两侧空白应被去除" not in rendered  # snippet 已 strip
    assert rendered.endswith("两侧空白应被去除")


def test_render_kb_context_truncates_when_budget_exhausted():
    big = _hit(snippet="A" * 100, similarity=0.9)
    second = _hit(snippet="第二段不应出现", similarity=0.8)
    rendered = render_kb_context([big, second], max_chars=200)

    assert rendered is not None
    assert "A" * 100 in rendered
    assert "第二段不应出现" not in rendered
    assert "已截断" in rendered


# ------------------------------------------------------------------
# recall_kbs：输入防御与 kb_ids 去重限流
# ------------------------------------------------------------------
@pytest.mark.asyncio
async def test_recall_returns_empty_for_no_kbs_or_blank_query():
    pool = _Pool(_Conn())
    assert await kb_recall.recall_kbs(pool, _LLM(), kb_ids=[], query="有效查询") == []
    assert await kb_recall.recall_kbs(pool, _LLM(), kb_ids=[1], query="   ") == []
    assert pool.conn.kb_meta_lookups == 0


@pytest.mark.asyncio
async def test_recall_dedupes_and_caps_kb_ids_at_ten():
    conn = _Conn()  # 所有 kb 元数据缺失 → 非 strict 各自返回 []
    result = await kb_recall.recall_kbs(
        _Pool(conn), _LLM(), kb_ids=[7, 7, 7] + list(range(100, 120)), query="查询"
    )
    assert result == []
    assert conn.kb_meta_lookups == 10  # 去重后仍超限 → 只取前 10 个


# ------------------------------------------------------------------
# CUSTOM 库成功路径 + 全局排序
# ------------------------------------------------------------------
@pytest.mark.asyncio
async def test_recall_custom_kb_maps_rows_and_sorts_across_kbs(monkeypatch):
    _profile(monkeypatch)
    conn = _Conn(
        kb_meta={
            7: {"slug": "support", "name": "客服资料", "kind": "CUSTOM"},
            9: {"slug": "legal", "name": "法务", "kind": "CUSTOM"},
        },
        custom_rows={
            7: [
                {"kb_file_id": 11, "chunk_index": 0, "similarity": 0.91, "snippet": "退款政策", "file_title": "FAQ"},
                {"kb_file_id": 11, "chunk_index": 2, "similarity": 0.42, "snippet": None, "file_title": "FAQ"},
            ],
            9: [
                {"kb_file_id": 30, "chunk_index": 1, "similarity": 0.77, "snippet": "合同条款", "file_title": "合同"},
            ],
        },
    )

    hits = await kb_recall.recall_kbs(_Pool(conn), _LLM(), kb_ids=[7, 9], query="退款")

    assert [h.similarity for h in hits] == [0.91, 0.77, 0.42]  # 跨 KB 全局降序
    top = hits[0]
    assert (top.kb_id, top.kb_slug, top.kb_name) == (7, "support", "客服资料")
    assert (top.kb_file_id, top.file_title, top.chunk_index) == (11, "FAQ", 0)
    assert top.snippet == "退款政策"
    assert hits[2].snippet == ""  # NULL snippet 归一为空串
    assert hits[1].kb_name == "法务"


@pytest.mark.asyncio
async def test_recall_honors_top_k_total_after_merge(monkeypatch):
    _profile(monkeypatch)
    conn = _Conn(
        kb_meta={7: {"slug": "support", "name": "客服资料", "kind": "CUSTOM"}},
        custom_rows={
            7: [
                {"kb_file_id": 1, "chunk_index": i, "similarity": 0.9 - i * 0.1, "snippet": f"s{i}", "file_title": "F"}
                for i in range(5)
            ],
        },
    )

    hits = await kb_recall.recall_kbs(_Pool(conn), _LLM(), kb_ids=[7], query="q", top_k_total=3)
    assert len(hits) == 3
    assert [h.chunk_index for h in hits] == [0, 1, 2]


@pytest.mark.asyncio
async def test_recall_empty_embedding_custom_kb(monkeypatch):
    _profile(monkeypatch)
    conn = _Conn(kb_meta={7: {"slug": "s", "name": "n", "kind": "CUSTOM"}})

    assert await kb_recall.recall_kbs(_Pool(conn), _LLM(embedding=[]), kb_ids=[7], query="q") == []
    with pytest.raises(KBRecallUnavailable):
        await kb_recall.recall_kbs(_Pool(conn), _LLM(embedding=[]), kb_ids=[7], query="q", strict=True)


@pytest.mark.asyncio
async def test_recall_custom_kb_without_active_profile_degrades_to_empty(monkeypatch):
    async def missing_profile(_pool, _kb_id):
        raise RuntimeError("no active profile for kb")

    monkeypatch.setattr(kb_recall, "fetch_kb_active_profile", missing_profile)
    conn = _Conn(kb_meta={7: {"slug": "s", "name": "n", "kind": "CUSTOM"}})

    # 非 strict：profile 缺失退化为空结果，不影响 Agent 主链路
    assert await kb_recall.recall_kbs(_Pool(conn), _LLM(), kb_ids=[7], query="q") == []


@pytest.mark.asyncio
async def test_recall_partial_failure_keeps_other_kb_results(monkeypatch):
    """单库元数据查询抛错（DB 抖动）不应拖垮整个 RAG 召回。

    异常须传播到 asyncio.gather(return_exceptions=True) 的收集侧被过滤，
    而非在 _recall_custom_kb 内部被吞掉 —— 所以故障注入在 knowledge_bases
    元数据查询这一层（profile / embed 的失败有各自独立分支）。
    """
    _profile(monkeypatch)
    conn = _Conn(
        kb_meta={
            7: {"slug": "ok", "name": "正常库", "kind": "CUSTOM"},
            8: RuntimeError("kb 8 metadata query failed"),
        },
        custom_rows={
            7: [{"kb_file_id": 1, "chunk_index": 0, "similarity": 0.8, "snippet": "内容", "file_title": "F"}],
        },
    )

    hits = await kb_recall.recall_kbs(_Pool(conn), _LLM(), kb_ids=[7, 8], query="q")
    assert [h.kb_id for h in hits] == [7]


# ------------------------------------------------------------------
# SYSTEM_POSTS 路径
# ------------------------------------------------------------------
_SYSTEM_KB = {"slug": "posts", "name": "博客文章", "kind": "SYSTEM_POSTS"}


@pytest.mark.asyncio
async def test_recall_system_posts_maps_post_rows():
    conn = _Conn(
        kb_meta={3: _SYSTEM_KB},
        search_profile={
            "id": 5, "model_id": "emb", "chunker_kind": "parent_child",
            "chunk_size_tokens": 400, "chunk_overlap_tokens": 40,
        },
        post_rows=[
            {"post_id": 42, "chunk_index": 1, "similarity": 0.66, "snippet": "文章片段", "file_title": "文章标题"},
        ],
    )

    hits = await kb_recall.recall_kbs(_Pool(conn), _LLM(), kb_ids=[3], query="q")

    assert len(hits) == 1
    hit = hits[0]
    assert (hit.kb_id, hit.kb_slug, hit.kb_name) == (3, "posts", "博客文章")
    assert hit.kb_file_id == 42  # post_id 复用为 kb_file_id
    assert (hit.file_title, hit.chunk_index, hit.snippet) == ("文章标题", 1, "文章片段")
    assert hit.similarity == 0.66


@pytest.mark.asyncio
async def test_recall_system_posts_without_active_profile():
    conn = _Conn(kb_meta={3: _SYSTEM_KB}, search_profile=None)

    assert await kb_recall.recall_kbs(_Pool(conn), _LLM(), kb_ids=[3], query="q") == []
    with pytest.raises(KBRecallUnavailable):
        await kb_recall.recall_kbs(_Pool(conn), _LLM(), kb_ids=[3], query="q", strict=True)


@pytest.mark.asyncio
async def test_recall_system_posts_embed_failure_and_empty_embedding():
    conn = _Conn(
        kb_meta={3: _SYSTEM_KB},
        search_profile={
            "id": 5, "model_id": "emb", "chunker_kind": "parent_child",
            "chunk_size_tokens": 400, "chunk_overlap_tokens": 40,
        },
    )

    class _FailingLLM:
        async def embed(self, *_args, **_kwargs):
            raise RuntimeError("embedding provider down")

    assert await kb_recall.recall_kbs(_Pool(conn), _FailingLLM(), kb_ids=[3], query="q") == []
    with pytest.raises(KBRecallUnavailable):
        await kb_recall.recall_kbs(_Pool(conn), _FailingLLM(), kb_ids=[3], query="q", strict=True)

    assert await kb_recall.recall_kbs(_Pool(conn), _LLM(embedding=[]), kb_ids=[3], query="q") == []
    with pytest.raises(KBRecallUnavailable):
        await kb_recall.recall_kbs(_Pool(conn), _LLM(embedding=[]), kb_ids=[3], query="q", strict=True)
