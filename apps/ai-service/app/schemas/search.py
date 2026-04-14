from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class PostRef(BaseModel):
    id: str
    title: str
    slug: str


class SemanticSearchResult(BaseModel):
    post: PostRef
    similarity: float
    highlight: Optional[str] = None


class SemanticSearchData(BaseModel):
    results: list[SemanticSearchResult]


class ReindexRequest(BaseModel):
    mode: str = Field(default="full")


class IndexRequest(BaseModel):
    action: str = Field(default="upsert", pattern="^(upsert|delete)$")
    postId: int
    title: str | None = None
    slug: str | None = None
    content: str | None = None
    metadata: dict | None = None
    # 由 Go backend 根据搜索配置 (search.index_post_timeout_sec) 透传，
    # 保证两端超时一致；None 时使用 ai-service 默认值。
    timeoutSec: int | None = Field(default=None, ge=10, le=600)
