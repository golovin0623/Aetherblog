from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

LEGACY_POLISH_TONES = {
    "professional": "专业",
    "casual": "轻松自然",
    "technical": "技术严谨",
    "grammar": "严谨准确",
    "clarity": "清晰易懂",
    "style": "自然流畅",
    "all": "专业",
}


def _normalize_tone(value: object | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return LEGACY_POLISH_TONES.get(text.lower(), text)


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
    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_fields(cls, values):
        if not isinstance(values, dict):
            return values
        normalized = dict(values)
        if normalized.get("maxTitles") in (None, "") and normalized.get("count") not in (None, ""):
            normalized["maxTitles"] = normalized["count"]
        return normalized


class PolishRequest(BaseModel):
    content: str = Field(..., min_length=1)
    tone: Optional[str] = None
    promptVersion: Optional[str] = None
    promptTemplate: Optional[str] = None
    modelId: Optional[str] = None
    providerCode: Optional[str] = None
    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_fields(cls, values):
        if not isinstance(values, dict):
            return values
        normalized = dict(values)
        tone = _normalize_tone(normalized.get("tone"))
        if tone is None:
            tone = _normalize_tone(normalized.get("style"))
        if tone is None:
            tone = _normalize_tone(normalized.get("polishType"))
        if tone is not None:
            normalized["tone"] = tone
        return normalized


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
    model: Optional[str] = None
    tokensUsed: Optional[int] = None
    latencyMs: Optional[int] = None


class TitlesData(BaseModel):
    titles: list[str]
    model: Optional[str] = None
    tokensUsed: Optional[int] = None
    latencyMs: Optional[int] = None


class PolishData(BaseModel):
    polishedContent: str = Field(alias="polishedContent")
    # Note: 历史上曾设计过 `changes: Optional[str]` 用于返回"变更说明"，但端点
    # 从未写入该字段，前端也无法区分"LLM 真返回了空" vs "该字段被放弃"，
    # 长期停留在接口文档中反而误导消费者。2026-04 的 AI 工具修复已将其移除。
    # 若未来需要 diff/变更说明，请通过独立的 `/api/v1/ai/polish/diff` 端点提供。
    model: Optional[str] = None
    tokensUsed: Optional[int] = None
    latencyMs: Optional[int] = None

    class Config:
        populate_by_name = True


class OutlineData(BaseModel):
    outline: str
    characterCount: int
    model: Optional[str] = None
    tokensUsed: Optional[int] = None
    latencyMs: Optional[int] = None


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
