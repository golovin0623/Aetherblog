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


# ============================================================
# 搜索配置 DTOs (数据迁移 000041)
# ============================================================


class SearchProfileResponse(BaseModel):
    """search_profiles 表行的 API 视图。"""

    id: int
    code: str
    name: str
    description: str | None = None
    modelId: str
    chunkerKind: str
    chunkSizeTokens: int
    chunkOverlapTokens: int
    status: str  # 'active' | 'shadow' | 'deprecated'
    createdAt: str | None = None
    updatedAt: str | None = None


class CreateSearchProfileRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    modelId: str = Field(min_length=1, max_length=120)
    chunkerKind: str = Field(default="recursive")
    chunkSizeTokens: int = Field(default=512, ge=64, le=8192)
    chunkOverlapTokens: int = Field(default=64, ge=0, le=2048)

