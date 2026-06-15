"""QA Document Workflow — Pluggable OCR Provider abstraction.

ref: qa-document-workflow.md §8 (AI 服务) / §2 (拆分粒度) / §3 (Canonical Tree)

设计原则（铁律）：
  - OcrProvider 是 Protocol；MockOcrProvider 确定性实现，无外部依赖。
  - get_ocr_provider() 读 QA_OCR_PROVIDER 环境变量（默认 mock）。
  - MockOcrProvider 全程无 IO，可在单元测试中直接 instantiate。
"""
from __future__ import annotations

import os
from typing import Any, Protocol, runtime_checkable

# ---------------------------------------------------------------------------
# Block-type 全集（ref §2）
# ---------------------------------------------------------------------------

BLOCK_TYPES_COARSE = ["PAGE"]
BLOCK_TYPES_STANDARD = ["PAGE", "BLOCK"]
BLOCK_TYPES_FINE = ["PAGE", "BLOCK", "QUESTION", "STEM", "OPTION", "ANSWER", "ANALYSIS"]
BLOCK_TYPES_ULTRA_FINE = BLOCK_TYPES_FINE + [
    "SUB_QUESTION", "FORMULA", "TABLE", "TABLE_CELL"
]

_GRANULARITY_BLOCK_TYPES: dict[str, list[str]] = {
    "COARSE": BLOCK_TYPES_COARSE,
    "STANDARD": BLOCK_TYPES_STANDARD,
    "FINE": BLOCK_TYPES_FINE,
    "ULTRA_FINE": BLOCK_TYPES_ULTRA_FINE,
}

# ---------------------------------------------------------------------------
# Protocol — 可插拔 OCR 提供者接口
# ---------------------------------------------------------------------------


@runtime_checkable
class OcrProvider(Protocol):
    """六阶段流水线的抽象接口。每个方法均为 async，返回可 JSON 序列化的 dict。

    阶段顺序：preprocess → segment → ocr → structure → quality_check → agent_fix
    """

    async def preprocess(self, document_id: str, file_url: str, file_type: str) -> dict[str, Any]:
        """预处理：返回 {pages: [{pageNo, width, height, imageUrl}]}"""
        ...

    async def segment(self, pages: list[dict], granularity: str) -> dict[str, Any]:
        """版面分割：返回 {blocks: [{pageNo,bbox,blockType,orderIndex,sourceCropUrl,parentRef,localRef}]}"""
        ...

    async def ocr(self, blocks: list[dict]) -> dict[str, Any]:
        """文字识别：返回 {results: [{ref, text, confidence}]}"""
        ...

    async def structure(self, blocks: list[dict], granularity: str) -> dict[str, Any]:
        """结构化 → Canonical Tree：返回 {tree: [<canonical node>]}"""
        ...

    async def quality_check(self, tree: list[dict]) -> dict[str, Any]:
        """质检：返回 {issues: [{stableKey,type,message,severity}]}"""
        ...

    async def agent_fix(
        self,
        tree: list[dict],
        annotations: list[dict],
        crops: list[dict],
        ocr: list[dict],
    ) -> dict[str, Any]:
        """Agent 修复：返回 {patch: {summary, operations:[...]}}"""
        ...


# ---------------------------------------------------------------------------
# MockOcrProvider — 确定性实现，无重型依赖
# ---------------------------------------------------------------------------


def _stable_bbox(page_no: int, block_idx: int, total_blocks: int) -> dict[str, float]:
    """用整除网格生成归一化 bbox（0~1）。同参数永远输出相同结果。"""
    cols = max(1, total_blocks)
    col = block_idx % cols
    row = block_idx // cols
    w = round(1.0 / cols, 4)
    h = 0.1
    x = round(col * w, 4)
    y = round(row * h + (page_no - 1) * 0.5, 4)
    return {"x": x, "y": y, "w": w, "h": h}


def _make_stable_key(page_no: int, block_idx: int, block_type: str, child_idx: int | None = None) -> str:
    base = f"p{page_no}-b{block_idx}-{block_type.lower()}"
    if child_idx is not None:
        return f"{base}.{child_idx}"
    return base


