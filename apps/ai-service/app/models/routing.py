# ref: §5.1 - AI Task Routing
"""
SQLAlchemy models for AI task types and routing configuration.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.provider import Base

if TYPE_CHECKING:
    from app.models.provider import AiModel


class AiTaskType(Base):
    """
    AI Task Type definition.
    
    Defines task types like 'summary', 'tags', 'polish', etc.
    """
    __tablename__ = "ai_task_types"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    default_model_type: Mapped[str] = mapped_column(String(30), default="chat")
    default_temperature: Mapped[float | None] = mapped_column(Numeric(3, 2), default=0.7)
    default_max_tokens: Mapped[int | None] = mapped_column(Integer)
    config_schema: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    prompt_template: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    routings: Mapped[list["AiTaskRouting"]] = relationship("AiTaskRouting", back_populates="task_type")

    def __repr__(self) -> str:
        return f"<AiTaskType(code={self.code}, name={self.name})>"


class AiTaskRouting(Base):
    """
    AI Task Routing configuration.
    
    Maps task types to models with support for user-level overrides.
    Priority: user_id specified > user_id NULL (system default)
    """
    __tablename__ = "ai_task_routing"
    __table_args__ = (
        Index("idx_ai_task_routing_user", "user_id"),
        Index("idx_ai_task_routing_task", "task_type_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(BigInteger)  # NULL = system default
    task_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("ai_task_types.id"), nullable=False)
    primary_model_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("ai_models.id"))
    fallback_model_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("ai_models.id"))
    credential_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("ai_credentials.id"))
    config_override: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=dict)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    task_type: Mapped["AiTaskType"] = relationship("AiTaskType", back_populates="routings")
    primary_model: Mapped["AiModel | None"] = relationship("AiModel", foreign_keys=[primary_model_id])
    fallback_model: Mapped["AiModel | None"] = relationship("AiModel", foreign_keys=[fallback_model_id])

    def __repr__(self) -> str:
        return f"<AiTaskRouting(task_type_id={self.task_type_id}, user_id={self.user_id})>"
