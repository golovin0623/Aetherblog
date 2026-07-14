from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest

from app.services.atlas_recall import (
    AtlasRecallContext,
    AtlasNoteSourceRevision,
    AtlasSelectedSourceSnapshot,
    recall_atlas_context,
    render_atlas_context,
    selected_atlas_sources_available,
    upsert_knowledge_point_embedding,
)
from app.services.note_indexer import _build_note_embedding_text, _note_fingerprint
from app.services.vector_store import SearchProfile
from tests.support import FakeConn, FakePool


class FakeEmbedLLM:
    def __init__(self, embedding: list[float] | None = None) -> None:
        self.embedding = embedding or [0.1, 0.2, 0.3]
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def embed(self, text: str, **kwargs: Any) -> list[float]:
        self.calls.append((text, kwargs))
        return self.embedding


def _profile(**overrides: Any) -> SearchProfile:
    base = SearchProfile(
        id=42,
        code="atlas-active",
        name="Atlas active",
        description=None,
        model_id="text-embedding-3-small",
        chunker_kind="recursive",
        chunk_size_tokens=512,
        chunk_overlap_tokens=64,
        status="active",
    )
    return replace(base, **overrides)


def test_selected_source_snapshots_canonicalize_multi_note_order() -> None:
    revision_11 = AtlasNoteSourceRevision(
        note_id=11,
        status="INDEXED",
        fingerprint="fingerprint-11",
        profile_id=42,
        model_id="embed-model",
        embedding_dims=(3,),
    )
    revision_12 = AtlasNoteSourceRevision(
        note_id=12,
        status="INDEXED",
        fingerprint="fingerprint-12",
        profile_id=42,
        model_id="embed-model",
        embedding_dims=(3,),
    )

    snapshot = AtlasSelectedSourceSnapshot(
        kp_versions=((8, "v8"), (7, "v7")),
        carrier_versions=((4, "v4", "h4"), (3, "v3", "h3")),
        note_revisions=(revision_12, revision_11),
    )
    context = AtlasRecallContext(selected_note_revisions=(revision_12, revision_11))

    assert [revision.note_id for revision in snapshot.note_revisions] == [11, 12]
    assert [revision.note_id for revision in context.selected_note_revisions] == [11, 12]
    assert snapshot.kp_versions == ((7, "v7"), (8, "v8"))
    assert snapshot.carrier_versions == ((3, "v3", "h3"), (4, "v4", "h4"))


@pytest.mark.parametrize(
    ("resolved_kps", "resolved_carriers", "expected"),
    [
        ([7, 8], [3, 4], True),
        ([7], [3, 4], False),
        ([7, 8], [3], False),
    ],
)
@pytest.mark.asyncio
async def test_selected_atlas_sources_available_requires_every_live_owned_source(
    resolved_kps: list[int],
    resolved_carriers: list[int],
    expected: bool,
) -> None:
    def fetch(sql: str, args: tuple[Any, ...]) -> list[dict[str, int]]:
        if "FROM atlas_knowledge_points" in sql:
            assert args == ([7, 8], 9)
            assert "deleted = FALSE" in sql
            assert "author_id = $2" in sql
            assert "archived = FALSE" in sql
            assert "status <> 'archived'" in sql
            return [{"id": value} for value in resolved_kps]
        if "FROM atlas_carriers" in sql:
            assert args == ([3, 4], 9)
            assert "deleted = FALSE" in sql
            assert "owner_id = $2" in sql
            assert "status" not in sql
            return [{"id": value} for value in resolved_carriers]
        raise AssertionError(f"unexpected selected Atlas source SQL: {sql}")

    available = await selected_atlas_sources_available(
        FakePool(FakeConn(fetch=fetch)),
        user_id=9,
        kp_ids=[7, 7, 8],
        carrier_ids=[3, 3, 4],
    )

    assert available is expected


