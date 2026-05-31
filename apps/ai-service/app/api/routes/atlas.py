"""Atlas (Aether Knowledge) AI 端点 —— Phase 3 P3-01/02

落地手册: ../../docs/plan/task-aether-knowledge-system.md §3 Phase 3

Phase 3 范围（本文件）:
  - POST /v1/atlas/claims/extract   从 carrier 文本中抽取 claim 候选（→ KP 建议）
  - POST /v1/atlas/relations/suggest 给定一对 KP，建议它们之间的 typed relation

实现方式:
  - 优先通过 LlmRouter 走 structured JSON wrapper；输出必须通过 pydantic schema
    校验，失败会重试一次。
  - 未配置 Atlas task routing / 模型调用失败时，回退到关键词启发式候选，保持
    前端 + server-go accept/reject 链路可端到端跑通。
  - 红线 C3-1: 本服务**永远不直接写** atlas_knowledge_points / atlas_typed_relations
    表，所有建议必须经 server-go suggestion handler 落 atlas_ai_suggestions 表。
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_llm_router, get_pg_pool, require_admin_or_internal
from app.services.kb_indexer import extract_pdf_text_pages
from app.services.atlas_recall import AtlasKnowledgePointHit, recall_atlas_context, upsert_knowledge_point_embedding
from app.services.usage_logger import estimate_tokens
from app.services.vector_store import SearchProfile, VectorStoreService


logger = logging.getLogger("atlas")
# PR #724 review fix (Codex P1): 整个 /v1/atlas/* 必须走 require_admin_or_internal,
# 与 ai-service 其他敏感 AI 路由（agent、knowledge_bases）保持一致；
# 允许：管理员 JWT 或 Go 后端的 X-Internal-Service 内部 token。
router = APIRouter(
    tags=["atlas"],
    prefix="/v1/atlas",
    dependencies=[Depends(require_admin_or_internal)],
)


# ============================================================
# Knowledge Point embedding
# ============================================================

class IndexKnowledgePointRequest(BaseModel):
    user_id: int | None = Field(default=None, ge=1)


class IndexKnowledgePointResponse(BaseModel):
    kp_id: int
    profile_id: int
    model_id: str
    embedding_dim: int


class AtlasSemanticSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    user_id: int | None = Field(default=None, ge=1)
    limit: int = Field(default=8, ge=1, le=25)


class AtlasSemanticKnowledgePoint(BaseModel):
    id: int
    title: str
    body_markdown: str
    type: str
    status: str
    confidence: float
    provenance: str
    similarity: float | None = None
    recall_source: str = "semantic"


class AtlasSemanticSearchResponse(BaseModel):
    query: str
    limit: int
    knowledge_points: list[AtlasSemanticKnowledgePoint] = Field(default_factory=list)


class ReindexKnowledgePointsRequest(BaseModel):
    user_id: int | None = Field(default=None, ge=1)
    limit: int = Field(default=100, ge=1, le=500)
    stale_only: bool = True


class ReindexEmbeddingError(BaseModel):
    id: int
    error: str


class ReindexKnowledgePointsResponse(BaseModel):
    profile_id: int
    model_id: str
    selected_count: int
    succeeded: int
    failed: int
    not_found: int
    errors: list[ReindexEmbeddingError] = Field(default_factory=list)


@router.post("/knowledge-points/index-batch")
async def reindex_knowledge_points(
    req: ReindexKnowledgePointsRequest,
    llm=Depends(get_llm_router),
    pool=Depends(get_pg_pool),
) -> ReindexKnowledgePointsResponse:
    """Backfill historical KP embeddings for the active search profile."""
    profile = await VectorStoreService(pool, llm).get_active_profile()
    kp_ids = await _fetch_kp_reindex_ids(
        pool,
        profile=profile,
        user_id=req.user_id,
        limit=req.limit,
        stale_only=req.stale_only,
    )

    succeeded = 0
    failed = 0
    not_found = 0
    errors: list[ReindexEmbeddingError] = []
    for kp_id in kp_ids:
        try:
            result = await upsert_knowledge_point_embedding(
                pool,
                llm,
                kp_id=kp_id,
                user_id=req.user_id,
                profile=profile,
            )
            if result is None:
                not_found += 1
            else:
                succeeded += 1
        except Exception as exc:
            failed += 1
            errors.append(ReindexEmbeddingError(id=kp_id, error=f"{type(exc).__name__}: {str(exc)[:300]}"))

    return ReindexKnowledgePointsResponse(
        profile_id=profile.id,
        model_id=profile.model_id,
        selected_count=len(kp_ids),
        succeeded=succeeded,
        failed=failed,
        not_found=not_found,
        errors=errors,
    )


async def _fetch_kp_reindex_ids(
    pool,
    *,
    profile: SearchProfile,
    user_id: int | None,
    limit: int,
    stale_only: bool,
) -> list[int]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT kp.id
            FROM atlas_knowledge_points kp
            WHERE kp.deleted = FALSE
              AND kp.archived = FALSE
              AND ($1::bigint IS NULL OR kp.author_id = $1 OR kp.author_id IS NULL)
              AND (
                $4::boolean = FALSE
                OR kp.embedding IS NULL
                OR kp.embedding_dim IS NULL
                OR kp.embedding_profile_id IS DISTINCT FROM $2
                OR kp.embedding_model_id IS DISTINCT FROM $3
              )
            ORDER BY kp.updated_at DESC, kp.id DESC
            LIMIT $5
            """,
            user_id,
            profile.id,
            profile.model_id,
            stale_only,
            limit,
        )
    return [int(row["id"]) for row in rows]


