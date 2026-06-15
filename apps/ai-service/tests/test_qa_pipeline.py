"""QA Document Workflow — AI-service layer tests.

ref: qa-document-workflow.md §10 (Python 测试要求)

覆盖：
  1. MockOcrProvider 确定性（同输入 → 同输出，跨调用稳定）
  2. Canonical Tree 形态（每种粒度下的节点层级与必要字段）
  3. agent_fix mock 回退：从 annotations.correctedText 产出 replace_text 操作
  4. 6 个端点 HTTP 200 + 文档化 schema 验证（使用 TestClient + internal token）
"""
from __future__ import annotations

import os
import pytest

# conftest.py 在收集期已注入最小环境变量；此处确保 QA_OCR_PROVIDER=mock
os.environ.setdefault("QA_OCR_PROVIDER", "mock")

from app.services.qa_ocr import (  # noqa: E402
    MockOcrProvider,
    _build_tree_for_granularity,
    get_ocr_provider,
)

# ─────────────────────────── Internal-token header ──────────────────────────

_INTERNAL_HEADERS = {
    "X-Internal-Service": os.environ.get(
        "AI_INTERNAL_SERVICE_TOKEN",
        "pytest-internal-service-token-minimum-32-chars",
    )
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. MockOcrProvider 确定性验证
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_preprocess_deterministic() -> None:
    p = MockOcrProvider()
    r1 = await p.preprocess("doc-abc", "http://example.com/a.pdf", "application/pdf")
    r2 = await p.preprocess("doc-abc", "http://example.com/a.pdf", "application/pdf")
    assert r1 == r2, "preprocess 应当确定性"
    assert len(r1["pages"]) == 2  # 固定 2 页
    for page in r1["pages"]:
        assert "pageNo" in page
        assert "width" in page
        assert "height" in page
        assert "imageUrl" in page


@pytest.mark.asyncio
async def test_segment_deterministic() -> None:
    p = MockOcrProvider()
    pages = [{"pageNo": 1, "width": 794, "height": 1123}]
    r1 = await p.segment(pages, "STANDARD")
    r2 = await p.segment(pages, "STANDARD")
    assert r1 == r2, "segment 应当确定性"
    for b in r1["blocks"]:
        assert "localRef" in b
        assert "bbox" in b
        assert "blockType" in b
        assert "orderIndex" in b


@pytest.mark.asyncio
async def test_ocr_deterministic() -> None:
    p = MockOcrProvider()
    blocks = [
        {"localRef": "p1-b0", "pageNo": 1},
        {"localRef": "p1-b1", "pageNo": 1},
    ]
    r1 = await p.ocr(blocks)
    r2 = await p.ocr(blocks)
    assert r1 == r2, "ocr 应当确定性"
    for item in r1["results"]:
        assert "ref" in item
        assert "text" in item
        assert 0.0 <= item["confidence"] <= 1.0


@pytest.mark.asyncio
async def test_structure_deterministic() -> None:
    p = MockOcrProvider()
    blocks = [{"pageNo": 1, "sourceCropUrl": "/api/uploads/qa/doc/crops/p1-b0.png"}]
    r1 = await p.structure(blocks, "FINE")
    r2 = await p.structure(blocks, "FINE")
    assert r1 == r2, "structure 应当确定性"
    assert len(r1["tree"]) >= 1


@pytest.mark.asyncio
async def test_quality_check_deterministic() -> None:
    p = MockOcrProvider()
    tree = [
        {"stableKey": "p1-b0-page", "blockType": "PAGE", "pageNo": 1,
         "confidence": 0.75, "children": []},
        {"stableKey": "p1-b1-block", "blockType": "BLOCK", "pageNo": 1,
         "confidence": 0.99, "children": []},
    ]
    r1 = await p.quality_check(tree)
    r2 = await p.quality_check(tree)
    assert r1 == r2, "quality_check 应当确定性"
    # 只有 confidence=0.75 的节点应被标记
    flagged_keys = {i["stableKey"] for i in r1["issues"]}
    assert "p1-b0-page" in flagged_keys
    assert "p1-b1-block" not in flagged_keys


# ─────────────────────────────────────────────────────────────────────────────
# 2. Canonical Tree 形态（各粒度）
# ─────────────────────────────────────────────────────────────────────────────


def _collect_all_block_types(nodes: list[dict]) -> set[str]:
    types: set[str] = set()
    for n in nodes:
        types.add(n["blockType"])
        types |= _collect_all_block_types(n.get("children") or [])
    return types


def test_canonical_tree_coarse_shape() -> None:
    tree = _build_tree_for_granularity("COARSE", page_no=1, blocks_per_page=3, doc_id="d1")
    types = _collect_all_block_types(tree)
    assert types == {"PAGE"}, f"COARSE 应只含 PAGE，实得 {types}"
    assert all("stableKey" in n for n in tree)
    assert all("bbox" in n for n in tree)
    assert all("confidence" in n for n in tree)


def test_canonical_tree_standard_shape() -> None:
    tree = _build_tree_for_granularity("STANDARD", page_no=1, blocks_per_page=3, doc_id="d1")
    types = _collect_all_block_types(tree)
    assert "PAGE" in types
    assert "BLOCK" in types
    extra = types - {"PAGE", "BLOCK"}
    assert not extra, f"STANDARD 不应含 {extra}"
    # PAGE 节点的 children 应是 BLOCK
    page_node = tree[0]
    assert page_node["blockType"] == "PAGE"
    assert all(c["blockType"] == "BLOCK" for c in page_node["children"])


def test_canonical_tree_fine_shape() -> None:
    tree = _build_tree_for_granularity("FINE", page_no=1, blocks_per_page=2, doc_id="d1")
    types = _collect_all_block_types(tree)
    assert {"PAGE", "BLOCK", "QUESTION"}.issubset(types)
    assert {"STEM", "OPTION", "ANSWER", "ANALYSIS"}.issubset(types)
    # ULTRA_FINE 类型不应出现
    ultra_only = {"SUB_QUESTION", "FORMULA", "TABLE", "TABLE_CELL"}
    assert not (types & ultra_only), f"FINE 不应含 ULTRA_FINE 节点，实得 {types & ultra_only}"


def test_canonical_tree_ultra_fine_shape() -> None:
    tree = _build_tree_for_granularity("ULTRA_FINE", page_no=1, blocks_per_page=2, doc_id="d1")
    types = _collect_all_block_types(tree)
    assert {"PAGE", "BLOCK", "QUESTION", "STEM", "OPTION", "ANSWER", "ANALYSIS"}.issubset(types)
    assert {"SUB_QUESTION", "FORMULA", "TABLE", "TABLE_CELL"}.issubset(types)


def test_canonical_node_required_fields_present() -> None:
    """每个节点必须含 §3 全部必填字段。"""
    tree = _build_tree_for_granularity("FINE", page_no=1, blocks_per_page=2, doc_id="d1")

    def _check(nodes: list[dict]) -> None:
        for node in nodes:
            assert "stableKey" in node, f"缺少 stableKey: {node}"
            assert "blockType" in node, f"缺少 blockType: {node}"
            assert "pageNo" in node, f"缺少 pageNo: {node}"
            assert "bbox" in node, f"缺少 bbox: {node}"
            assert "confidence" in node, f"缺少 confidence: {node}"
            assert "orderIndex" in node, f"缺少 orderIndex: {node}"
            assert "children" in node, f"缺少 children: {node}"
            _check(node["children"])

    _check(tree)


# ─────────────────────────────────────────────────────────────────────────────
# 3. agent_fix mock 回退
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_agent_fix_fallback_generates_replace_text_from_annotations() -> None:
    p = MockOcrProvider()
    annotations = [
        {"stableKey": "p1-b0-stem", "originalText": "导树", "correctedText": "导数"},
        {"stableKey": "p1-b1-answer", "originalText": "错答案", "correctedText": "正确答案"},
    ]
    result = await p.agent_fix(tree=[], annotations=annotations, crops=[], ocr=[])
    patch = result["patch"]
    assert "summary" in patch
    assert "operations" in patch
    ops = patch["operations"]
    assert len(ops) == 2
    for op in ops:
        assert op["op"] == "replace_text"
        assert "stableKey" in op
        assert "newValue" in op
    assert ops[0]["stableKey"] == "p1-b0-stem"
    assert ops[0]["newValue"] == "导数"
    assert ops[1]["stableKey"] == "p1-b1-answer"
    assert ops[1]["newValue"] == "正确答案"


@pytest.mark.asyncio
async def test_agent_fix_deterministic() -> None:
    p = MockOcrProvider()
    annotations = [
        {"stableKey": "p1-b0-stem", "originalText": "错", "correctedText": "对"},
    ]
    r1 = await p.agent_fix([], annotations, [], [])
    r2 = await p.agent_fix([], annotations, [], [])
    assert r1 == r2, "agent_fix fallback 应当确定性"


@pytest.mark.asyncio
async def test_agent_fix_empty_annotations_yields_no_ops() -> None:
    p = MockOcrProvider()
    result = await p.agent_fix(tree=[], annotations=[], crops=[], ocr=[])
    assert result["patch"]["operations"] == []


# ─────────────────────────────────────────────────────────────────────────────
# 4. factory
# ─────────────────────────────────────────────────────────────────────────────


def test_get_ocr_provider_returns_mock_by_default() -> None:
    orig = os.environ.pop("QA_OCR_PROVIDER", None)
    try:
        p = get_ocr_provider()
        assert isinstance(p, MockOcrProvider)
    finally:
        if orig is not None:
            os.environ["QA_OCR_PROVIDER"] = orig


def test_get_ocr_provider_mock_explicit() -> None:
    os.environ["QA_OCR_PROVIDER"] = "mock"
    p = get_ocr_provider()
    assert isinstance(p, MockOcrProvider)


def test_get_ocr_provider_unknown_raises() -> None:
    os.environ["QA_OCR_PROVIDER"] = "tesseract"
    try:
        with pytest.raises(ValueError, match="tesseract"):
            get_ocr_provider()
    finally:
        os.environ["QA_OCR_PROVIDER"] = "mock"


# ─────────────────────────────────────────────────────────────────────────────
# 5. HTTP 端点 — TestClient + internal token
# ─────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def qa_client():
    """返回绑定了 internal-service token 的 TestClient。"""
    from app.main import app
    from fastapi.testclient import TestClient

    client = TestClient(app)
    yield client
    app.dependency_overrides = {}


def test_endpoint_preprocess_200(qa_client) -> None:
    resp = qa_client.post(
        "/api/v1/ai/qa/preprocess",
        json={"documentId": "doc-1", "fileUrl": "http://x.com/a.pdf", "fileType": "application/pdf"},
        headers=_INTERNAL_HEADERS,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    data = body["data"]
    assert "pages" in data
    assert len(data["pages"]) == 2
    page = data["pages"][0]
    assert "pageNo" in page and "width" in page and "height" in page and "imageUrl" in page


def test_endpoint_segment_200(qa_client) -> None:
    pages = [{"pageNo": 1, "width": 794, "height": 1123, "imageUrl": "/page1.png"}]
    resp = qa_client.post(
        "/api/v1/ai/qa/segment",
        json={"pages": pages, "granularity": "STANDARD"},
        headers=_INTERNAL_HEADERS,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    blocks = body["data"]["blocks"]
    assert len(blocks) >= 1
    b = blocks[0]
    assert "localRef" in b and "bbox" in b and "blockType" in b and "orderIndex" in b


def test_endpoint_ocr_200(qa_client) -> None:
    blocks = [{"localRef": "p1-b0", "pageNo": 1}]
    resp = qa_client.post(
        "/api/v1/ai/qa/ocr",
        json={"blocks": blocks},
        headers=_INTERNAL_HEADERS,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    results = body["data"]["results"]
    assert len(results) >= 1
    r = results[0]
    assert "ref" in r and "text" in r and "confidence" in r


def test_endpoint_structure_200(qa_client) -> None:
    blocks = [{"pageNo": 1, "sourceCropUrl": "/api/uploads/qa/doc/crops/p1-b0.png"}]
    resp = qa_client.post(
        "/api/v1/ai/qa/structure",
        json={"blocks": blocks, "granularity": "FINE"},
        headers=_INTERNAL_HEADERS,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    tree = body["data"]["tree"]
    assert len(tree) >= 1
    node = tree[0]
    # 校验 §3 canonical node 字段
    for field in ("stableKey", "blockType", "pageNo", "bbox", "confidence", "orderIndex", "children"):
        assert field in node, f"canonical node 缺少字段 {field}"


def test_endpoint_quality_check_200(qa_client) -> None:
    tree = [
        {"stableKey": "p1-b0-page", "blockType": "PAGE", "pageNo": 1,
         "confidence": 0.75, "children": [],
         "bbox": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
         "orderIndex": 0, "text": ""},
    ]
    resp = qa_client.post(
        "/api/v1/ai/qa/quality-check",
        json={"tree": tree},
        headers=_INTERNAL_HEADERS,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    issues = body["data"]["issues"]
    assert len(issues) >= 1
    issue = issues[0]
    assert "stableKey" in issue and "type" in issue and "message" in issue and "severity" in issue


def test_endpoint_agent_fix_200(qa_client) -> None:
    annotations = [
        {"stableKey": "p1-b0-stem", "originalText": "导树", "correctedText": "导数"}
    ]
    resp = qa_client.post(
        "/api/v1/ai/qa/agent-fix",
        json={"tree": [], "annotations": annotations, "crops": [], "ocr": []},
        headers=_INTERNAL_HEADERS,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    patch = body["data"]["patch"]
    assert "summary" in patch
    assert "operations" in patch
    ops = patch["operations"]
    assert len(ops) == 1
    assert ops[0]["op"] == "replace_text"
    assert ops[0]["stableKey"] == "p1-b0-stem"
    assert ops[0]["newValue"] == "导数"


def test_endpoint_requires_internal_token(qa_client) -> None:
    """未携带 X-Internal-Service 且无有效 JWT 时应返回 401 或 403。"""
    resp = qa_client.post(
        "/api/v1/ai/qa/preprocess",
        json={"documentId": "d", "fileUrl": "http://x.com/a.pdf", "fileType": "application/pdf"},
    )
    assert resp.status_code in (401, 403), f"期望 401/403，得到 {resp.status_code}"


def test_endpoint_wrong_token_rejected(qa_client) -> None:
    """错误的 internal token 应被拒绝（401 或 403）。"""
    resp = qa_client.post(
        "/api/v1/ai/qa/preprocess",
        json={"documentId": "d", "fileUrl": "http://x.com/a.pdf", "fileType": "application/pdf"},
        headers={"X-Internal-Service": "wrong-token"},
    )
    assert resp.status_code in (401, 403), f"期望 401/403，得到 {resp.status_code}"
