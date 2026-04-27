# ref: §5.1 - AI provider 与 model 定义
"""
AI provider 与 model 的 SQLAlchemy 模型。
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """所有 model 的基类。"""
    pass


class ApiType(str, Enum):
    """支持的 API 类型。"""
    OPENAI_COMPAT = "openai_compat"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"
    AZURE = "azure"
    CUSTOM = "custom"


class ModelType(str, Enum):
    """AI model 类型。"""
    CHAT = "chat"
    EMBEDDING = "embedding"
    IMAGE = "image"
    AUDIO = "audio"
    REASONING = "reasoning"
    TTS = "tts"
    STT = "stt"
    REALTIME = "realtime"
    TEXT2VIDEO = "text2video"
    TEXT2MUSIC = "text2music"


class AiProvider(Base):
    """
    AI provider 定义。

    表示一个 AI 服务 provider,如 OpenAI、DeepSeek、Qwen 等。
    """
    __tablename__ = "ai_providers"
    __table_args__ = (
        Index("idx_ai_providers_code", "code"),
        Index("idx_ai_providers_enabled", "is_enabled"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(100))
    api_type: Mapped[str] = mapped_column(String(30), nullable=False, default=ApiType.OPENAI_COMPAT.value)
    base_url: Mapped[str | None] = mapped_column(String(500))
    doc_url: Mapped[str | None] = mapped_column(String(500))
    icon: Mapped[str | None] = mapped_column(String(200))
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    capabilities: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=dict)
    config_schema: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关联关系
    models: Mapped[list["AiModel"]] = relationship("AiModel", back_populates="provider", cascade="all, delete-orphan")
    credentials: Mapped[list["AiCredential"]] = relationship("AiCredential", back_populates="provider")

    def __repr__(self) -> str:
        return f"<AiProvider(code={self.code}, name={self.name})>"


class AiModel(Base):
    """
    AI model 注册。

    表示某个 provider 下的具体 model,例如 gpt-4o、deepseek-chat。
    """
    __tablename__ = "ai_models"
    __table_args__ = (
        UniqueConstraint("provider_id", "model_id", name="uq_ai_models_provider_model"),
        Index("idx_ai_models_provider", "provider_id"),
        Index("idx_ai_models_type", "model_type"),
        Index("idx_ai_models_enabled", "is_enabled"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    provider_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("ai_providers.id", ondelete="CASCADE"), nullable=False)
    model_id: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(100))
    model_type: Mapped[str] = mapped_column(String(30), nullable=False, default=ModelType.CHAT.value)
    context_window: Mapped[int | None] = mapped_column(Integer)
    max_output_tokens: Mapped[int | None] = mapped_column(Integer)
    input_cost_per_1k: Mapped[float | None] = mapped_column(Numeric(12, 8))
    output_cost_per_1k: Mapped[float | None] = mapped_column(Numeric(12, 8))
    capabilities: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=dict)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关联关系
    provider: Mapped["AiProvider"] = relationship("AiProvider", back_populates="models")

    def __repr__(self) -> str:
        return f"<AiModel(model_id={self.model_id}, provider_id={self.provider_id})>"


# 为解析 relationship 而 import
from app.models.credential import AiCredential  # noqa: E402, F401
