from __future__ import annotations

from pathlib import Path
from typing import Literal

from cryptography.fernet import Fernet
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
    log_path: str = Field(default="./logs", alias="AI_LOG_PATH")
    mock_mode: bool = Field(default=True, alias="AI_MOCK_MODE")

    jwt_mode: Literal["HMAC", "JWKS"] = Field(default="HMAC", validation_alias="AI_JWT_MODE")
    jwt_secret: str = Field(..., validation_alias="JWT_SECRET")  # 必须通过环境变量提供，与后端共用
    jwt_jwks_url: str | None = Field(default=None, validation_alias="AI_JWT_JWKS_URL")
    jwt_issuer: str | None = Field(default=None, validation_alias="AI_JWT_ISSUER")
    jwt_audience: str | None = Field(default=None, validation_alias="AI_JWT_AUDIENCE")
    internal_service_token: str = Field(..., validation_alias="AI_INTERNAL_SERVICE_TOKEN")

    # SECURITY (VULN-056): credential encryption key MUST be independent of
    # JWT_SECRET. Stored as a raw string in env (pydantic-settings auto-decodes
    # ``list`` fields as JSON, which breaks comma-separated values); the parsed
    # list is exposed via the ``ai_credential_encryption_keys`` property below.
    # First key is used for new encryption, all keys are tried for decryption
    # (zero-downtime rotation via MultiFernet). Generate with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    ai_credential_encryption_keys_raw: str = Field(
        default="",
        validation_alias="AI_CREDENTIAL_ENCRYPTION_KEYS",
    )

    @field_validator("internal_service_token")
    @classmethod
    def _validate_token_strength(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("AI_INTERNAL_SERVICE_TOKEN must be at least 32 characters")
        return v

    @staticmethod
    def _pad_b64url(key: str) -> str:
        """Restore missing base64url '=' padding on a Fernet key.

        一个标准 Fernet 密钥是 32 字节经 urlsafe-base64 编码 —— 完整形态 44 字符、
        末尾带 '=' padding。实际运维里常见的失效场景是 .env 文件 / shell 复制粘贴
        把末尾的 '=' 吃掉了（43 字符），或者中途被 env 解析器二次 strip，导致本来
        等价的密钥被 cryptography 判定非法而启动崩溃。为了让已有部署不必重新
        生成 + 数据库回迁就能恢复，这里按 base64 规范补齐到 4 的整数倍。
        """
        if not key:
            return key
        pad_len = (-len(key)) % 4
        return key + ("=" * pad_len)

    @field_validator("ai_credential_encryption_keys_raw", mode="after")
    @classmethod
    def _validate_encryption_keys(cls, v: str) -> str:
        gen_hint = (
            "Generate a valid key with: python -c "
            "\"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
        keys = [k.strip() for k in v.split(",") if k.strip()] if v else []
        if not keys:
            raise ValueError(
                f"AI_CREDENTIAL_ENCRYPTION_KEYS is required (VULN-056). {gen_hint}"
            )
        for idx, k in enumerate(keys):
            padded = cls._pad_b64url(k)
            try:
                Fernet(padded.encode())
            except Exception as exc:
                # 仍失败说明字节数真的不对（例如 43 字符但解码出来不是 32 字节），
                # 这种才是应该要求重新生成的情况。把原始长度写进报错便于定位。
                hint = f" (key #{idx + 1} length={len(k)}, expected 32 bytes base64url)"
                raise ValueError(
                    f"Invalid Fernet key in AI_CREDENTIAL_ENCRYPTION_KEYS: "
                    f"{exc}{hint}. {gen_hint}"
                ) from exc
        return v

    @property
    def ai_credential_encryption_keys(self) -> list[str]:
        """Comma-split, validated Fernet keys. First entry encrypts new data.

        返回值已补齐 base64url '=' padding，下游 MultiFernet 可以直接构造。
        """
        return [
            self._pad_b64url(k.strip())
            for k in self.ai_credential_encryption_keys_raw.split(",")
            if k.strip()
        ]

    rate_limit_user_per_min: int = Field(default=10, alias="AI_RATE_LIMIT_USER_PER_MIN")
    rate_limit_global_per_min: int = Field(default=100, alias="AI_RATE_LIMIT_GLOBAL_PER_MIN")
    # SECURITY (VULN-070): when Redis is unreachable, default to deny (503).
    # Dev/CI can flip this to True via AI_RATE_LIMIT_FAIL_OPEN=true if a Redis
    # outage must not block AI calls, but production should keep it False so
    # that rate limiter failures don't silently let wallet-drain attacks through.
    rate_limit_fail_open: bool = Field(default=False, alias="AI_RATE_LIMIT_FAIL_OPEN")

    # SECURITY (RATE-LIMITER-PWD): docker-compose.prod.yml 默认的 REDIS_URL 只
    # 拼了 host:port,没有把 REDIS_PASSWORD 注入 URL。当 Redis 需要 AUTH 时
    # eval 会 NOAUTH 失败,rate_limiter 走 fail-closed 返回 503。这里允许显式
    # 传 REDIS_PASSWORD,由 _merge_redis_password validator 安全合并进 URL,
    # 并在 deps.py::_get_redis 作为 from_url 的 password kwarg 再兜底一次。
    #
    # 字段声明顺序敏感: redis_password 必须排在 redis_url 之前,这样
    # _merge_redis_password (field_validator mode="after") 可以从 info.data 里
    # 读到已经被 pydantic-settings 解析过的值 —— 比 os.environ.get 更可靠,
    # 因为 .env 文件里的值不会被注入到 os.environ,只会进 pydantic 字段。
    redis_password: str | None = Field(default=None, alias="REDIS_PASSWORD")
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    postgres_dsn: str = Field(
        ...,
        alias="POSTGRES_DSN",
    )

    @field_validator("redis_url", mode="after")
    @classmethod
    def _merge_redis_password(cls, v: str, info) -> str:
        """把 REDIS_PASSWORD 合并进 REDIS_URL 的 userinfo 段。

        - 若 URL 已含 userinfo (含 ``@``),原样保留 —— 用户已显式指定。
        - 否则优先读 pydantic 已解析的 ``redis_password`` 字段(通过 ``info.data``
          获取,覆盖 os.environ 与 .env 两种来源),缺失再兜底读 ``os.environ``。
          URL-encode 后拼成 ``:pwd@`` 塞入。
        - 未设密码时不改动 URL,保持与无认证 Redis 兼容。
        """
        import os
        from urllib.parse import quote, urlparse, urlunparse

        try:
            parsed = urlparse(v)
        except Exception:
            return v
        if parsed.scheme not in {"redis", "rediss"}:
            return v
        if "@" in (parsed.netloc or ""):
            return v
        password = (info.data.get("redis_password") if info and info.data else None) \
            or os.environ.get("REDIS_PASSWORD")
        if not password:
            return v
        host_port = parsed.netloc or ""
        new_netloc = f":{quote(password, safe='')}@{host_port}"
        return urlunparse(parsed._replace(netloc=new_netloc))

    @field_validator("postgres_dsn", mode="after")
    @classmethod
    def _normalize_postgres_dsn(cls, v: str) -> str:
        """Strip SQLAlchemy dialect suffixes so raw asyncpg accepts the DSN.

        start.sh may export ``postgresql+asyncpg://…`` but ``asyncpg.create_pool``
        only understands ``postgresql://…``.
        """
        return v.replace("postgresql+asyncpg://", "postgresql://")

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


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
        _warn_if_prod_jwt_claims_unset(_settings)
    return _settings


def _warn_if_prod_jwt_claims_unset(settings: Settings) -> None:
    """SECURITY (VULN-067): emit a startup warning if `AI_ENV=prod` but
    `AI_JWT_AUDIENCE` / `AI_JWT_ISSUER` are unset — without those claims
    audience binding cannot be enforced, and a stolen token from another
    service using the same ``JWT_SECRET`` becomes usable against this one.
    We avoid raising to keep rollbacks clean; make `verify_aud` require claim
    presence explicitly in a follow-up once production envs are populated.
    """
    if settings.env.lower() != "prod":
        return
    if not settings.jwt_audience or not settings.jwt_issuer:
        import logging as _logging
        _logging.getLogger("ai-service").warning(
            "jwt.audience_or_issuer_unset_in_prod",
            extra={"data": {
                "env": settings.env,
                "has_audience": bool(settings.jwt_audience),
                "has_issuer": bool(settings.jwt_issuer),
                "remediation": "Set AI_JWT_AUDIENCE and AI_JWT_ISSUER in prod .env",
            }},
        )
