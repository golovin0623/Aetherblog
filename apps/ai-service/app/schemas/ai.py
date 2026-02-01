from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, model_validator


class SummaryRequest(BaseModel):
    content: str = Field(..., min_length=1)
    maxLength: int = Field(default=200, ge=10, le=2000)
    promptVersion: Optional[str] = None
    promptTemplate: Optional[str] = None
    modelId: Optional[str] = None
    providerCode: Optional[str] = None


class TagsRequest(BaseModel):
    content: str = Field(..., min_length=1)
    maxTags: int = Field(default=5, ge=1, le=20)
    promptVersion: Optional[str] = None
    promptTemplate: Optional[str] = None
    modelId: Optional[str] = None
    providerCode: Optional[str] = None


class TitlesRequest(BaseModel):
    content: str = Field(..., min_length=1)
    maxTitles: int = Field(default=5, ge=1, le=10)
    promptVersion: Optional[str] = None
    promptTemplate: Optional[str] = None
    modelId: Optional[str] = None
    providerCode: Optional[str] = None


class PolishRequest(BaseModel):
    content: str = Field(..., min_length=1)
    tone: Optional[str] = None
    promptVersion: Optional[str] = None
    promptTemplate: Optional[str] = None
    modelId: Optional[str] = None
    providerCode: Optional[str] = None


class OutlineRequest(BaseModel):
    topic: Optional[str] = Field(default=None, min_length=1)
    content: Optional[str] = None
    existingContent: Optional[str] = None
    depth: int = Field(default=2, ge=1, le=6)
    style: str = Field(default="professional")
    promptVersion: Optional[str] = None
    promptTemplate: Optional[str] = None
    modelId: Optional[str] = None
    providerCode: Optional[str] = None

    @model_validator(mode="after")
    def validate_topic_or_content(self):
        if not self.topic and not self.content:
            raise ValueError("topic or content is required")
        return self


class SummaryData(BaseModel):
    summary: str
    characterCount: int
    model: Optional[str] = None
    tokensUsed: Optional[int] = None
    latencyMs: Optional[int] = None


class TagsData(BaseModel):
    tags: list[str]


class TitlesData(BaseModel):
    titles: list[str]


class PolishData(BaseModel):
    polishedContent: str = Field(alias="polishedContent")
    changes: Optional[str] = None
    model: Optional[str] = None
    tokensUsed: Optional[int] = None
    latencyMs: Optional[int] = None

    class Config:
        populate_by_name = True


class OutlineData(BaseModel):
    outline: str


class TranslateRequest(BaseModel):
    content: str = Field(..., min_length=1)
    targetLanguage: str = Field(default="en")
    sourceLanguage: Optional[str] = None
    promptVersion: Optional[str] = None
    promptTemplate: Optional[str] = None
    modelId: Optional[str] = None
    providerCode: Optional[str] = None


class TranslateData(BaseModel):
    translatedContent: str
    sourceLanguage: Optional[str] = None
    targetLanguage: str
    model: Optional[str] = None
    tokensUsed: Optional[int] = None
    latencyMs: Optional[int] = None