@router.post("/knowledge-points/{kp_id}/index")
async def index_knowledge_point(
    kp_id: int,
    req: IndexKnowledgePointRequest,
    llm=Depends(get_llm_router),
    pool=Depends(get_pg_pool),
) -> IndexKnowledgePointResponse:
    if kp_id <= 0:
        raise HTTPException(status_code=400, detail="kp_id 必须为正整数")
    result = await upsert_knowledge_point_embedding(
        pool,
        llm,
        kp_id=kp_id,
        user_id=req.user_id,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Knowledge Point 不存在或无权索引")
    return IndexKnowledgePointResponse(
        kp_id=result.kp_id,
        profile_id=result.profile_id,
        model_id=result.model_id,
        embedding_dim=result.embedding_dim,
    )


@router.post("/search/semantic")
async def semantic_search(
    req: AtlasSemanticSearchRequest,
    llm=Depends(get_llm_router),
    pool=Depends(get_pg_pool),
) -> AtlasSemanticSearchResponse:
    """Return Atlas KP semantic hits for server-go search reranking."""
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="query 不能为空")

    context = await recall_atlas_context(
        pool,
        llm,
        user_id=req.user_id,
        query=query,
        kp_ids=[],
        carrier_ids=[],
        semantic_limit=req.limit,
        neighborhood_depth=0,
        include_evidence=False,
    )
    hits = [
        _semantic_kp_response(hit)
        for hit in context.knowledge_points
    ]
    return AtlasSemanticSearchResponse(query=query, limit=req.limit, knowledge_points=hits)


def _semantic_kp_response(hit: AtlasKnowledgePointHit) -> AtlasSemanticKnowledgePoint:
    return AtlasSemanticKnowledgePoint(
        id=hit.id,
        title=hit.title,
        body_markdown=hit.body_markdown,
        type=hit.type,
        status=hit.status,
        confidence=hit.confidence,
        provenance=hit.provenance,
        similarity=hit.similarity,
        recall_source=hit.recall_source,
    )


# ============================================================
# PDF text-layer extraction
# ============================================================

MAX_ATLAS_PDF_EXTRACT_BYTES = 20 * 1024 * 1024


class ExtractPDFTextRequest(BaseModel):
    """Go 后端推送的 PDF 原始字节，用于 Atlas PDF carrier ingest。"""

    filename: Optional[str] = Field(default=None, max_length=255)
    mime_type: Optional[str] = Field(default=None, max_length=128)
    content_bytes: str = Field(default="", description="原始 PDF 字节的 base64 编码")


class PDFTextPage(BaseModel):
    page: int
    text: str = ""
    char_start: int
    char_end: int


class PDFTextLayerResponse(BaseModel):
    text: str
    text_hash: str
    page_count: int
    char_count: int
    pages: list[PDFTextPage]
    extractor: str = "pypdf"


