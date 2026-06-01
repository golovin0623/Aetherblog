from __future__ import annotations

import base64
from typing import Any

import pytest
from fastapi import HTTPException

from app.api.routes import atlas
from app.services.atlas_recall import AtlasEmbeddingUpdate, AtlasKnowledgePointHit, AtlasRecallContext
from app.services.vector_store import SearchProfile
from tests.support import FakeConn, FakePool


class FakeAtlasLlm:
    def __init__(self, responses: list[str], *, chat_error: Exception | None = None) -> None:
        self.responses = responses
        self.chat_error = chat_error
        self.chat_calls: list[dict[str, Any]] = []
        self.routing_calls: list[dict[str, Any]] = []

    async def has_task_routing(self, *_args: Any, **_kwargs: Any) -> bool:
        self.routing_calls.append({"args": _args, "kwargs": _kwargs})
        return True

    async def resolve_usage_context(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {
            "model": "fake/atlas-model",
            "provider_code": "fake",
            "model_id": "atlas-model",
            "input_cost_per_1m": 1.0,
            "output_cost_per_1m": 2.0,
            "cached_input_cost_per_1m": 0.5,
        }

    async def chat(self, **kwargs: Any) -> str:
        self.chat_calls.append(kwargs)
        if self.chat_error is not None:
            raise self.chat_error
        idx = min(len(self.chat_calls) - 1, len(self.responses) - 1)
        return self.responses[idx]


def test_atlas_router_uses_api_v1_prefix() -> None:
    assert atlas.router.prefix == "/api/v1/atlas"


@pytest.mark.asyncio
async def test_extract_claims_llm_retries_until_valid_json() -> None:
    llm = FakeAtlasLlm(
        [
            "not json",
            '{"candidates":[{"title":"Atlas 应保持证据链","body":"Atlas 的 KP 必须能回到原始 evidence。","type":"claim","confidence":0.82,"rationale":"文本直接陈述"}]}',
        ]
    )

    result = await atlas._extract_claims_with_structured_llm(
        atlas.ExtractClaimsRequest(
            carrier_id=7,
            text="Atlas 的 KP 必须能回到原始 evidence，关系也必须能解释来源。",
            max_candidates=3,
        ),
        llm=llm,
        user_id=12,
    )

    assert result is not None
    candidates, model_id, attempts = result
    assert attempts == 2
    assert model_id == "atlas-model"
    assert candidates[0].proposed_title == "Atlas 应保持证据链"
    assert candidates[0].proposed_kp_type == "claim"
    assert candidates[0].proposed_confidence == pytest.approx(0.82)
    assert candidates[0].tokens_in > atlas.estimate_tokens("Atlas 的 KP 必须能回到原始 evidence，关系也必须能解释来源。")
    assert len(llm.chat_calls) == 2


@pytest.mark.asyncio
async def test_preview_claim_extraction_estimates_cost_and_budget() -> None:
    llm = FakeAtlasLlm([])

    result = await atlas.preview_claim_extraction(
        atlas.ClaimExtractionCostPreviewRequest(
            text="Atlas root text keeps grounded evidence, cost preview, and budget guard visible.",
            max_candidates=2,
            max_cost_usd=0.000001,
        ),
        llm=llm,
    )

    assert result.model_id == "atlas-model"
    assert result.estimated_tokens_in > 0
    assert result.estimated_tokens_out == 192
    assert result.estimated_cost_usd is not None
    assert result.budget_exceeded is True
    assert result.pricing_missing is False


@pytest.mark.asyncio
async def test_extract_claims_passes_cost_budget_to_llm() -> None:
    llm = FakeAtlasLlm(
        [
            '{"candidates":[{"title":"Atlas keeps costs bounded","body":"Atlas extraction should honor the caller budget.","type":"claim","confidence":0.8,"rationale":"grounded"}]}',
        ]
    )

    result = await atlas._extract_claims_with_structured_llm(
        atlas.ExtractClaimsRequest(
            carrier_id=7,
            text="Atlas extraction should honor the caller budget and keep costs bounded.",
            max_candidates=3,
            max_cost_usd=0.0005,
        ),
        llm=llm,
        user_id=12,
    )

    assert result is not None
    assert llm.chat_calls[0]["max_cost_usd"] == pytest.approx(0.0005)


@pytest.mark.asyncio
async def test_extract_claims_endpoint_uses_request_user_id_for_routing() -> None:
    llm = FakeAtlasLlm(
        [
            '{"candidates":[{"title":"Atlas follows user routing","body":"The structured model should resolve with the caller user id.","type":"claim","confidence":0.8,"rationale":"grounded"}]}',
        ]
    )

    result = await atlas.extract_claims(
        atlas.ExtractClaimsRequest(
            carrier_id=7,
            text="The structured model should resolve with the caller user id.",
            max_candidates=3,
            user_id=42,
        ),
        llm=llm,
    )

    assert result.structured is True
    assert llm.routing_calls[0]["args"] == ("atlas_claims", 42)
    assert llm.chat_calls[0]["user_id"] == 42


@pytest.mark.asyncio
async def test_extract_claims_budget_error_does_not_fallback() -> None:
    llm = FakeAtlasLlm([], chat_error=ValueError("budget exceeded: maxCostUsd"))

    with pytest.raises(HTTPException) as exc:
        await atlas._extract_claims_with_structured_llm(
            atlas.ExtractClaimsRequest(
                carrier_id=7,
                text="Atlas extraction should stop when the configured cost budget is exceeded.",
                max_candidates=3,
                max_cost_usd=0.000001,
            ),
            llm=llm,
            user_id=12,
        )

    assert exc.value.status_code == 402


@pytest.mark.asyncio
async def test_suggest_relation_llm_rejects_invalid_relation_type_then_repairs() -> None:
    llm = FakeAtlasLlm(
        [
            '{"relation_type":"depends_on","strength":0.7,"rationale":"bad type"}',
            '{"relation_type":"supports","strength":0.76,"rationale":"A 为 B 提供证据"}',
        ]
    )

    result = await atlas._suggest_relation_with_structured_llm(
        atlas.SuggestRelationRequest(
            from_kp_id=1,
            to_kp_id=2,
            from_text="R1 锚定召回率要达到 90%",
            to_text="Reader 高亮依赖稳定锚定",
        ),
        llm=llm,
        user_id=12,
    )

    assert result is not None
    suggestion, model_id, attempts = result
    assert attempts == 2
    assert model_id == "atlas-model"
    assert suggestion.relation_type == "supports"
    assert suggestion.strength == pytest.approx(0.76)


@pytest.mark.asyncio
async def test_suggest_relation_endpoint_uses_request_user_id_for_routing() -> None:
    llm = FakeAtlasLlm(
        [
            '{"relation_type":"supports","strength":0.76,"rationale":"A 为 B 提供证据"}',
        ]
    )

    result = await atlas.suggest_relation(
        atlas.SuggestRelationRequest(
            from_kp_id=1,
            to_kp_id=2,
            from_text="R1 锚定召回率要达到 90%",
            to_text="Reader 高亮依赖稳定锚定",
            user_id=42,
        ),
        llm=llm,
    )

    assert result.structured is True
    assert llm.routing_calls[0]["args"] == ("atlas_relations", 42)
    assert llm.chat_calls[0]["user_id"] == 42


@pytest.mark.asyncio
async def test_extract_pdf_text_returns_page_offsets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        atlas,
        "extract_pdf_text_pages",
        lambda _content: ["第一页内容", "", "第三页结论"],
    )

    result = await atlas.extract_pdf_text(
        atlas.ExtractPDFTextRequest(
            filename="atlas.pdf",
            mime_type="application/pdf",
            content_bytes=base64.b64encode(b"%PDF fake").decode("ascii"),
        )
    )

    assert result.page_count == 3
    assert result.char_count == len("第一页内容\n\n\n\n第三页结论")
    assert result.pages[0].char_start == 0
    assert result.pages[0].char_end == len("第一页内容")
    assert result.pages[1].char_start == len("第一页内容\n\n")
    assert result.pages[1].char_end == result.pages[1].char_start
    assert result.pages[2].text == "第三页结论"
    assert len(result.text_hash) == 64


