from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# 计算项目根目录的 .env 路径 (apps/ai-service/app/core/config.py -> 根目录)
# 在开发环境中使用根 .env，在 Docker 容器中该文件不存在时会被忽略
def _find_env_file() -> str | None:
    """
    查找 .env 文件，兼容开发环境和 Docker 容器。
    - 开发环境: /path/to/AetherBlog/apps/ai-service/app/core/config.py -> parents[4] = /path/to/AetherBlog
    - Docker: /app/app/core/config.py -> parents[4] 不存在，直接使用环境变量
    """
    try:
        root_env = Path(__file__).resolve().parents[4] / ".env"
        if root_env.exists():
            return str(root_env)
    except IndexError:
        pass  # Docker 容器中路径层级不够
    
    # 检查当前目录 .env (备选)
    if Path(".env").exists():
        return ".env"
    
    # 无 .env 文件，完全依赖环境变量
    return None

_ENV_FILE = _find_env_file()


# ref: §8.3.1
class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,  # None 表示不使用 .env 文件，依赖环境变量
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",  # 忽略根 .env 中不认识的其他服务配置项
    )

    env: str = Field(default="dev", alias="AI_ENV")
    host: str = Field(default="0.0.0.0", alias="AI_HOST")
    port: int = Field(default=8000, alias="AI_PORT")
    log_level: str = Field(default="info", alias="AI_LOG_LEVEL")
    mock_mode: bool = Field(default=True, alias="AI_MOCK_MODE")

    jwt_mode: Literal["HMAC", "JWKS"] = Field(default="HMAC", validation_alias="AI_JWT_MODE")
    jwt_secret: str = Field(..., validation_alias="JWT_SECRET")  # 必须通过环境变量提供，与后端共用
    jwt_jwks_url: str | None = Field(default=None, validation_alias="AI_JWT_JWKS_URL")
    jwt_issuer: str | None = Field(default=None, validation_alias="AI_JWT_ISSUER")
    jwt_audience: str | None = Field(default=None, validation_alias="AI_JWT_AUDIENCE")

    rate_limit_user_per_min: int = Field(default=10, alias="AI_RATE_LIMIT_USER_PER_MIN")
    rate_limit_global_per_min: int = Field(default=100, alias="AI_RATE_LIMIT_GLOBAL_PER_MIN")

    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    postgres_dsn: str = Field(
        ...,
        alias="POSTGRES_DSN",
    )
    vector_dim: int = Field(default=1536, alias="AI_VECTOR_DIM")
    search_threshold: float = Field(default=0.6, alias="AI_SEARCH_THRESHOLD")
    reindex_batch_size: int = Field(default=200, alias="AI_REINDEX_BATCH")
    usage_log_failure_alert_threshold: int = Field(default=10, alias="AI_USAGE_LOG_FAILURE_ALERT_THRESHOLD")
    usage_log_failure_sample_limit: int = Field(default=50, alias="AI_USAGE_LOG_FAILURE_SAMPLE_LIMIT")

    default_provider: str = Field(default="openai", alias="AI_DEFAULT_PROVIDER")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_base_url: str = Field(default="https://api.openai.com", alias="OPENAI_BASE_URL")
    openai_compat_base_url: str | None = Field(default=None, alias="OPENAI_COMPAT_BASE_URL")
    openai_compat_api_key: str | None = Field(default=None, alias="OPENAI_COMPAT_API_KEY")

    model_summary: str = Field(default="gpt-5-mini", alias="MODEL_SUMMARY")
    model_tags: str = Field(default="gpt-5-mini", alias="MODEL_TAGS")
    model_titles: str = Field(default="gpt-5-mini", alias="MODEL_TITLES")
    model_polish: str = Field(default="gpt-5-mini", alias="MODEL_POLISH")
    model_outline: str = Field(default="gpt-5-mini", alias="MODEL_OUTLINE")
    model_translate: str = Field(default="gpt-5-mini", alias="MODEL_TRANSLATE")
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

    @field_validator("postgres_dsn", mode="before")
    @classmethod
    def _fix_postgres_dsn(cls, value: str) -> str:
        if isinstance(value, str) and value.startswith("postgresql+asyncpg://"):
            return value.replace("postgresql+asyncpg://", "postgresql://", 1)
        return value


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