@router.post("/pdf/extract")
async def extract_pdf_text(req: ExtractPDFTextRequest) -> PDFTextLayerResponse:
    """从 PDF 字节流抽取 Atlas 可锚定的逐页文本层。

    该端点只允许 admin JWT 或 Go 后端内部 token 访问（router 级依赖），并且不做
    反向 URL 拉取，避免 SSRF；Go 端负责从受控媒体存储读取字节后推送进来。
    """
    try:
        content = base64.b64decode(req.content_bytes or "", validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"content_bytes base64 解码失败: {exc}")

    if len(content) > MAX_ATLAS_PDF_EXTRACT_BYTES:
        raise HTTPException(status_code=413, detail="PDF 过大，Atlas 文本抽取上限 20MB")

    mime = (req.mime_type or "").lower().split(";", 1)[0].strip()
    filename = (req.filename or "").lower()
    if mime and mime != "application/pdf" and not filename.endswith(".pdf"):
        raise HTTPException(status_code=415, detail=f"不支持的 PDF MIME: {req.mime_type!r}")

    try:
        page_texts = extract_pdf_text_pages(content)
    except Exception as exc:
        logger.warning("atlas.pdf_extract_failed", extra={"data": {"error": str(exc)[:300]}})
        raise HTTPException(status_code=422, detail=f"PDF 文本抽取失败: {exc}")

    return _build_pdf_text_layer(page_texts)


def _build_pdf_text_layer(page_texts: list[str]) -> PDFTextLayerResponse:
    parts: list[str] = []
    pages: list[PDFTextPage] = []
    cursor = 0
    for index, raw_text in enumerate(page_texts, start=1):
        if index > 1:
            parts.append("\n\n")
            cursor += 2
        text = (raw_text or "").strip()
        start = cursor
        parts.append(text)
        cursor += len(text)
        pages.append(PDFTextPage(page=index, text=text, char_start=start, char_end=cursor))

    full_text = "".join(parts)
    return PDFTextLayerResponse(
        text=full_text,
        text_hash=hashlib.sha256(full_text.encode("utf-8")).hexdigest(),
        page_count=len(page_texts),
        char_count=len(full_text),
        pages=pages,
    )


# ============================================================
# Claim extraction
# ============================================================

class ExtractClaimsRequest(BaseModel):
    """从一段载体文本中抽取 claim/concept 候选。"""

    carrier_id: int = Field(..., description="atlas_carriers.id")
    text: str = Field(..., min_length=10, description="要抽取的全文（Markdown / transcript）")
    max_candidates: int = Field(default=10, ge=1, le=50)
    model_id: Optional[str] = Field(default=None, description="LiteLLM model id，Phase 3 stub 忽略")


class ClaimCandidate(BaseModel):
    proposed_title: str
    proposed_body: Optional[str] = None
    proposed_kp_type: str = "claim"
    proposed_confidence: float = 0.6
    rationale: Optional[str] = None
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float | None = None


class ExtractClaimsResponse(BaseModel):
    candidates: list[ClaimCandidate]
    model_id: str
    stub: bool = True
    structured: bool = False
    attempts: int = 0


# 启发式关键词（Phase 3 stub 用，Phase 3 后期换为 LLM 抽取）
HEURISTIC_TRIGGERS = [
    (r"提出", "claim"),
    (r"定义", "definition"),
    (r"是", "concept"),
    (r"导致|引起|造成", "claim"),
    (r"为什么|如何|是否", "question"),
    (r"例如|比如|示例", "example"),
    (r"方法|步骤|流程", "method"),
]

VALID_KP_TYPES = {
    "claim",
    "concept",
    "question",
    "definition",
    "method",
    "example",
    "person",
    "source",
}


class StructuredClaimCandidate(BaseModel):
    title: str = Field(..., min_length=2, max_length=160)
    body: str | None = Field(default=None, max_length=4000)
    type: str = "claim"
    confidence: float = Field(default=0.65, ge=0, le=1)
    rationale: str | None = Field(default=None, max_length=1000)


class StructuredClaimsOutput(BaseModel):
    candidates: list[StructuredClaimCandidate] = Field(default_factory=list, max_length=50)


CLAIM_EXTRACTION_PROMPT = """You extract grounded Knowledge Atlas candidates from the provided text.

Return only one JSON object with this exact shape:
{"candidates":[{"title":"short claim title","body":"grounded body copied or paraphrased from text","type":"claim|concept|question|definition|method|example|person|source","confidence":0.0,"rationale":"why this is grounded"}]}

Rules:
- Do not invent facts outside the text.
- Prefer concrete claims, definitions, methods, examples, and questions.
- Keep title concise.
- Use only the allowed type values.
- Return at most {max_candidates} candidates.

Text:
{content}
"""