def test_build_pdf_text_layer_uses_utf16_offsets_for_browser_reader() -> None:
    result = atlas._build_pdf_text_layer(["a🙂b", "tail"])

    assert result.text == "a🙂b\n\ntail"
    assert result.char_count == 10
    assert result.pages[0].char_start == 0
    assert result.pages[0].char_end == 4
    assert result.pages[1].char_start == 6
    assert result.pages[1].char_end == 10


@pytest.mark.asyncio
async def test_extract_pdf_text_rejects_invalid_base64() -> None:
    with pytest.raises(HTTPException) as exc:
        await atlas.extract_pdf_text(
            atlas.ExtractPDFTextRequest(
                filename="atlas.pdf",
                mime_type="application/pdf",
                content_bytes="not-base64!!!",
            )
        )

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_extract_pdf_text_rejects_oversized_base64_before_decoding(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(atlas, "MAX_ATLAS_PDF_EXTRACT_BYTES", 3)
    decoded = False

    def fake_b64decode(*_args: Any, **_kwargs: Any) -> bytes:
        nonlocal decoded
        decoded = True
        return b""

    monkeypatch.setattr(atlas.base64, "b64decode", fake_b64decode)

    with pytest.raises(HTTPException) as exc:
        await atlas.extract_pdf_text(
            atlas.ExtractPDFTextRequest(
                filename="atlas.pdf",
                mime_type="application/pdf",
                content_bytes="AAAAAA",
            )
        )

    assert exc.value.status_code == 413
    assert decoded is False


@pytest.mark.asyncio
async def test_index_knowledge_point_delegates_to_atlas_recall_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}
    pool = object()
    llm = object()

    async def fake_upsert(pool_arg: Any, llm_arg: Any, **kwargs: Any) -> AtlasEmbeddingUpdate:
        captured["pool"] = pool_arg
        captured["llm"] = llm_arg
        captured.update(kwargs)
        return AtlasEmbeddingUpdate(
            kp_id=7,
            profile_id=42,
            model_id="text-embedding-3-small",
            embedding_dim=1536,
        )

    monkeypatch.setattr(atlas, "upsert_knowledge_point_embedding", fake_upsert)

    result = await atlas.index_knowledge_point(
        7,
        atlas.IndexKnowledgePointRequest(user_id=9),
        llm=llm,
        pool=pool,
    )

    assert captured == {
        "pool": pool,
        "llm": llm,
        "kp_id": 7,
        "user_id": 9,
    }
    assert result.kp_id == 7
    assert result.profile_id == 42
    assert result.embedding_dim == 1536


