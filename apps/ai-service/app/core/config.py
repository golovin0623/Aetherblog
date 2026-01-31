from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# ref: §8.3.1
class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    env: str = Field(default="dev", alias="AI_ENV")
    host: str = Field(default="0.0.0.0", alias="AI_HOST")
    port: int = Field(default=8000, alias="AI_PORT")
    log_level: str = Field(default="info", alias="AI_LOG_LEVEL")
    mock_mode: bool = Field(default=True, alias="AI_MOCK_MODE")

    jwt_mode: Literal["HMAC", "JWKS"] = Field(default="HMAC", alias="AI_JWT_MODE")
    jwt_secret: str = Field(default="change-me", alias="AI_JWT_SECRET")
    jwt_jwks_url: str | None = Field(default=None, alias="AI_JWT_JWKS_URL")
    jwt_issuer: str | None = Field(default=None, alias="AI_JWT_ISSUER")
    jwt_audience: str | None = Field(default=None, alias="AI_JWT_AUDIENCE")

    rate_limit_user_per_min: int = Field(default=10, alias="AI_RATE_LIMIT_USER_PER_MIN")
    rate_limit_global_per_min: int = Field(default=100, alias="AI_RATE_LIMIT_GLOBAL_PER_MIN")

    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    postgres_dsn: str = Field(
        default="postgresql://aetherblog:aetherblog123@localhost:5432/aetherblog",
        alias="POSTGRES_DSN",
    )
    vector_dim: int = Field(default=1536, alias="AI_VECTOR_DIM")
    search_threshold: float = Field(default=0.6, alias="AI_SEARCH_THRESHOLD")
    reindex_batch_size: int = Field(default=200, alias="AI_REINDEX_BATCH")

    default_provider: str = Field(default="openai", alias="AI_DEFAULT_PROVIDER")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_base_url: str = Field(default="https://api.openai.com", alias="OPENAI_BASE_URL")
    openai_compat_base_url: str | None = Field(default=None, alias="OPENAI_COMPAT_BASE_URL")
    openai_compat_api_key: str | None = Field(default=None, alias="OPENAI_COMPAT_API_KEY")

    model_summary: str = Field(default="gemini-3-flash-preview", alias="MODEL_SUMMARY")
    model_tags: str = Field(default="claude-haiku-4-5-20251001", alias="MODEL_TAGS")
    model_titles: str = Field(default="claude-haiku-4-5-20251001", alias="MODEL_TITLES")
    model_polish: str = Field(default="gpt-5.2", alias="MODEL_POLISH")
    model_outline: str = Field(default="gemini-3-pro-preview", alias="MODEL_OUTLINE")
    model_embedding: str = Field(default="text-embedding-3-small", alias="MODEL_EMBEDDING")
    max_input_chars: int = Field(default=20000, alias="AI_MAX_INPUT_CHARS")

    @field_validator("jwt_jwks_url", "jwt_issuer", "jwt_audience", mode="before")
    @classmethod
    def _empty_str_to_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
