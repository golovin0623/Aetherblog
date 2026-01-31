# ref: §5.1 - AI Provider and Model definitions
"""
SQLAlchemy models for AI providers and models.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all models."""
    pass


class ApiType(str, Enum):
    """Supported API types."""
    OPENAI_COMPAT = "openai_compat"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"
    AZURE = "azure"
    CUSTOM = "custom"


class ModelType(str, Enum):
    """AI model types."""
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
    AI Provider definition.
    
    Represents an AI service provider like OpenAI, DeepSeek, Qwen, etc.
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

    # Relationships
    models: Mapped[list["AiModel"]] = relationship("AiModel", back_populates="provider", cascade="all, delete-orphan")
    credentials: Mapped[list["AiCredential"]] = relationship("AiCredential", back_populates="provider")

    def __repr__(self) -> str:
        return f"<AiProvider(code={self.code}, name={self.name})>"


class AiModel(Base):
    """
    AI Model registration.
    
    Represents a specific model from a provider, e.g., gpt-4o, deepseek-chat.
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

    # Relationships
    provider: Mapped["AiProvider"] = relationship("AiProvider", back_populates="models")

    def __repr__(self) -> str:
        return f"<AiModel(model_id={self.model_id}, provider_id={self.provider_id})>"


# Import for relationship resolution
from app.models.credential import AiCredential  # noqa: E402, F401