RELATION_SUGGESTION_PROMPT = """You choose one typed Knowledge Atlas relation between two knowledge points.

Return only one JSON object with this exact shape:
{"relation_type":"supports|refutes|specializes|generalizes|precedes|causes|similar_to|cites|instance_of","strength":0.0,"rationale":"grounded explanation"}

Rules:
- Choose exactly one relation_type from the allowed list.
- Use strength between 0 and 1.
- Do not invent facts.
- If the evidence is weak but the two points are related, use "cites" or "similar_to".

From KP #{from_kp_id}:
{from_text}

To KP #{to_kp_id}:
{to_text}
"""


def _split_chunks(text: str, max_chunks: int) -> list[str]:
    """切句子（Phase 3 stub 简化版，按中文标点 + 空行）。"""
    sentences = re.split(r"[。！？\n]+", text)
    return [s.strip() for s in sentences if len(s.strip()) >= 15][:max_chunks]


@router.post("/claims/extract")
async def extract_claims(
    req: ExtractClaimsRequest,
    llm=Depends(get_llm_router),
) -> ExtractClaimsResponse:
    structured = await _extract_claims_with_structured_llm(req, llm=llm, user_id=None)
    if structured is not None:
        candidates, model_id, attempts = structured
        return ExtractClaimsResponse(
            candidates=candidates,
            model_id=model_id,
            stub=False,
            structured=True,
            attempts=attempts,
        )

    chunks = _split_chunks(req.text, req.max_candidates)
    candidates: list[ClaimCandidate] = []
    for sentence in chunks:
        kp_type = "concept"
        for pat, t in HEURISTIC_TRIGGERS:
            if re.search(pat, sentence):
                kp_type = t
                break
        title = sentence if len(sentence) <= 60 else sentence[:60] + "…"
        candidates.append(
            ClaimCandidate(
                proposed_title=title,
                proposed_body=sentence,
                proposed_kp_type=kp_type,
                proposed_confidence=0.55,
                rationale=f"Phase 3 stub：基于关键词 (pattern={kp_type}) 启发式抽取",
                tokens_in=estimate_tokens(sentence),
                tokens_out=estimate_tokens(title),
            )
        )
    return ExtractClaimsResponse(
        candidates=candidates,
        model_id=req.model_id or "atlas-stub/heuristic-v1",
        stub=True,
        structured=False,
        attempts=0,
    )


async def _extract_claims_with_structured_llm(
    req: ExtractClaimsRequest,
    *,
    llm: Any,
    user_id: int | None,
) -> tuple[list[ClaimCandidate], str, int] | None:
    if not await _should_use_structured_llm(llm, "atlas_claims", req.model_id, user_id):
        return None

    usage_context = await _safe_usage_context(llm, "atlas_claims", user_id, req.model_id)
    model_id = str(usage_context.get("model_id") or usage_context.get("model") or req.model_id or "atlas-llm")
    last_error = ""
    max_attempts = 2
    for attempt in range(1, max_attempts + 1):
        prompt = CLAIM_EXTRACTION_PROMPT
        if last_error:
            prompt += (
                "\nYour previous output did not validate. Fix the JSON only. "
                f"Validation error: {last_error[:300]}\n"
            )
        try:
            raw = await llm.chat(
                prompt_variables={
                    "content": req.text,
                    "max_candidates": req.max_candidates,
                },
                model_alias="atlas_claims",
                custom_prompt=prompt,
                model_id=req.model_id,
                user_id=user_id,
            )
            parsed = StructuredClaimsOutput.model_validate(_extract_json_object(raw))
            candidates = _structured_claims_to_candidates(
                parsed,
                req_text=req.text,
                response_text=raw,
                usage_context=usage_context,
                limit=req.max_candidates,
            )
            if candidates:
                return candidates, model_id, attempt
            last_error = "empty candidates"
        except Exception as exc:
            last_error = str(exc)
            logger.warning(
                "atlas.claims_structured_parse_failed",
                extra={"data": {"attempt": attempt, "error": last_error[:300]}},
            )
    return None


