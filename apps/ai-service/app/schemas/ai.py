from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class SummaryRequest(BaseModel):
    content: str = Field(..., min_length=1)
    maxLength: int = Field(default=200, ge=10, le=2000)
    promptVersion: Optional[str] = None


class TagsRequest(BaseModel):
    content: str = Field(..., min_length=1)
    maxTags: int = Field(default=5, ge=1, le=20)
    promptVersion: Optional[str] = None


class TitlesRequest(BaseModel):
    content: str = Field(..., min_length=1)
    maxTitles: int = Field(default=5, ge=1, le=10)
    promptVersion: Optional[str] = None


class PolishRequest(BaseModel):
    content: str = Field(..., min_length=1)
    tone: Optional[str] = None
    promptVersion: Optional[str] = None


class OutlineRequest(BaseModel):
    content: str = Field(..., min_length=1)
    depth: int = Field(default=3, ge=1, le=6)
    promptVersion: Optional[str] = None


class SummaryData(BaseModel):
    summary: str
    characterCount: int


class TagsData(BaseModel):
    tags: list[str]


class TitlesData(BaseModel):
    titles: list[str]


class PolishData(BaseModel):
    content: str


class OutlineData(BaseModel):
    outline: str