@pytest.mark.asyncio
async def test_semantic_search_delegates_to_atlas_recall_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def fake_recall(pool: Any, llm: Any, **kwargs: Any) -> AtlasRecallContext:
        captured["pool"] = pool
        captured["llm"] = llm
        captured.update(kwargs)
        return AtlasRecallContext(
            knowledge_points=[
                AtlasKnowledgePointHit(
                    id=8,
                    title="Semantic KP",
                    body_markdown="semantic body",
                    type="claim",
                    status="evergreen",
                    confidence=0.86,
                    provenance="user",
                    similarity=0.77,
                    recall_source="semantic",
                )
            ]
        )

    monkeypatch.setattr(atlas, "recall_atlas_context", fake_recall)
    pool = object()
    llm = object()

    result = await atlas.semantic_search(
        atlas.AtlasSemanticSearchRequest(query=" evidence graph ", user_id=9, limit=3),
        llm=llm,
        pool=pool,
    )

    assert captured == {
        "pool": pool,
        "llm": llm,
        "user_id": 9,
        "query": "evidence graph",
        "kp_ids": [],
        "carrier_ids": [],
        "semantic_limit": 3,
        "neighborhood_depth": 0,
        "include_evidence": False,
    }
    assert result.query == "evidence graph"
    assert result.limit == 3
    assert result.knowledge_points[0].id == 8
    assert result.knowledge_points[0].similarity == pytest.approx(0.77)


@pytest.mark.asyncio
async def test_reindex_knowledge_points_indexes_stale_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = SearchProfile(
        id=42,
        code="active-search",
        name="Active search",
        description=None,
        model_id="text-embedding-3-small",
        chunker_kind="recursive",
        chunk_size_tokens=512,
        chunk_overlap_tokens=64,
        status="active",
    )

    class FakeVectorStoreService:
        def __init__(self, pool: Any, llm: Any) -> None:
            self.pool = pool
            self.llm = llm

        async def get_active_profile(self) -> SearchProfile:
            return profile

    def fetch(sql: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
        assert "FROM atlas_knowledge_points kp" in sql
        assert "embedding_profile_id IS DISTINCT FROM $2" in sql
        assert args == (9, 42, "text-embedding-3-small", True, 2)
        return [{"id": 7}, {"id": 8}]

    calls: list[dict[str, Any]] = []

    async def fake_upsert(pool_arg: Any, llm_arg: Any, **kwargs: Any) -> AtlasEmbeddingUpdate:
        calls.append({"pool": pool_arg, "llm": llm_arg, **kwargs})
        if kwargs["kp_id"] == 8:
            raise RuntimeError("embedding backend down")
        return AtlasEmbeddingUpdate(
            kp_id=kwargs["kp_id"],
            profile_id=profile.id,
            model_id=profile.model_id,
            embedding_dim=1536,
        )

    monkeypatch.setattr(atlas, "VectorStoreService", FakeVectorStoreService)
    monkeypatch.setattr(atlas, "upsert_knowledge_point_embedding", fake_upsert)
    pool = FakePool(FakeConn(fetch=fetch))
    llm = object()

    result = await atlas.reindex_knowledge_points(
        atlas.ReindexKnowledgePointsRequest(user_id=9, limit=2, stale_only=True),
        llm=llm,
        pool=pool,
    )

    assert result.profile_id == 42
    assert result.model_id == "text-embedding-3-small"
    assert result.selected_count == 2
    assert result.succeeded == 1
    assert result.failed == 1
    assert result.not_found == 0
    assert result.errors[0].id == 8
    assert calls[0]["profile"] == profile
    assert [call["kp_id"] for call in calls] == [7, 8]