def _structured_claims_to_candidates(
    parsed: StructuredClaimsOutput,
    *,
    req_text: str,
    response_text: str,
    usage_context: dict[str, Any],
    limit: int,
) -> list[ClaimCandidate]:
    raw_candidates = parsed.candidates[:limit]
    tokens_in = estimate_tokens(req_text)
    tokens_out_total = estimate_tokens(response_text)
    per_candidate_cost = _estimate_cost_usd(
        tokens_in=tokens_in,
        tokens_out=tokens_out_total,
        usage_context=usage_context,
        divisor=max(1, len(raw_candidates)),
    )
    candidates: list[ClaimCandidate] = []
    for item in raw_candidates:
        kp_type = item.type.strip().lower()
        if kp_type not in VALID_KP_TYPES:
            raise ValueError(f"unsupported kp type: {item.type}")
        title = item.title.strip()
        if not title:
            continue
        body = (item.body or "").strip() or None
        rationale = (item.rationale or "").strip() or None
        candidate_out = "\n".join(part for part in [title, body or "", rationale or ""] if part)
        candidates.append(
            ClaimCandidate(
                proposed_title=title[:160],
                proposed_body=body,
                proposed_kp_type=kp_type,
                proposed_confidence=item.confidence,
                rationale=rationale,
                tokens_in=tokens_in,
                tokens_out=estimate_tokens(candidate_out),
                cost_usd=per_candidate_cost,
            )
        )
    return candidates


# ============================================================
# Relation suggestion
# ============================================================

class SuggestRelationRequest(BaseModel):
    """给定一对 KP，建议它们之间的 typed relation。"""

    from_kp_id: int
    to_kp_id: int
    from_text: str = Field(..., min_length=5)
    to_text: str = Field(..., min_length=5)
    model_id: Optional[str] = None


class RelationSuggestion(BaseModel):
    relation_type: str
    strength: float
    rationale: str
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float | None = None
    model_id: str | None = None
    structured: bool = False
    attempts: int = 0


class StructuredRelationOutput(BaseModel):
    relation_type: str
    strength: float = Field(..., ge=0, le=1)
    rationale: str = Field(..., min_length=1, max_length=1200)


VALID_RELATION_TYPES = [
    "supports",
    "refutes",
    "specializes",
    "generalizes",
    "precedes",
    "causes",
    "similar_to",
    "cites",
    "instance_of",
]


@router.post("/relations/suggest")
async def suggest_relation(
    req: SuggestRelationRequest,
    llm=Depends(get_llm_router),
) -> RelationSuggestion:
    """根据文本特征启发式给出 relation 建议。

    优先使用 structured LLM wrapper；未配置 Atlas task routing 或模型失败时，
    回退到确定性启发式，确保 UI 主链路可用。
    """
    structured = await _suggest_relation_with_structured_llm(req, llm=llm, user_id=None)
    if structured is not None:
        suggestion, _, _ = structured
        return suggestion

    # 简单启发式：
    #   - 共享 token 比例高 → similar_to
    #   - 文本 1 含"反对/反驳" → refutes
    #   - 文本 1 含"是的/支持" → supports
    #   - 否则默认 cites
    a = req.from_text
    b = req.to_text
    overlap = _token_overlap(a, b)

    if any(k in a for k in ["反驳", "反对", "否定"]):
        rt = "refutes"
        rationale = "Phase 3 stub：from_text 含反驳关键词"
    elif any(k in a for k in ["支持", "证实", "佐证"]):
        rt = "supports"
        rationale = "Phase 3 stub：from_text 含支持关键词"
    elif any(k in a for k in ["导致", "引起", "造成"]):
        rt = "causes"
        rationale = "Phase 3 stub：from_text 含因果关键词"
    elif overlap >= 0.4:
        rt = "similar_to"
        rationale = f"Phase 3 stub：token overlap={overlap:.2f} ≥ 0.4"
    else:
        rt = "cites"
        rationale = f"Phase 3 stub：默认建议 cites（overlap={overlap:.2f}）"

    strength = max(0.4, min(0.95, 0.5 + overlap * 0.4))
    return RelationSuggestion(
        relation_type=rt,
        strength=strength,
        rationale=rationale,
        tokens_in=estimate_tokens(a) + estimate_tokens(b),
        tokens_out=estimate_tokens(rt) + estimate_tokens(rationale),
        model_id=req.model_id or "atlas-stub/heuristic-v1",
        structured=False,
        attempts=0,
    )