@pytest.mark.parametrize(
    (
        "embedding_status",
        "fingerprint_kind",
        "embedding_profile_id",
        "has_indexed_chunks",
        "expected",
    ),
    [
        ("INDEXED", "current", 42, True, True),
        ("PENDING", "current", 42, True, False),
        ("FAILED", "current", 42, True, False),
        ("INDEXED", "stale", 42, True, False),
        ("INDEXED", "current", 41, True, False),
        ("INDEXED", "current", 42, False, False),
        ("SKIPPED", "current", 42, False, True),
    ],
)
@pytest.mark.asyncio
async def test_selected_atlas_sources_available_requires_current_note_revision(
    embedding_status: str,
    fingerprint_kind: str,
    embedding_profile_id: int,
    has_indexed_chunks: bool,
    expected: bool,
) -> None:
    profile = _profile()
    note = {
        "id": 11,
        "title": "Current title",
        "summary": "Current summary",
        "content_markdown": "Current body",
    }
    current_fingerprint = _note_fingerprint(_build_note_embedding_text(note))

    def fetchrow(sql: str, _args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "search.active_profile_code" in sql:
            return {"setting_value": profile.code}
        if "FROM search_profiles WHERE code" in sql:
            return profile.__dict__
        raise AssertionError(f"unexpected selected Atlas fetchrow SQL: {sql}")

    def fetch(sql: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
        if "FROM atlas_carriers" in sql:
            assert args == ([3], 9)
            return [{"id": 3, "type": "markdown", "source_uri": "notes://11"}]
        if "FROM notes n" in sql:
            assert args == ([11], 42, profile.model_id, 9)
            assert "ne.profile_id = $2" in sql
            assert "ne.model_id = $3" in sql
            assert "ne.status = 'INDEXED'" in sql
            assert "ne.embedding IS NOT NULL" in sql
            return [
                {
                    **note,
                    "embedding_status": embedding_status,
                    "embedding_fingerprint": (
                        current_fingerprint if fingerprint_kind == "current" else "stale-fingerprint"
                    ),
                    "embedding_profile_id": embedding_profile_id,
                    "indexed_dims": [1536] if has_indexed_chunks else [],
                }
            ]
        raise AssertionError(f"unexpected selected Atlas fetch SQL: {sql}")

    available = await selected_atlas_sources_available(
        FakePool(FakeConn(fetch=fetch, fetchrow=fetchrow)),
        llm=FakeEmbedLLM(),
        user_id=9,
        kp_ids=[],
        carrier_ids=[3],
    )

    assert available is expected


@pytest.mark.parametrize("source_uri", ["notes://abc", "notes://0", "markdown://11"])
@pytest.mark.asyncio
async def test_selected_atlas_sources_available_rejects_unmapped_markdown_carrier(
    source_uri: str,
) -> None:
    def fetch(sql: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
        if "FROM atlas_carriers" in sql:
            assert args == ([3], 9)
            return [{"id": 3, "type": "markdown", "source_uri": source_uri}]
        raise AssertionError(f"unexpected selected Atlas fetch SQL: {sql}")

    available = await selected_atlas_sources_available(
        FakePool(FakeConn(fetch=fetch)),
        llm=FakeEmbedLLM(),
        user_id=9,
        kp_ids=[],
        carrier_ids=[3],
    )

    assert available is False


@pytest.mark.asyncio
async def test_upsert_knowledge_point_embedding_uses_active_profile_and_evidence() -> None:
    profile = _profile()

    def fetchrow(sql: str, args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "search.active_profile_code" in sql:
            return {"setting_value": profile.code}
        if "FROM search_profiles WHERE code" in sql:
            return profile.__dict__
        if "FROM atlas_knowledge_points kp" in sql:
            assert args == (7, 9)
            return {
                "id": 7,
                "title": "Atlas 需要证据链",
                "body_markdown": "KP 正文",
                "evidence_texts": ["原文证据 A", "原文证据 B"],
            }
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    conn = FakeConn(fetchrow=fetchrow)
    llm = FakeEmbedLLM([0.4, 0.5, 0.6])

    result = await upsert_knowledge_point_embedding(
        FakePool(conn),
        llm,
        kp_id=7,
        user_id=9,
    )

    assert result is not None
    assert result.kp_id == 7
    assert result.profile_id == 42
    assert result.embedding_dim == 3
    assert llm.calls == [
        (
            "Title: Atlas 需要证据链\n\nBody:\nKP 正文\n\nEvidence:\n- 原文证据 A\n- 原文证据 B",
            {
                "user_id": 9,
                "embedding_model_id": "text-embedding-3-small",
                "strict_embedding_model_id": True,
            },
        )
    ]
    assert len(conn.execute_calls) == 1
    sql, args = conn.execute_calls[0]
    assert "UPDATE atlas_knowledge_points" in sql
    assert "embedding_profile_id" in sql
    assert "updated_at" not in sql
    assert args == ([0.4, 0.5, 0.6], 3, 42, "text-embedding-3-small", 7, 9)


@pytest.mark.asyncio
async def test_upsert_knowledge_point_embedding_uses_selector_quote_when_body_text_empty() -> None:
    profile = _profile()

    def fetchrow(sql: str, args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "search.active_profile_code" in sql:
            return {"setting_value": profile.code}
        if "FROM search_profiles WHERE code" in sql:
            return profile.__dict__
        if "FROM atlas_knowledge_points kp" in sql:
            assert args == (7, 9)
            assert "jsonb_array_elements(a.selectors)" in sql
            assert "TextQuoteSelector" in sql
            return {
                "id": 7,
                "title": "Atlas 需要 selector 证据",
                "body_markdown": "KP 正文",
                "evidence_texts": ["selector exact quote"],
            }
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    conn = FakeConn(fetchrow=fetchrow)
    llm = FakeEmbedLLM([0.4, 0.5, 0.6])

    result = await upsert_knowledge_point_embedding(
        FakePool(conn),
        llm,
        kp_id=7,
        user_id=9,
    )

    assert result is not None
    assert "Evidence:\n- selector exact quote" in llm.calls[0][0]


@pytest.mark.asyncio
async def test_recall_atlas_context_uses_semantic_profile_filter_and_graph_neighborhood() -> None:
    profile = _profile(model_id="text-embedding-3-large")
    semantic_embedding = [0.05] * 3072

    def fetchrow(sql: str, _args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "search.active_profile_code" in sql:
            return {"setting_value": profile.code}
        if "FROM search_profiles WHERE code" in sql:
            return profile.__dict__
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    def fetch(sql: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
        if "FROM atlas_annotation_kp_links l" in sql and "a.carrier_id = ANY" in sql:
            return [{"kp_id": 7}]
        if "notes://" in sql and "FROM atlas_carriers c" in sql:
            assert args == ([3], 9)
            return []
        if "embedding::halfvec(3072)" in sql:
            assert args[0] == semantic_embedding
            assert args[1] == 42
            assert args[2] == 3072
            assert args[5] == 9
            assert "archived = FALSE" in sql
            assert "status <> 'archived'" in sql
            return [
                {
                    "id": 8,
                    "title": "语义召回命中",
                    "body_markdown": "相关正文",
                    "type": "claim",
                    "status": "evergreen",
                    "confidence": 0.86,
                    "provenance": "user",
                    "similarity": 0.77,
                    "recall_source": "semantic",
                }
            ]
        if "id = ANY($1::bigint[])" in sql and "FROM atlas_knowledge_points" in sql:
            assert set(args[0]) == {7}
            assert "archived = FALSE" in sql
            assert "status <> 'archived'" in sql
            return [
                {
                    "id": 7,
                    "title": "手动选择 KP",
                    "body_markdown": "选中正文",
                    "type": "concept",
                    "status": "growing",
                    "confidence": 0.72,
                    "provenance": "user",
                    "similarity": None,
                    "recall_source": "selected",
                }
            ]
        if "WITH RECURSIVE relation_walk" in sql:
            assert set(args[0]) == {7, 8}
            assert args[2] == 2
            return [
                {
                    "id": 101,
                    "from_kp_id": 7,
                    "to_kp_id": 8,
                    "type": "supports",
                    "strength": 0.91,
                    "body_markdown": "关系说明",
                    "depth": 1,
                }
            ]
        if "JOIN atlas_annotations a" in sql and "l.kp_id = ANY" in sql:
            assert set(args[0]) == {7, 8}
            return [
                {
                    "kp_id": 8,
                    "role": "evidence",
                    "annotation_id": 501,
                    "body_text": "原文证据",
                    "anchor_state": "anchored",
                    "carrier_title": "载体标题",
                    "source_uri": "note://1",
                }
            ]
        raise AssertionError(f"unexpected fetch SQL: {sql}")

    conn = FakeConn(fetchrow=fetchrow, fetch=fetch)
    llm = FakeEmbedLLM(semantic_embedding)

    context = await recall_atlas_context(
        FakePool(conn),
        llm,
        user_id=9,
        query="证据链如何影响 Atlas 召回？",
        kp_ids=[7],
        carrier_ids=[3],
        semantic_limit=4,
        neighborhood_depth=2,
        include_evidence=True,
    )

    assert [kp.id for kp in context.knowledge_points] == [7, 8]
    assert context.knowledge_points[0].recall_source == "selected"
    assert context.knowledge_points[1].recall_source == "semantic"
    assert context.knowledge_points[1].similarity == pytest.approx(0.77)
    assert context.relations[0].depth == 1
    assert context.evidence[0].annotation_id == 501
    assert llm.calls[0][1]["embedding_model_id"] == "text-embedding-3-large"


@pytest.mark.asyncio
async def test_recall_atlas_context_evidence_uses_selector_quote_when_body_text_empty() -> None:
    def fetch(sql: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
        if "id = ANY($1::bigint[])" in sql and "FROM atlas_knowledge_points" in sql:
            assert args == ([8], 9, "selected")
            return [
                {
                    "id": 8,
                    "title": "手动选择 KP",
                    "body_markdown": "选中正文",
                    "type": "claim",
                    "status": "evergreen",
                    "confidence": 0.86,
                    "provenance": "user",
                    "similarity": None,
                    "recall_source": "selected",
                }
            ]
        if "WITH RECURSIVE relation_walk" in sql:
            return []
        if "JOIN atlas_annotations a" in sql and "l.kp_id = ANY" in sql:
            assert args == ([8], 9)
            assert "jsonb_array_elements(a.selectors)" in sql
            assert "TextQuoteSelector" in sql
            return [
                {
                    "kp_id": 8,
                    "role": "evidence",
                    "annotation_id": 501,
                    "body_text": "selector exact quote",
                    "anchor_state": "anchored",
                    "carrier_title": "载体标题",
                    "source_uri": "note://1",
                }
            ]
        raise AssertionError(f"unexpected fetch SQL: {sql}")

    conn = FakeConn(fetch=fetch)
    llm = FakeEmbedLLM()

    context = await recall_atlas_context(
        FakePool(conn),
        llm,
        user_id=9,
        query="",
        kp_ids=[8],
        semantic_limit=0,
        neighborhood_depth=1,
        include_evidence=True,
    )

    assert context.evidence[0].body_text == "selector exact quote"


@pytest.mark.asyncio
async def test_recall_atlas_context_user_scope_rejects_unowned_null_rows() -> None:
    seen: set[str] = set()

    def assert_no_null_owner_bypass(sql: str) -> None:
        assert "OR author_id IS NULL" not in sql
        assert "OR a.author_id IS NULL" not in sql
        assert "OR c.owner_id IS NULL" not in sql
        assert "OR r.author_id IS NULL" not in sql

    def fetch(sql: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
        assert_no_null_owner_bypass(sql)
        if "FROM atlas_annotation_kp_links l" in sql and "a.carrier_id = ANY" in sql:
            seen.add("carrier_kps")
            assert args == ([3], 9)
            return []
        if "notes://" in sql and "FROM atlas_carriers c" in sql:
            seen.add("carrier_notes")
            assert args == ([3], 9)
            return []
        if "id = ANY($1::bigint[])" in sql and "FROM atlas_knowledge_points" in sql:
            seen.add("selected_kps")
            assert args == ([8], 9, "selected")
            return [
                {
                    "id": 8,
                    "title": "Scoped KP",
                    "body_markdown": "Only the owner can inject this row",
                    "type": "claim",
                    "status": "evergreen",
                    "confidence": 0.86,
                    "provenance": "user",
                    "similarity": None,
                    "recall_source": "selected",
                }
            ]
        if "WITH RECURSIVE relation_walk" in sql:
            seen.add("relations")
            assert args == ([8], 9, 1)
            return []
        if "JOIN atlas_annotations a" in sql and "l.kp_id = ANY" in sql:
            seen.add("evidence")
            assert args == ([8], 9)
            return []
        raise AssertionError(f"unexpected fetch SQL: {sql}")

    context = await recall_atlas_context(
        FakePool(FakeConn(fetch=fetch)),
        None,
        user_id=9,
        query="",
        kp_ids=[8],
        carrier_ids=[3],
        semantic_limit=0,
        neighborhood_depth=1,
        include_evidence=True,
    )

    assert [kp.id for kp in context.knowledge_points] == [8]
    assert seen == {"carrier_kps", "carrier_notes", "selected_kps", "relations", "evidence"}


def test_render_atlas_context_includes_recall_source_relations_and_evidence() -> None:
    context = AtlasRecallContext(
        knowledge_points=[
            {
                "id": 8,
                "title": "语义召回命中",
                "body_markdown": "相关正文",
                "type": "claim",
                "status": "evergreen",
                "confidence": 0.86,
                "provenance": "user",
                "similarity": 0.77,
                "recall_source": "semantic",
            }
        ],
        relations=[
            {
                "id": 101,
                "from_kp_id": 7,
                "to_kp_id": 8,
                "type": "supports",
                "strength": 0.91,
                "body_markdown": "关系说明",
                "depth": 1,
            }
        ],
        evidence=[
            {
                "kp_id": 8,
                "role": "evidence",
                "annotation_id": 501,
                "body_text": "原文证据",
                "anchor_state": "anchored",
                "carrier_title": "载体标题",
                "source_uri": "note://1",
            }
        ],
    )

    rendered = render_atlas_context(context)

    assert rendered is not None
    assert "# Aether Atlas Context" in rendered
    assert "[KP #8] 语义召回命中" in rendered
    assert "recall=semantic" in rendered
    assert "score=0.77" in rendered
    assert "[Relation #101] KP #7 --supports" in rendered
    assert "[Evidence #501] for [KP #8]" in rendered


@pytest.mark.asyncio
async def test_recall_atlas_context_recalls_note_chunks_for_markdown_carriers() -> None:
    profile = _profile()
    embedding = [0.2, 0.3, 0.4]
    note = {
        "id": 11,
        "title": "Carrier note",
        "summary": None,
        "content_markdown": "Markdown carrier chunk",
    }
    fingerprint = _note_fingerprint(_build_note_embedding_text(note))

    def fetchrow(sql: str, _args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "search.active_profile_code" in sql:
            return {"setting_value": profile.code}
        if "FROM search_profiles WHERE code" in sql:
            return profile.__dict__
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    def fetch(sql: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
        if "FROM atlas_annotation_kp_links l" in sql and "a.carrier_id = ANY" in sql:
            return []
        if "notes://" in sql and "FROM atlas_carriers c" in sql:
            assert args == ([3], 9)
            return [{"note_id": 11}]
        if "FROM notes n" in sql:
            assert args == ([11], 42, profile.model_id, 9)
            return [
                {
                    **note,
                    "embedding_status": "INDEXED",
                    "embedding_fingerprint": fingerprint,
                    "embedding_profile_id": 42,
                    "indexed_dims": [3],
                }
            ]
        if "FROM atlas_knowledge_points" in sql and "embedding::vector(3)" in sql:
            return []
        if "FROM note_embeddings ne" in sql and "embedding::vector(3)" in sql:
            assert args[0] == embedding
            assert args[1] == 42
            assert args[2] == 3
            assert args[5] == 9
            assert args[7] == [11]
            assert args[8] == profile.model_id
            assert args[9] == [fingerprint]
            assert "n.embedding_status = 'INDEXED'" in sql
            assert "n.embedding_profile_id = $2" in sql
            assert "ne.model_id = $9" in sql
            assert "unnest($8::bigint[], $10::text[])" in sql
            assert "n.embedding_fingerprint = expected.fingerprint" in sql
            assert "c.type = 'markdown'" in sql
            assert "c.owner_id = $6" in sql
            return [
                {
                    "note_id": 11,
                    "title": "Carrier note",
                    "chunk_index": 0,
                    "chunk_text": "Markdown carrier chunk",
                    "similarity": 0.88,
                    "source_uri": "notes://11",
                }
            ]
        raise AssertionError(f"unexpected fetch SQL: {sql}")

    conn = FakeConn(fetchrow=fetchrow, fetch=fetch)
    llm = FakeEmbedLLM(embedding)

    context = await recall_atlas_context(
        FakePool(conn),
        llm,
        user_id=9,
        query="carrier chunk question",
        carrier_ids=[3],
        semantic_limit=3,
        neighborhood_depth=1,
        include_evidence=True,
    )

    assert context.knowledge_points == []
    assert len(context.note_hits) == 1
    assert context.note_hits[0].note_id == 11
    assert context.note_hits[0].similarity == pytest.approx(0.88)

    rendered = render_atlas_context(context)
    assert rendered is not None
    assert "## Note Carrier Chunks" in rendered
    assert "[Note #11 chunk 0] Carrier note" in rendered
    assert "score=0.88" in rendered


@pytest.mark.parametrize(
    ("embedding_status", "fingerprint_kind", "embedding_profile_id", "has_chunks"),
    [
        ("PENDING", "current", 42, True),
        ("FAILED", "current", 42, True),
        ("INDEXED", "stale", 42, True),
        ("INDEXED", "current", 41, True),
        ("INDEXED", "current", 42, False),
    ],
)
@pytest.mark.asyncio
async def test_recall_atlas_context_filters_non_current_note_revisions_in_auto_mode(
    embedding_status: str,
    fingerprint_kind: str,
    embedding_profile_id: int,
    has_chunks: bool,
) -> None:
    profile = _profile()
    note = {
        "id": 11,
        "title": "Edited title",
        "summary": None,
        "content_markdown": "Current body",
    }
    current_fingerprint = _note_fingerprint(_build_note_embedding_text(note))

    def fetchrow(sql: str, _args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "search.active_profile_code" in sql:
            return {"setting_value": profile.code}
        if "FROM search_profiles WHERE code" in sql:
            return profile.__dict__
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    def fetch(sql: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
        if "FROM atlas_annotation_kp_links l" in sql and "a.carrier_id = ANY" in sql:
            return []
        if "notes://" in sql and "FROM atlas_carriers c" in sql:
            assert args == ([3], 9)
            return [{"note_id": 11}]
        if "FROM notes n" in sql:
            return [
                {
                    **note,
                    "embedding_status": embedding_status,
                    "embedding_fingerprint": (
                        current_fingerprint if fingerprint_kind == "current" else "stale-fingerprint"
                    ),
                    "embedding_profile_id": embedding_profile_id,
                    "indexed_dims": [3] if has_chunks else [],
                }
            ]
        if "FROM note_embeddings ne" in sql:
            raise AssertionError("a non-current note revision must not reach semantic note recall")
        raise AssertionError(f"unexpected fetch SQL: {sql}")

    llm = FakeEmbedLLM([0.2, 0.3, 0.4])
    context = await recall_atlas_context(
        FakePool(FakeConn(fetchrow=fetchrow, fetch=fetch)),
        llm,
        user_id=9,
        query="must not recall old chunks",
        carrier_ids=[3],
        semantic_limit=0,
        neighborhood_depth=0,
        include_evidence=False,
    )

    assert context.note_hits == []
    assert llm.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("failure_mode", "indexed_dims", "expected_error"),
    [
        ("provider", [3], "embedding provider unavailable"),
        ("dimension", [4], "embedding dimension is not current"),
    ],
)
async def test_recall_atlas_context_strict_note_source_propagates_embedding_failure(
    failure_mode: str,
    indexed_dims: list[int],
    expected_error: str,
) -> None:
    profile = _profile()
    note = {
        "id": 11,
        "title": "Current note",
        "summary": None,
        "content_markdown": "Current body",
    }
    fingerprint = _note_fingerprint(_build_note_embedding_text(note))

    class FailingEmbedLLM(FakeEmbedLLM):
        async def embed(self, text: str, **kwargs: Any) -> list[float]:
            self.calls.append((text, kwargs))
            if failure_mode == "provider":
                raise RuntimeError("embedding provider unavailable")
            return [0.1, 0.2, 0.3]

    def fetchrow(sql: str, _args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "search.active_profile_code" in sql:
            return {"setting_value": profile.code}
        if "FROM search_profiles WHERE code" in sql:
            return profile.__dict__
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    def fetch(sql: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
        if "FROM atlas_annotation_kp_links l" in sql and "a.carrier_id = ANY" in sql:
            return []
        if "notes://" in sql and "FROM atlas_carriers c" in sql:
            return [{"note_id": 11}]
        if "FROM atlas_knowledge_points" in sql and "id = ANY" in sql:
            return [
                {
                    "id": 7,
                    "title": "Other selected KP",
                    "body_markdown": "Must not mask note retrieval failure.",
                    "type": "claim",
                    "status": "evergreen",
                    "confidence": 0.9,
                    "provenance": "user",
                    "similarity": None,
                    "recall_source": "selected",
                }
            ]
        if "FROM notes n" in sql:
            return [
                {
                    **note,
                    "embedding_status": "INDEXED",
                    "embedding_fingerprint": fingerprint,
                    "embedding_profile_id": 42,
                    "indexed_dims": indexed_dims,
                }
            ]
        raise AssertionError(f"unexpected fetch SQL: {sql}; args={args}")

    with pytest.raises(RuntimeError, match=expected_error):
        await recall_atlas_context(
            FakePool(FakeConn(fetchrow=fetchrow, fetch=fetch)),
            FailingEmbedLLM(),
            user_id=9,
            query="strict selected note question",
            kp_ids=[7],
            carrier_ids=[3],
            semantic_limit=0,
            neighborhood_depth=0,
            include_evidence=False,
            strict=True,
        )
