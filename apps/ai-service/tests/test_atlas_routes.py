from __future__ import annotations

import base64
from typing import Any

import pytest
from fastapi import HTTPException

from app.api.routes import atlas


class FakeAtlasLlm:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.chat_calls: list[dict[str, Any]] = []

    async def has_task_routing(self, *_args: Any, **_kwargs: Any) -> bool:
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
        idx = min(len(self.chat_calls) - 1, len(self.responses) - 1)
        return self.responses[idx]


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
    assert len(llm.chat_calls) == 2


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
