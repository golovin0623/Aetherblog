from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.api.deps import get_llm_router, get_pg_pool, require_admin_or_internal
from app.api.routes import knowledge_bases
from app.main import app
from app.services.kb_recall import KBHit, KBRecallUnavailable


def _client(monkeypatch, recall):
    app.dependency_overrides[require_admin_or_internal] = lambda: {"user_id": "system"}
    app.dependency_overrides[get_pg_pool] = lambda: object()
    app.dependency_overrides[get_llm_router] = lambda: object()
    monkeypatch.setattr(knowledge_bases, "recall_kbs", recall)
    return TestClient(app)


def test_retrieve_returns_ranked_hits_for_only_the_path_kb(monkeypatch):
    recall = AsyncMock(return_value=[
        KBHit(
            kb_id=7,
            kb_slug="support",
            kb_name="客服资料",
            kb_file_id=11,
            file_title="退款政策.md",
            chunk_index=3,
            snippet="下单后七天内可申请退款。",
            similarity=0.91,
        )
    ])
    client = _client(monkeypatch, recall)
    try:
        response = client.post("/api/v1/kb/7/retrieve", json={"query": "退款规则是什么？", "limit": 5})
    finally:
        app.dependency_overrides = {}

    assert response.status_code == 200
    assert response.json()["data"] == {
        "status": "matched",
        "query": "退款规则是什么？",
        "hits": [{
            "title": "退款政策.md",
            "snippet": "下单后七天内可申请退款。",
            "score": 0.91,
            "fileId": 11,
            "chunkIndex": 3,
        }],
    }
    recall.assert_awaited_once()
    assert recall.await_args.kwargs["kb_ids"] == [7]
    assert recall.await_args.kwargs["top_k_total"] == 5
    assert recall.await_args.kwargs["strict"] is True


def test_retrieve_distinguishes_empty_from_unavailable(monkeypatch, caplog):
    empty = AsyncMock(return_value=[])
    client = _client(monkeypatch, empty)
    try:
        empty_response = client.post("/api/v1/kb/7/retrieve", json={"query": "退款规则是什么？"})
        unavailable = AsyncMock(side_effect=KBRecallUnavailable("postgresql://secret-host"))
        monkeypatch.setattr(knowledge_bases, "recall_kbs", unavailable)
        unavailable_response = client.post("/api/v1/kb/7/retrieve", json={"query": "退款规则是什么？"})
    finally:
        app.dependency_overrides = {}

    assert empty_response.json()["data"]["status"] == "empty"
    payload = unavailable_response.json()["data"]
    assert payload == {"status": "unavailable", "query": "退款规则是什么？", "hits": []}
    assert "secret-host" not in unavailable_response.text
    assert "secret-host" not in caplog.text


def test_retrieve_rejects_blank_overlong_query_and_out_of_range_limit(monkeypatch):
    client = _client(monkeypatch, AsyncMock(return_value=[]))
    try:
        blank = client.post("/api/v1/kb/7/retrieve", json={"query": "   "})
        overlong = client.post("/api/v1/kb/7/retrieve", json={"query": "x" * 501})
        too_many = client.post("/api/v1/kb/7/retrieve", json={"query": "valid question", "limit": 11})
    finally:
        app.dependency_overrides = {}

    # The app's global validation handler intentionally normalizes FastAPI's
    # validation status to the public API's 400 contract.
    assert blank.status_code == 400
    assert overlong.status_code == 400
    assert too_many.status_code == 400