def _make_canonical_node(
    *,
    stable_key: str,
    block_type: str,
    page_no: int,
    bbox: dict,
    text: str,
    confidence: float,
    source_crop_url: str,
    order_index: int,
    field_path: str,
    children: list[dict],
) -> dict[str, Any]:
    """构造 §3 canonical 节点（camelCase 键）。"""
    return {
        "stableKey": stable_key,
        "blockType": block_type,
        "pageNo": page_no,
        "bbox": bbox,
        "text": text,
        "confidence": confidence,
        "sourceCropUrl": source_crop_url,
        "orderIndex": order_index,
        "fieldPath": field_path,
        "children": children,
    }


def _build_tree_for_granularity(
    granularity: str, page_no: int, blocks_per_page: int, doc_id: str
) -> list[dict]:
    """构造指定粒度下单页的 canonical tree（确定性）。"""
    gran = granularity.upper()

    if gran == "COARSE":
        # 只有 PAGE 节点
        sk = _make_stable_key(page_no, 0, "PAGE")
        return [
            _make_canonical_node(
                stable_key=sk,
                block_type="PAGE",
                page_no=page_no,
                bbox={"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
                text=f"Page {page_no} content",
                confidence=0.99,
                source_crop_url=f"/api/uploads/qa/{doc_id}/crops/{sk}.png",
                order_index=page_no - 1,
                field_path=f"pages[{page_no - 1}]",
                children=[],
            )
        ]

    if gran == "STANDARD":
        # PAGE → BLOCK
        page_sk = _make_stable_key(page_no, 0, "PAGE")
        block_children = []
        for bi in range(blocks_per_page):
            blk_sk = _make_stable_key(page_no, bi, "BLOCK")
            bbox = _stable_bbox(page_no, bi, blocks_per_page)
            block_children.append(
                _make_canonical_node(
                    stable_key=blk_sk,
                    block_type="BLOCK",
                    page_no=page_no,
                    bbox=bbox,
                    text=f"Block {bi + 1} on page {page_no}",
                    confidence=round(0.90 + bi * 0.01, 3),
                    source_crop_url=f"/api/uploads/qa/{doc_id}/crops/{blk_sk}.png",
                    order_index=bi,
                    field_path=f"pages[{page_no - 1}].blocks[{bi}]",
                    children=[],
                )
            )
        return [
            _make_canonical_node(
                stable_key=page_sk,
                block_type="PAGE",
                page_no=page_no,
                bbox={"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
                text="",
                confidence=1.0,
                source_crop_url=f"/api/uploads/qa/{doc_id}/crops/{page_sk}.png",
                order_index=page_no - 1,
                field_path=f"pages[{page_no - 1}]",
                children=block_children,
            )
        ]

    if gran in ("FINE", "ULTRA_FINE"):
        # PAGE → BLOCK → QUESTION → STEM / OPTION / ANSWER / ANALYSIS
        # ULTRA_FINE adds SUB_QUESTION / FORMULA / TABLE / TABLE_CELL under QUESTION
        page_sk = _make_stable_key(page_no, 0, "PAGE")
        block_children = []
        for bi in range(blocks_per_page):
            blk_sk = _make_stable_key(page_no, bi, "BLOCK")

            # Build QUESTION node and its sub-nodes
            q_sk = _make_stable_key(page_no, bi, "QUESTION")
            q_bbox = _stable_bbox(page_no, bi, blocks_per_page)

            sub_types_fine = ["STEM", "OPTION", "ANSWER", "ANALYSIS"]
            sub_types_ultra = ["SUB_QUESTION", "FORMULA", "TABLE", "TABLE_CELL"]
            chosen_sub = sub_types_fine + (sub_types_ultra if gran == "ULTRA_FINE" else [])

            q_children = []
            for si, stype in enumerate(chosen_sub):
                s_sk = _make_stable_key(page_no, bi, stype, si)
                q_children.append(
                    _make_canonical_node(
                        stable_key=s_sk,
                        block_type=stype,
                        page_no=page_no,
                        bbox={
                            "x": round(q_bbox["x"], 4),
                            "y": round(q_bbox["y"] + si * 0.02, 4),
                            "w": round(q_bbox["w"], 4),
                            "h": 0.02,
                        },
                        text=f"Question {bi + 1}: {stype.lower()} content",
                        confidence=round(0.95 - si * 0.01, 3),
                        source_crop_url=f"/api/uploads/qa/{doc_id}/crops/{s_sk}.png",
                        order_index=si,
                        field_path=f"questions[{bi}].{stype.lower()}",
                        children=[],
                    )
                )

            q_node = _make_canonical_node(
                stable_key=q_sk,
                block_type="QUESTION",
                page_no=page_no,
                bbox=q_bbox,
                text=f"Question {bi + 1}: Sample text content",
                confidence=0.97,
                source_crop_url=f"/api/uploads/qa/{doc_id}/crops/{q_sk}.png",
                order_index=bi,
                field_path=f"questions[{bi}]",
                children=q_children,
            )

            blk_node = _make_canonical_node(
                stable_key=blk_sk,
                block_type="BLOCK",
                page_no=page_no,
                bbox=q_bbox,
                text="",
                confidence=1.0,
                source_crop_url=f"/api/uploads/qa/{doc_id}/crops/{blk_sk}.png",
                order_index=bi,
                field_path=f"pages[{page_no - 1}].blocks[{bi}]",
                children=[q_node],
            )
            block_children.append(blk_node)

        return [
            _make_canonical_node(
                stable_key=page_sk,
                block_type="PAGE",
                page_no=page_no,
                bbox={"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
                text="",
                confidence=1.0,
                source_crop_url=f"/api/uploads/qa/{doc_id}/crops/{page_sk}.png",
                order_index=page_no - 1,
                field_path=f"pages[{page_no - 1}]",
                children=block_children,
            )
        ]

    # Fallback — treat as COARSE
    return _build_tree_for_granularity("COARSE", page_no, blocks_per_page, doc_id)


class MockOcrProvider:
    """确定性 Mock OCR Provider（无外部依赖）。

    实现 OcrProvider Protocol 的全部六个阶段。相同输入永远产出相同输出。
    """

    # 固定返回 2 页
    _PAGE_COUNT = 2
    # 每页固定 3 个 block（用于 segment / structure）
    _BLOCKS_PER_PAGE = 3

    # ── 阶段 1：预处理 ──────────────────────────────────────────────────────

    async def preprocess(self, document_id: str, file_url: str, file_type: str) -> dict[str, Any]:
        """返回固定 2 页的元数据（确定性）。"""
        pages = []
        for i in range(1, self._PAGE_COUNT + 1):
            pages.append({
                "pageNo": i,
                "width": 794,
                "height": 1123,
                "imageUrl": f"/api/uploads/qa/{document_id}/pages/page-{i}.png",
            })
        return {"pages": pages}

    # ── 阶段 2：分割 ────────────────────────────────────────────────────────

    async def segment(self, pages: list[dict], granularity: str) -> dict[str, Any]:
        """用简单网格数学生成 bbox，每页固定若干 block（确定性）。"""
        n = self._BLOCKS_PER_PAGE
        blocks: list[dict] = []
        order = 0
        for page in pages:
            page_no = page.get("pageNo", 1)
            for bi in range(n):
                bbox = _stable_bbox(page_no, bi, n)
                local_ref = f"p{page_no}-b{bi}"
                blocks.append({
                    "pageNo": page_no,
                    "bbox": bbox,
                    "blockType": "BLOCK",
                    "orderIndex": order,
                    "sourceCropUrl": f"/api/uploads/qa/doc/crops/{local_ref}.png",
                    "parentRef": f"p{page_no}",
                    "localRef": local_ref,
                })
                order += 1
        return {"blocks": blocks}

    # ── 阶段 3：OCR ─────────────────────────────────────────────────────────

    async def ocr(self, blocks: list[dict]) -> dict[str, Any]:
        """每个 block 返回确定性合成文字（基于 localRef）。"""
        results = []
        for i, block in enumerate(blocks):
            ref = block.get("localRef") or block.get("stableKey") or f"block-{i}"
            # 确定性：同 ref 同 text
            text = f"Question {i + 1}: Sample text content"
            confidence = round(0.80 + (i % 10) * 0.02, 3)
            results.append({"ref": ref, "text": text, "confidence": confidence})
        return {"results": results}

    # ── 阶段 4：结构化 ──────────────────────────────────────────────────────

    async def structure(self, blocks: list[dict], granularity: str) -> dict[str, Any]:
        """按粒度构造 Canonical Tree（确定性）。

        blocks 里必须含 pageNo；doc_id 从 sourceCropUrl 中解析，无则用 "doc"。
        """
        # 收集所有 pageNo
        page_nos: list[int] = sorted({b.get("pageNo", 1) for b in blocks})
        if not page_nos:
            page_nos = [1]

        # 尝试从首个 block 的 sourceCropUrl 中提取 doc_id
        doc_id = "doc"
        if blocks:
            crop_url = blocks[0].get("sourceCropUrl", "")
            parts = crop_url.split("/")
            # 绝对路径 /api/uploads/qa/<docId>/crops/... → split 后 parts[0]="",
            # parts[1]="api", parts[2]="uploads", parts[3]="qa", parts[4]=<docId>。
            if len(parts) >= 5 and parts[1] == "api" and parts[2] == "uploads" and parts[3] == "qa":
                doc_id = parts[4]

        tree: list[dict] = []
        for page_no in page_nos:
            tree.extend(
                _build_tree_for_granularity(
                    granularity, page_no, self._BLOCKS_PER_PAGE, doc_id
                )
            )
        return {"tree": tree}

    # ── 阶段 5：质检 ────────────────────────────────────────────────────────

    async def quality_check(self, tree: list[dict]) -> dict[str, Any]:
        """对树中 confidence < 0.90 的节点标记低置信度 issue（确定性）。"""
        issues: list[dict] = []

        def _walk(nodes: list[dict]) -> None:
            for node in nodes:
                conf = node.get("confidence", 1.0)
                if isinstance(conf, (int, float)) and conf < 0.90:
                    issues.append({
                        "stableKey": node.get("stableKey", "unknown"),
                        "type": "LOW_CONFIDENCE",
                        "message": f"置信度 {conf:.2f} 低于阈值 0.90",
                        "severity": "WARNING",
                    })
                children = node.get("children") or []
                if children:
                    _walk(children)

        _walk(tree)
        return {"issues": issues}

    # ── 阶段 6：Agent 修复 ──────────────────────────────────────────────────

    async def agent_fix(
        self,
        tree: list[dict],
        annotations: list[dict],
        crops: list[dict],
        ocr: list[dict],
    ) -> dict[str, Any]:
        """无 LLM 时的确定性 fallback：从 annotations 的 correctedText 直接生成 replace_text 操作。

        遵循 §8 规范：agent_fix 在无真实 LLM 时回退到确定性 mock。
        """
        operations: list[dict] = []
        for ann in annotations:
            stable_key = ann.get("stableKey") or ann.get("stable_key") or ""
            corrected = ann.get("correctedText") or ann.get("corrected_text") or ""
            old_text = ann.get("originalText") or ann.get("original_text") or ""
            if stable_key and corrected:
                operations.append({
                    "op": "replace_text",
                    "stableKey": stable_key,
                    "fieldPath": "text",
                    "oldValue": old_text,
                    "newValue": corrected,
                    "reason": "标注纠正文本（mock fallback）",
                    "confidence": 0.90,
                })
        summary = f"Mock fallback: 生成 {len(operations)} 条替换操作"
        return {"patch": {"summary": summary, "operations": operations}}


# ---------------------------------------------------------------------------
# 工厂函数
# ---------------------------------------------------------------------------


def get_ocr_provider() -> OcrProvider:
    """根据 QA_OCR_PROVIDER 环境变量返回对应 provider（默认 mock）。

    当前支持：
      - mock（默认）→ MockOcrProvider
      - 其他 → 抛 ValueError（真实引擎占位，后续扩展）
    """
    provider_name = os.environ.get("QA_OCR_PROVIDER", "mock").lower().strip()
    if provider_name == "mock":
        return MockOcrProvider()
    raise ValueError(
        f"不支持的 QA_OCR_PROVIDER={provider_name!r}。"
        "当前仅支持 mock；真实引擎请在此处注册。"
    )
