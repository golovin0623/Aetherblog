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
