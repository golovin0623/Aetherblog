"""QA Document Workflow — Pydantic schemas for all 6 AI-service endpoints.

ref: qa-document-workflow.md §3 (Canonical Node) / §4 (Patch) / §8 (AI 服务 API)

命名约定：全部 camelCase（与 Go 后端/前端契约对齐）。
使用 model_config = ConfigDict(populate_by_name=True) 允许按字段名或 alias 填充。
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# 共用子结构
# ---------------------------------------------------------------------------


class BboxModel(BaseModel):
    """归一化 0~1 的页面相对坐标。ref §3"""

    model_config = ConfigDict(populate_by_name=True)

    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)
    w: float = Field(..., ge=0.0, le=1.0)
    h: float = Field(..., ge=0.0, le=1.0)


class CanonicalNode(BaseModel):
    """§3 Canonical Document Tree 节点。

    使用 model_rebuild() 因为 children 自引用。
    stableKey 是跨版本稳定锚点（Patch/Diff/Merge 命中用）。
    """

    model_config = ConfigDict(populate_by_name=True)

    stableKey: str = Field(..., description="跨版本稳定锚点")
    blockType: str = Field(..., description="PAGE|BLOCK|QUESTION|STEM|OPTION|ANSWER|ANALYSIS|SUB_QUESTION|FORMULA|TABLE|TABLE_CELL")
    pageNo: int = Field(..., ge=1)
    bbox: BboxModel
    text: str = Field(default="")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    sourceCropUrl: Optional[str] = None
    orderIndex: int = Field(default=0, ge=0)
    fieldPath: Optional[str] = None
    children: list["CanonicalNode"] = Field(default_factory=list)


CanonicalNode.model_rebuild()


# ---------------------------------------------------------------------------
# §8 端点 1：POST /api/v1/ai/qa/preprocess
# ---------------------------------------------------------------------------


class PreprocessRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    documentId: str = Field(..., description="qa_documents.id")
    fileUrl: str = Field(..., description="原始文件 URL")
    fileType: str = Field(..., description="MIME 类型，如 application/pdf")


class PageInfo(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    pageNo: int
    width: int
    height: int
    imageUrl: str


class PreprocessData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    pages: list[PageInfo]


# ---------------------------------------------------------------------------
# §8 端点 2：POST /api/v1/ai/qa/segment
# ---------------------------------------------------------------------------


class SegmentRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    pages: list[dict[str, Any]] = Field(..., description="preprocess 返回的 pages 数组")
    granularity: str = Field(..., description="COARSE|STANDARD|FINE|ULTRA_FINE")


class SegmentBlock(BaseModel):
    """segment 阶段返回的单 block 描述。"""

    model_config = ConfigDict(populate_by_name=True)

    pageNo: int
    bbox: BboxModel
    blockType: str
    orderIndex: int
    sourceCropUrl: Optional[str] = None
    parentRef: Optional[str] = None
    localRef: str


class SegmentData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    blocks: list[SegmentBlock]


# ---------------------------------------------------------------------------
# §8 端点 3：POST /api/v1/ai/qa/ocr
# ---------------------------------------------------------------------------


class OcrRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    blocks: list[dict[str, Any]] = Field(..., description="segment 返回的 blocks 数组")


class OcrResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    ref: str
    text: str
    confidence: float = Field(..., ge=0.0, le=1.0)


class OcrData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    results: list[OcrResult]


# ---------------------------------------------------------------------------
# §8 端点 4：POST /api/v1/ai/qa/structure
# ---------------------------------------------------------------------------


class StructureRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    blocks: list[dict[str, Any]] = Field(..., description="segment 返回的 blocks 数组（含 OCR 结果）")
    granularity: str = Field(..., description="COARSE|STANDARD|FINE|ULTRA_FINE")


class StructureData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    tree: list[CanonicalNode]


# ---------------------------------------------------------------------------
# §8 端点 5：POST /api/v1/ai/qa/quality-check
# ---------------------------------------------------------------------------


class QualityCheckRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    tree: list[dict[str, Any]] = Field(..., description="structure 返回的 canonical tree")


class QualityIssue(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    stableKey: str
    type: str = Field(..., description="LOW_CONFIDENCE|OCR_ERROR|MISSING_FIELD|…")
    message: str
    severity: str = Field(..., description="ERROR|WARNING|INFO")


class QualityCheckData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    issues: list[QualityIssue]


# ---------------------------------------------------------------------------
# §8 端点 6：POST /api/v1/ai/qa/agent-fix
# ---------------------------------------------------------------------------


class AnnotationItem(BaseModel):
    """前端/后端传入的标注项（用于 agent-fix）。"""

    model_config = ConfigDict(populate_by_name=True)

    stableKey: str
    originalText: Optional[str] = None
    correctedText: Optional[str] = None
    comment: Optional[str] = None


class AgentFixRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    tree: list[dict[str, Any]] = Field(..., description="当前版本子树")
    annotations: list[dict[str, Any]] = Field(default_factory=list, description="qa_annotations 列表")
    crops: list[dict[str, Any]] = Field(default_factory=list, description="裁剪图 URL 映射")
    ocr: list[dict[str, Any]] = Field(default_factory=list, description="OCR 原始结果")


class PatchOperation(BaseModel):
    """§4 Patch 操作项。ref qa-document-workflow.md §4"""

    model_config = ConfigDict(populate_by_name=True)

    op: str = Field(..., description="replace_text|update_field|insert_block|delete_block|split_block|merge_block")
    stableKey: str
    fieldPath: Optional[str] = None
    oldValue: Optional[str] = None
    newValue: Optional[str] = None
    reason: Optional[str] = None
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)


class PatchProposal(BaseModel):
    """§4 Agent Patch Proposal。"""

    model_config = ConfigDict(populate_by_name=True)

    summary: str
    operations: list[PatchOperation]


class AgentFixData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    patch: PatchProposal
