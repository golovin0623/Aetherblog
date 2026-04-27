# ref: §5.1 - AI 凭证管理
"""
AI API 凭证的 SQLAlchemy 模型。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.provider import Base

if TYPE_CHECKING:
    from app.models.provider import AiProvider


class AiCredential(Base):
    """
    AI API 凭证。

    存储用户/团队的加密 API key。
    """
    __tablename__ = "ai_credentials"
    __table_args__ = (
        Index("idx_ai_credentials_user", "user_id"),
        Index("idx_ai_credentials_provider", "provider_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(BigInteger)  # 指向 users 表的外键 (位于 blog 库)
    provider_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("ai_providers.id"), nullable=False)
    name: Mapped[str | None] = mapped_column(String(100))
    api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    api_key_hint: Mapped[str | None] = mapped_column(String(20))
    base_url_override: Mapped[str | None] = mapped_column(String(500))
    extra_config: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关联关系
    provider: Mapped["AiProvider"] = relationship("AiProvider", back_populates="credentials")

    def __repr__(self) -> str:
        return f"<AiCredential(id={self.id}, provider_id={self.provider_id}, hint={self.api_key_hint})>"
