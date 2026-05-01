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
    content: str = Field(..., min_length=1, max_length=100000)
    maxLength: int = Field(default=200, ge=10, le=2000)
    promptVersion: Optional[str] = None
    promptTemplate: Optional[str] = None
    modelId: Optional[str] = None
    providerCode: Optional[str] = None
    bypassCache: bool = False


class ExistingTagHint(BaseModel):
    """已有标签提示。前端在请求生成标签时携带,让 AI 优先复用而非新建。

    `name` 是标签人类可读名;`postCount` 是该标签关联的文章数,用于在 prompt 中
    按热度排序展示给模型,也用于前端 UI 渲染时的"热门度"徽标。
    """

    name: str = Field(..., min_length=1, max_length=64)
    postCount: int = Field(default=0, ge=0)


class TagMatch(BaseModel):
    """AI 命中的"现有标签"。`reason` 是模型可选给出的一句话匹配理由。"""

    name: str
    postCount: int = 0
    reason: Optional[str] = None


class TagsRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=100000)
    maxTags: int = Field(default=5, ge=1, le=20)
    promptVersion: Optional[str] = None
    promptTemplate: Optional[str] = None
    modelId: Optional[str] = None
    providerCode: Optional[str] = None
    bypassCache: bool = False
    # 现有标签库提示。可选;为空时退化为旧行为 (纯新建议)。
    # 上限 200 项是 prompt 体积 + token 成本的工程取舍:典型博客标签数 < 100,
    # 极端情况下也能容纳大型站点的高频段。前端按 postCount DESC 截断。
    existingTags: list[ExistingTagHint] = Field(default_factory=list, max_length=200)


class TitlesRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=100000)
    maxTitles: int = Field(default=5, ge=1, le=10)
    promptVersion: Optional[str] = None
    promptTemplate: Optional[str] = None
    modelId: Optional[str] = None
    providerCode: Optional[str] = None
    bypassCache: bool = False
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
    content: str = Field(..., min_length=1, max_length=100000)
    tone: Optional[str] = None
    promptVersion: Optional[str] = None
    promptTemplate: Optional[str] = None
    modelId: Optional[str] = None
    providerCode: Optional[str] = None
    bypassCache: bool = False
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
    bypassCache: bool = False

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
    """标签生成结果。

    - ``tags``:    扁平字符串数组,匹配 + 新建议合并 (保留旧契约,旧客户端不动)。
    - ``matches``: 命中现有标签的结构化列表 (含 ``postCount`` / ``reason``)。
    - ``suggestions``: 现有标签库未覆盖,需要新建的标签名。

    新客户端应优先消费 ``matches`` / ``suggestions``;``tags`` 仅作向后兼容。
    """

    tags: list[str]
    matches: list[TagMatch] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
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
    content: str = Field(..., min_length=1, max_length=100000)
    targetLanguage: str = Field(default="en")
    sourceLanguage: Optional[str] = None
    promptVersion: Optional[str] = None
    promptTemplate: Optional[str] = None
    modelId: Optional[str] = None
    providerCode: Optional[str] = None
    bypassCache: bool = False


class TranslateData(BaseModel):
    translatedContent: str
    sourceLanguage: Optional[str] = None
    targetLanguage: str
    model: Optional[str] = None
    tokensUsed: Optional[int] = None
    latencyMs: Optional[int] = None
