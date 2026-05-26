"""Atlas (Aether Knowledge) AI 端点 —— Phase 3 P3-01/02

落地手册: ../../docs/plan/task-aether-knowledge-system.md §3 Phase 3

Phase 3 范围（本文件）:
  - POST /v1/atlas/claims/extract   从 carrier 文本中抽取 claim 候选（→ KP 建议）
  - POST /v1/atlas/relations/suggest 给定一对 KP，建议它们之间的 typed relation

实现方式:
  - **Phase 3 上线时本文件是 stub**: 返回基于关键词的确定性候选，让前端 + server-go
    accept/reject 链路可端到端跑通，而不消耗 LLM 配额。
  - Phase 3 后期：用 deps.get_llm_router() 改为真正的 LiteLLM 调用 +
    claim/entity 抽取 prompt + cost 计入 atlas_ai_suggestions.cost_usd。
  - 红线 C3-1: 本服务**永远不直接写** atlas_knowledge_points / atlas_typed_relations
    表，所有建议必须经 server-go suggestion handler 落 atlas_ai_suggestions 表。
"""

from __future__ import annotations

import hashlib
import logging
import re
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field


logger = logging.getLogger("atlas")
router = APIRouter(tags=["atlas"], prefix="/v1/atlas")


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


class ExtractClaimsResponse(BaseModel):
    candidates: list[ClaimCandidate]
    model_id: str
    stub: bool = True


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


def _split_chunks(text: str, max_chunks: int) -> list[str]:
    """切句子（Phase 3 stub 简化版，按中文标点 + 空行）。"""
    sentences = re.split(r"[。！？\n]+", text)
    return [s.strip() for s in sentences if len(s.strip()) >= 15][:max_chunks]


@router.post("/claims/extract")
async def extract_claims(req: ExtractClaimsRequest) -> ExtractClaimsResponse:
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
                tokens_in=len(sentence),
                tokens_out=len(title),
            )
        )
    return ExtractClaimsResponse(
        candidates=candidates,
        model_id=req.model_id or "atlas-stub/heuristic-v1",
        stub=True,
    )


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
async def suggest_relation(req: SuggestRelationRequest) -> RelationSuggestion:
    """根据文本特征启发式给出 relation 建议。

    Phase 3 stub: 使用文本相似度 + 关键词；Phase 3 后期换为 LLM。
    """

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
        rationale = f"Phase 3 stub：from_text 含反驳关键词"
    elif any(k in a for k in ["支持", "证实", "佐证"]):
        rt = "supports"
        rationale = f"Phase 3 stub：from_text 含支持关键词"
    elif any(k in a for k in ["导致", "引起", "造成"]):
        rt = "causes"
        rationale = f"Phase 3 stub：from_text 含因果关键词"
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
        tokens_in=len(a) + len(b),
        tokens_out=len(rt) + len(rationale),
    )


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
        "stub": True,
        "relation_types": len(VALID_RELATION_TYPES),
    }


# ============================================================
# Fingerprint 工具（与 server-go fingerprintSuggestion 同语义，便于跨服务去重）
# ============================================================

def fingerprint(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
