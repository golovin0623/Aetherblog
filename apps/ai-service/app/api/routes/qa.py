"""QA Document Workflow — 6 pipeline-stage endpoints under /api/v1/ai/qa/*.

ref: qa-document-workflow.md §8 (AI 服务)

鉴权：所有端点均通过 require_admin_or_internal（X-Internal-Service token），
仅允许来自 Go 后端的服务间调用。CORS 白名单中故意不含 X-Internal-Service，
浏览器路径无法触达这批端点（ref: main.py CORS 注释）。

挂载路径：prefix="/api/v1/ai/qa"，即：
  POST /api/v1/ai/qa/preprocess
  POST /api/v1/ai/qa/segment
  POST /api/v1/ai/qa/ocr
  POST /api/v1/ai/qa/structure
  POST /api/v1/ai/qa/quality-check
  POST /api/v1/ai/qa/agent-fix
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from app.api.deps import require_admin_or_internal
from app.schemas.common import ApiResponse
from app.schemas.qa import (
    AgentFixData,
    AgentFixRequest,
    OcrData,
    OcrRequest,
    PreprocessData,
    PreprocessRequest,
    QualityCheckData,
    QualityCheckRequest,
    SegmentData,
    SegmentRequest,
    StructureData,
    StructureRequest,
)
from app.services.qa_ocr import get_ocr_provider

router = APIRouter(prefix="/api/v1/ai/qa", tags=["qa"])
logger = logging.getLogger("ai-service")


# ---------------------------------------------------------------------------
# 端点 1：预处理
# ---------------------------------------------------------------------------


@router.post("/preprocess", response_model=ApiResponse[PreprocessData])
async def qa_preprocess(
    req: PreprocessRequest,
    _user=Depends(require_admin_or_internal),
) -> ApiResponse[PreprocessData]:
    """阶段 1：栅格化/预处理文档，返回各页基本信息。

    入参：{documentId, fileUrl, fileType}
    出参：{pages:[{pageNo, width, height, imageUrl}]}
    """
    provider = get_ocr_provider()
    raw = await provider.preprocess(req.documentId, req.fileUrl, req.fileType)
    data = PreprocessData(**raw)
    return ApiResponse(data=data)


# ---------------------------------------------------------------------------
# 端点 2：版面分割
# ---------------------------------------------------------------------------


@router.post("/segment", response_model=ApiResponse[SegmentData])
async def qa_segment(
    req: SegmentRequest,
    _user=Depends(require_admin_or_internal),
) -> ApiResponse[SegmentData]:
    """阶段 2：版面分割，返回 block 列表（含 bbox / blockType）。

    入参：{pages, granularity}
    出参：{blocks:[{pageNo, bbox, blockType, orderIndex, sourceCropUrl, parentRef, localRef}]}
    """
    provider = get_ocr_provider()
    raw = await provider.segment(req.pages, req.granularity)
    data = SegmentData(**raw)
    return ApiResponse(data=data)


# ---------------------------------------------------------------------------
# 端点 3：OCR
# ---------------------------------------------------------------------------


@router.post("/ocr", response_model=ApiResponse[OcrData])
async def qa_ocr(
    req: OcrRequest,
    _user=Depends(require_admin_or_internal),
) -> ApiResponse[OcrData]:
    """阶段 3：对各 block 执行文字识别，返回 {ref, text, confidence}。

    入参：{blocks}
    出参：{results:[{ref, text, confidence}]}
    """
    provider = get_ocr_provider()
    raw = await provider.ocr(req.blocks)
    data = OcrData(**raw)
    return ApiResponse(data=data)


# ---------------------------------------------------------------------------
# 端点 4：结构化
# ---------------------------------------------------------------------------


@router.post("/structure", response_model=ApiResponse[StructureData])
async def qa_structure(
    req: StructureRequest,
    _user=Depends(require_admin_or_internal),
) -> ApiResponse[StructureData]:
    """阶段 4：将 block 列表（含 OCR 结果）重建为 Canonical Document Tree。

    入参：{blocks, granularity}
    出参：{tree:[<canonical node>]}
    """
    provider = get_ocr_provider()
    raw = await provider.structure(req.blocks, req.granularity)
    data = StructureData(**raw)
    return ApiResponse(data=data)


# ---------------------------------------------------------------------------
# 端点 5：质检
# ---------------------------------------------------------------------------


@router.post("/quality-check", response_model=ApiResponse[QualityCheckData])
async def qa_quality_check(
    req: QualityCheckRequest,
    _user=Depends(require_admin_or_internal),
) -> ApiResponse[QualityCheckData]:
    """阶段 5：对 Canonical Tree 执行质检，返回 issue 列表。

    入参：{tree}
    出参：{issues:[{stableKey, type, message, severity}]}
    """
    provider = get_ocr_provider()
    raw = await provider.quality_check(req.tree)
    data = QualityCheckData(**raw)
    return ApiResponse(data=data)


# ---------------------------------------------------------------------------
# 端点 6：Agent 修复
# ---------------------------------------------------------------------------


@router.post("/agent-fix", response_model=ApiResponse[AgentFixData])
async def qa_agent_fix(
    req: AgentFixRequest,
    _user=Depends(require_admin_or_internal),
) -> ApiResponse[AgentFixData]:
    """阶段 6：Agent 修复，产出 Patch Proposal。

    配置了真实 LLM 时调用 LLM；否则回退确定性 mock（从 annotations.correctedText 生成 replace_text）。

    入参：{tree, annotations, crops, ocr}
    出参：{patch:{summary, operations:[...]}}
    """
    provider = get_ocr_provider()
    raw = await provider.agent_fix(req.tree, req.annotations, req.crops, req.ocr)
    data = AgentFixData(**raw)
    return ApiResponse(data=data)