async def _suggest_relation_with_structured_llm(
    req: SuggestRelationRequest,
    *,
    llm: Any,
    user_id: int | None,
) -> tuple[RelationSuggestion, str, int] | None:
    if not await _should_use_structured_llm(llm, "atlas_relations", req.model_id, user_id):
        return None

    usage_context = await _safe_usage_context(llm, "atlas_relations", user_id, req.model_id)
    model_id = str(usage_context.get("model_id") or usage_context.get("model") or req.model_id or "atlas-llm")
    request_text = f"{req.from_text}\n\n{req.to_text}"
    last_error = ""
    max_attempts = 2
    for attempt in range(1, max_attempts + 1):
        prompt = RELATION_SUGGESTION_PROMPT
        if last_error:
            prompt += (
                "\nYour previous output did not validate. Fix the JSON only. "
                f"Validation error: {last_error[:300]}\n"
            )
        try:
            raw = await llm.chat(
                prompt_variables={
                    "content": request_text,
                    "from_kp_id": req.from_kp_id,
                    "to_kp_id": req.to_kp_id,
                    "from_text": req.from_text,
                    "to_text": req.to_text,
                },
                model_alias="atlas_relations",
                custom_prompt=prompt,
                model_id=req.model_id,
                user_id=user_id,
            )
            parsed = StructuredRelationOutput.model_validate(_extract_json_object(raw))
            relation_type = parsed.relation_type.strip().lower()
            if relation_type not in VALID_RELATION_TYPES:
                raise ValueError(f"unsupported relation type: {parsed.relation_type}")
            tokens_in = estimate_tokens(request_text)
            tokens_out = estimate_tokens(raw)
            return (
                RelationSuggestion(
                    relation_type=relation_type,
                    strength=parsed.strength,
                    rationale=parsed.rationale.strip(),
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    cost_usd=_estimate_cost_usd(
                        tokens_in=tokens_in,
                        tokens_out=tokens_out,
                        usage_context=usage_context,
                    ),
                    model_id=model_id,
                    structured=True,
                    attempts=attempt,
                ),
                model_id,
                attempt,
            )
        except Exception as exc:
            last_error = str(exc)
            logger.warning(
                "atlas.relation_structured_parse_failed",
                extra={"data": {"attempt": attempt, "error": last_error[:300]}},
            )
    return None


def _token_overlap(a: str, b: str) -> float:
    """计算两段文本的 char-bigram Jaccard（中文友好）。"""
    grams_a = _bigrams(a)
    grams_b = _bigrams(b)
    if not grams_a or not grams_b:
        return 0.0
    inter = grams_a & grams_b
    union = grams_a | grams_b
    return len(inter) / max(1, len(union))


def _bigrams(s: str) -> set[str]:
    s = re.sub(r"\s+", "", s)
    return {s[i : i + 2] for i in range(len(s) - 1)} if len(s) >= 2 else set()


# ============================================================
# 健康自检
# ============================================================

@router.get("/health")
async def atlas_health() -> dict[str, str | bool | int]:
    return {
        "ok": True,
        "module": "atlas",
        "phase": 3,
        "stub": False,
        "structured": True,
        "fallback": "heuristic_when_unconfigured",
        "relation_types": len(VALID_RELATION_TYPES),
    }


# ============================================================
# Fingerprint 工具（与 server-go fingerprintSuggestion 同语义，便于跨服务去重）
# ============================================================

def fingerprint(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


async def _should_use_structured_llm(
    llm: Any,
    task_alias: str,
    model_id: str | None,
    user_id: int | None,
) -> bool:
    if model_id:
        return True
    try:
        return bool(await llm.has_task_routing(task_alias, user_id))
    except Exception as exc:
        logger.info(
            "atlas.structured_llm_unavailable",
            extra={"data": {"task_alias": task_alias, "error": str(exc)[:200]}},
        )
        return False


async def _safe_usage_context(
    llm: Any,
    task_alias: str,
    user_id: int | None,
    model_id: str | None,
) -> dict[str, Any]:
    try:
        return await llm.resolve_usage_context(
            task_alias,
            user_id=user_id,
            model_id=model_id,
        )
    except Exception as exc:
        logger.info(
            "atlas.usage_context_unavailable",
            extra={"data": {"task_alias": task_alias, "error": str(exc)[:200]}},
        )
        return {"model": model_id or task_alias, "model_id": model_id or task_alias}


def _extract_json_object(text: str) -> Any:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("model output does not contain a JSON object")
    return json.loads(cleaned[start : end + 1])


def _estimate_cost_usd(
    *,
    tokens_in: int,
    tokens_out: int,
    usage_context: dict[str, Any],
    divisor: int = 1,
) -> float | None:
    try:
        in_price = Decimal(str(usage_context.get("input_cost_per_1m") or 0))
        out_price = Decimal(str(usage_context.get("output_cost_per_1m") or 0))
        cost = (in_price * Decimal(tokens_in) + out_price * Decimal(tokens_out)) / Decimal(1000000)
        if divisor > 1:
            cost = cost / Decimal(divisor)
        return float(cost.quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP))
    except Exception:
        return None
