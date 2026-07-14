from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services import kb_recall


class _Conn:
    _DEFAULT = object()

    def __init__(self, *, rows=None, kb=_DEFAULT):
        self.rows = rows or []
        self.kb = (
            {"slug": "support", "name": "客服资料", "kind": "CUSTOM"}
            if kb is self._DEFAULT
            else kb
        )

    async def fetchrow(self, query, *_args):
        if "FROM knowledge_bases" in query:
            return self.kb
        return None

    async def fetch(self, *_args):
        return self.rows


class _Acquire:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, *_args):
        return None


class _Pool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        return _Acquire(self.conn)


class _FailingLLM:
    async def embed(self, *_args, **_kwargs):
        raise RuntimeError("provider host and secret must never reach clients")


class _LLM:
    async def embed(self, *_args, **_kwargs):
        return [0.1, 0.2, 0.3]


@pytest.fixture
def active_profile(monkeypatch):
    async def _profile(_pool, _kb_id):
        return SimpleNamespace(id=8, model_id="embedding-test", top_k=5, score_threshold=0.2)

    monkeypatch.setattr(kb_recall, "fetch_kb_active_profile", _profile)


@pytest.mark.asyncio
async def test_recall_default_keeps_agent_compatibility_when_embedding_fails(active_profile):
    result = await kb_recall.recall_kbs(
        _Pool(_Conn()),
        _FailingLLM(),
        kb_ids=[7],
        query="退款规则是什么？",
    )

    assert result == []


@pytest.mark.asyncio
async def test_recall_strict_reports_unavailable_instead_of_empty(active_profile, caplog):
    with pytest.raises(kb_recall.KBRecallUnavailable):
        await kb_recall.recall_kbs(
            _Pool(_Conn()),
            _FailingLLM(),
            kb_ids=[7],
            query="退款规则是什么？",
            strict=True,
        )
    assert "provider host and secret" not in caplog.text


@pytest.mark.asyncio
async def test_recall_strict_rejects_partial_multi_kb_success(monkeypatch):
    async def profile(_pool, kb_id):
        if kb_id == 8:
            raise RuntimeError("second selected knowledge base is temporarily unavailable")
        return SimpleNamespace(id=8, model_id="embedding-test", top_k=5, score_threshold=0.2)

    monkeypatch.setattr(kb_recall, "fetch_kb_active_profile", profile)

    with pytest.raises(kb_recall.KBRecallUnavailable):
        await kb_recall.recall_kbs(
            _Pool(_Conn(rows=[])),
            _LLM(),
            kb_ids=[7, 8],
            query="两个指定知识库都必须完成检索",
            strict=True,
        )


@pytest.mark.asyncio
async def test_recall_strict_returns_true_empty_after_successful_search(active_profile):
    result = await kb_recall.recall_kbs(
        _Pool(_Conn(rows=[])),
        _LLM(),
        kb_ids=[7],
        query="退款规则是什么？",
        strict=True,
    )

    assert result == []


@pytest.mark.asyncio
async def test_recall_strict_treats_missing_kb_as_unavailable():
    with pytest.raises(kb_recall.KBRecallUnavailable):
        await kb_recall.recall_kbs(
            _Pool(_Conn(kb={})),
            _LLM(),
            kb_ids=[404],
            query="退款规则是什么？",
            strict=True,
        )
