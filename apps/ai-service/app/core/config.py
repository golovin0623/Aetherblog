from __future__ import annotations

from pathlib import Path
from typing import Literal

from cryptography.fernet import Fernet
from pydantic import Field, field_validator, model_validator
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

    # 安全 (VULN-056): 凭证加密密钥必须独立于 JWT_SECRET。
    # 在环境变量中以原始字符串存储 (pydantic-settings 默认会把 ``list`` 字段当 JSON
    # 解码，会破坏逗号分隔值)；解析后的 list 通过下方 ``ai_credential_encryption_keys``
    # 属性暴露。首个 key 用于新数据加密，全部 key 都会尝试用于解密
    # (借助 MultiFernet 实现零停机轮换)。生成命令：
    #   python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
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
        """为 Fernet 密钥补回缺失的 base64url '=' 填充。

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
        """以逗号切分并通过校验的 Fernet 密钥列表。首个条目用于加密新数据。

        返回值已补齐 base64url '=' padding，下游 MultiFernet 可以直接构造。
        """
        return [
            self._pad_b64url(k.strip())
            for k in self.ai_credential_encryption_keys_raw.split(",")
            if k.strip()
        ]

    rate_limit_user_per_min: int = Field(default=10, alias="AI_RATE_LIMIT_USER_PER_MIN")
    rate_limit_global_per_min: int = Field(default=100, alias="AI_RATE_LIMIT_GLOBAL_PER_MIN")
    # 安全 (VULN-070): 当 Redis 不可达时,默认拒绝 (503)。
    # 开发/CI 环境可以通过 AI_RATE_LIMIT_FAIL_OPEN=true 翻成 True,以便 Redis
    # 故障时不阻塞 AI 调用;生产环境必须保持 False,避免 rate limiter 失败时
    # 默默放行,从而让"钱包耗尽型"攻击悄悄成功。
    rate_limit_fail_open: bool = Field(default=False, alias="AI_RATE_LIMIT_FAIL_OPEN")

    # 三段式 Redis 配置,跟 Go backend 对齐。优先级:
    #   1. 显式 REDIS_URL (非空) → 直接使用,_merge_redis_password 负责合入 AUTH
    #   2. REDIS_HOST 有值 → 由 _build_redis_url_from_parts 合成完整 URL
    #   3. 全部缺省 → 保留 redis_url 的默认值 (本地 localhost:6379/0)
    #
    # 字段声明顺序敏感: redis_password / redis_host / redis_port 必须排在
    # redis_url 之前,这样 _merge_redis_password (field_validator mode="after")
    # 可以从 info.data 里读到已经被 pydantic-settings 解析过的值 —— 比
    # os.environ.get 更可靠,因为 .env 文件里的值不会被注入到 os.environ,
    # 只会进 pydantic 字段。
    redis_host: str | None = Field(default=None, alias="REDIS_HOST")
    redis_port: int = Field(default=6379, alias="REDIS_PORT")
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

    @model_validator(mode="after")
    def _build_redis_url_from_parts(self) -> "Settings":
        """当未显式配置 REDIS_URL 时,用 REDIS_HOST/PORT/PASSWORD 三段式合成。

        背景: backend (Go) 一直读 REDIS_HOST + REDIS_PORT + REDIS_PASSWORD 三个
        独立变量;ai-service 历史上只认 REDIS_URL,导致两边配置要各自维护一份,
        运维易错 (常见的坑: docker 网络内 Redis 容器内部端口是 6379,但宿主机
        映射到 6999,backend 走宿主机 IP + 6999 OK,ai-service 只会把 REDIS_URL
        里的 host/port 照搬,容易写成 redis:6999 这种永远通不了的组合)。

        此处对齐到同一套三段式,REDIS_URL 退化为可选的 URL override (外部 Redis
        cluster / rediss:// TLS / sentinel 这种高级场景仍可直接喂完整 URL)。

        - 若 os.environ 显式带了非空 REDIS_URL → 什么都不动, _merge_redis_password
          已经负责把密码合进 userinfo。
        - 否则若 redis_host 有值 → 按 redis://[:password@]host:port/0 合成,password
          走 url-encode 兼容特殊字符。
        - 两边都没有 → redis_url 保留字段默认值 (redis://localhost:6379/0)。
        """
        import os
        from urllib.parse import quote

        raw_url_env = (os.environ.get("REDIS_URL") or "").strip()
        if raw_url_env:
            # _merge_redis_password 已经跑过, 不要覆盖用户显式指定的 URL。
            return self

        if self.redis_host:
            auth = (
                f":{quote(self.redis_password, safe='')}@"
                if self.redis_password
                else ""
            )
            self.redis_url = f"redis://{auth}{self.redis_host}:{self.redis_port}/0"
        return self

    @field_validator("postgres_dsn", mode="after")
    @classmethod
    def _normalize_postgres_dsn(cls, v: str) -> str:
        """剥除 SQLAlchemy dialect 后缀,让原始 asyncpg 能接受该 DSN。

        start.sh 可能导出 ``postgresql+asyncpg://…``,但 ``asyncpg.create_pool``
        只认 ``postgresql://…``。
        """
        return v.replace("postgresql+asyncpg://", "postgresql://")

    vector_dim: int = Field(default=1536, alias="AI_VECTOR_DIM")
    search_threshold: float = Field(default=0.6, alias="AI_SEARCH_THRESHOLD")
    reindex_batch_size: int = Field(default=200, alias="AI_REINDEX_BATCH")
    # Search Profile SSE 全量重建的“篇级”并发上限。
    # 与 vector_store 的 chunk 并发是两层控制：
    #   - post 并发: 同时处理多少篇文章
    #   - chunk 并发: 单篇文章内部同时请求多少个 chunk embedding
    # 默认 5；可按 provider 配额 / CPU 负载在部署环境调优。
    reindex_stream_post_concurrency: int = Field(
        default=5,
        alias="AI_REINDEX_STREAM_POST_CONCURRENCY",
    )
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
    # 单次 AI / 搜索请求接受的最大字符数。原值 20000 对中长博文（≥3 万字）
    # 直接 413，远低于现代 LLM 上下文（GPT-5 / Claude 4.x ≥ 200K tokens，
    # 中英混排约 3 字 / token 即 600K 字符）。120000 字符≈40K tokens，
    # 既覆盖常见博文上限又留有余量，仍能拦住明显异常的滥用。
    max_input_chars: int = Field(default=120000, alias="AI_MAX_INPUT_CHARS")

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
    """安全 (VULN-067): 当 `AI_ENV=prod` 但 `AI_JWT_AUDIENCE` / `AI_JWT_ISSUER`
    未设置时,在启动阶段发出警告 —— 缺少这两个 claim 就无法强制 audience 绑定,
    一旦另一个使用相同 ``JWT_SECRET`` 的服务令牌泄露,就能反过来打这边。
    这里不抛错以保留回滚的干净度;待生产环境配置齐全后,再在后续工作里把
    `verify_aud` 显式要求 claim 必须存在。
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
