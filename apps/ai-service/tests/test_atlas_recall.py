from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest

from app.services.atlas_recall import (
    AtlasRecallContext,
    recall_atlas_context,
    render_atlas_context,
    upsert_knowledge_point_embedding,
)
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
        if "FROM atlas_knowledge_points" in sql and "embedding::vector(3)" in sql:
            return []
        if "FROM note_embeddings ne" in sql and "embedding::vector(3)" in sql:
            assert args[0] == embedding
            assert args[1] == 42
            assert args[2] == 3
            assert args[5] == 9
            assert args[7] == [11]
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
