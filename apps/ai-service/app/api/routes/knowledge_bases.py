"""ai-service · /api/v1/kb/* 路由 —— 知识库向量化执行端点。

被 Go 后端的 KBIndexerClient（apps/server-go/internal/service/kb_indexer_client.go）调用。
仅允许 X-Internal-Service token；与 search.py /admin/search/* 同套通道。
"""
from __future__ import annotations

import base64
import logging
import math
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_llm_router, get_pg_pool, require_admin_or_internal
from app.schemas.common import ApiResponse
from app.services.kb_indexer import KBIndexerService
from app.services.kb_recall import KBRecallUnavailable, recall_kbs

router = APIRouter()
logger = logging.getLogger("ai-service")


class KBIndexRequest(BaseModel):
    """Go 后端推送的索引请求体。

    重要：pydantic v2 的 ``bytes`` 字段在 JSON input 下不会自动 base64 解码 —— 它把
    JSON 字符串原样 UTF-8 编码为 bytes。所以这里用 ``str`` 接收 base64 文本，
    在 endpoint 内显式 base64.b64decode。Go 端 ``encoding/json`` 对 []byte 字段默认
    使用 base64 编码，对端必须显式解码。

    targetProfileId / targetStatus：蓝绿迁移使用。
    """
    filename: str | None = Field(default=None, max_length=255)
    mimeType: str | None = Field(default=None, max_length=128)
    contentBytes: str = Field(default="", description="原始字节的 base64 编码")
    targetProfileId: int | None = Field(default=None, description="蓝绿目标 profile，默认 active")
    targetStatus: str = Field(default="active", pattern="^(active|shadow)$")


class KBIndexResponseData(BaseModel):
    kbFileId: int
    profileId: int
    chunkCount: int
    docChars: int
    docTokens: int
    status: str
    error: str = ""


class KBRetrieveRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    query: str = Field(min_length=2, max_length=500)
    limit: int = Field(default=5, ge=1, le=10)


class KBRetrieveHit(BaseModel):
    title: str
    snippet: str
    score: float = Field(ge=0, le=1)
    fileId: int
    chunkIndex: int


class KBRetrieveResponseData(BaseModel):
    status: Literal["matched", "empty", "unavailable"]
    query: str
    hits: list[KBRetrieveHit]


@router.post(
    "/api/v1/kb/{kb_id}/files/{file_id}/index",
    response_model=ApiResponse[KBIndexResponseData],
)
async def index_kb_file(
    kb_id: int,
    file_id: int,
    req: KBIndexRequest,
    user=Depends(require_admin_or_internal),
    pool=Depends(get_pg_pool),
    llm=Depends(get_llm_router),
) -> ApiResponse[KBIndexResponseData]:
    """单文件向量化。Go 端把媒体字节 base64 编码塞进 contentBytes 一同推上来。

    Go 端在收到响应后会按 status='SUCCEEDED'/'FAILED' + chunkCount / error 更新 kb_files 状态。
    """
    # 显式 base64 解码 —— Go encoding/json 把 []byte 字段默认序列化为 base64 字符串。
    # pydantic v2 的 ``bytes`` 字段在 JSON 输入下并不会自动 base64 解码（会按 UTF-8 当成
    # 原始字符存进 bytes），所以必须在这里手动 decode。
    # validate=True（review chatgpt-codex P2 修复）：不容忍非 base64 字符
    # 静默剔除 —— 否则传输损坏 / caller 错误编码会得到诡异 chunks 而无任何错误信号。
    try:
        content: bytes = base64.b64decode(req.contentBytes or "", validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"contentBytes base64 解码失败（含非法字符）: {exc}")
    # 上限保护：单文件 10MB（与 Go 端 kbMaxBytes 对齐）
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="文件过大，单文件向量化上限 10MB")

    svc = KBIndexerService(pool=pool, llm=llm)
    outcome = await svc.vectorize(
        kb_id=kb_id,
        kb_file_id=file_id,
        content_bytes=content,
        mime_type=req.mimeType,
        filename=req.filename,
        target_profile_id=req.targetProfileId,
        target_status=req.targetStatus,
    )
    return ApiResponse(data=KBIndexResponseData(
        kbFileId=outcome.kb_file_id,
        profileId=outcome.profile_id,
        chunkCount=outcome.chunk_count,
        docChars=outcome.doc_chars,
        docTokens=outcome.doc_tokens,
        status=outcome.status,
        error=outcome.error,
    ))


@router.post("/api/v1/kb/{kb_id}/reindex", response_model=ApiResponse[dict])
async def reindex_all(
    kb_id: int,
    user=Depends(require_admin_or_internal),
    pool=Depends(get_pg_pool),
) -> ApiResponse[dict]:
    """Phase 1：仅给 Go 端一个 ack 起点。Go 端会逐文件再次发 index 请求。

    Phase 2：本端点会改为 SSE，按 chunk reindex 进度推流。
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT COUNT(*) AS n FROM kb_files WHERE kb_id = $1", kb_id)
    return ApiResponse(data={
        "kbId": kb_id,
        "filesQueued": int(row["n"]) if row else 0,
        "phase": "ack",
        "message": "Phase 1: 请由 Go 端逐文件重发 index 请求；Phase 2 将提供 SSE 进度",
    })


@router.post(
    "/api/v1/kb/{kb_id}/retrieve",
    response_model=ApiResponse[KBRetrieveResponseData],
)
async def retrieve_kb(
    kb_id: int,
    req: KBRetrieveRequest,
    _user=Depends(require_admin_or_internal),
    pool=Depends(get_pg_pool),
    llm=Depends(get_llm_router),
) -> ApiResponse[KBRetrieveResponseData]:
    """Run a strict, single-KB retrieval used by the admin verification surface.

    Authorization to USE this KB is enforced by Go before this internal-token call.
    This endpoint deliberately returns ``unavailable`` for failed retrieval rather
    than disguising it as a legitimate zero-hit search.
    """
    try:
        hits = await recall_kbs(
            pool,
            llm,
            kb_ids=[kb_id],
            query=req.query,
            top_k_total=req.limit,
            strict=True,
        )
    except Exception as exc:
        # Full details stay in server logs. The response is intentionally stable and
        # contains no database/provider host, credentials, or exception text.
        if isinstance(exc, KBRecallUnavailable):
            logger.warning("kb_retrieve.unavailable", extra={"data": {"kb_id": kb_id}})
        else:
            logger.error("kb_retrieve.failed", extra={"data": {
                "kb_id": kb_id,
                "error_type": type(exc).__name__,
            }})
        return ApiResponse(data=KBRetrieveResponseData(
            status="unavailable",
            query=req.query,
            hits=[],
        ))

    response_hits: list[KBRetrieveHit] = []
    for hit in hits:
        if not math.isfinite(hit.similarity):
            continue
        response_hits.append(KBRetrieveHit(
            title=(hit.file_title or "未命名资料")[:240],
            snippet=hit.snippet.strip()[:2000],
            score=min(1.0, max(0.0, hit.similarity)),
            fileId=hit.kb_file_id,
            chunkIndex=hit.chunk_index,
        ))

    return ApiResponse(data=KBRetrieveResponseData(
        status="matched" if response_hits else "empty",
        query=req.query,
        hits=response_hits,
    ))


__all__ = [
    "router",
    "KBIndexRequest",
    "KBIndexResponseData",
    "KBRetrieveRequest",
    "KBRetrieveResponseData",
]
