"""Tests for the REDIS_PASSWORD → REDIS_URL merge behaviour.

Guards against regression of the rate-limiter 503 bug where
docker-compose.prod.yml built REDIS_URL from host:port alone and never
injected REDIS_PASSWORD, causing NOAUTH on external Redis → fail-closed.
"""
from __future__ import annotations

import base64
import importlib

import pytest


@pytest.fixture
def fresh_settings(monkeypatch):
    """Provide a clean Settings class that re-reads env on each call."""
    # Required fields so Settings() validates without complaint.
    monkeypatch.setenv("POSTGRES_DSN", "postgresql://u:p@localhost/db")
    monkeypatch.setenv("JWT_SECRET", "x" * 32)
    monkeypatch.setenv("AI_INTERNAL_SERVICE_TOKEN", "y" * 32)
    monkeypatch.setenv(
        "AI_CREDENTIAL_ENCRYPTION_KEYS",
        base64.urlsafe_b64encode(b"0" * 32).decode(),
    )
    from app.core import config as config_module

    importlib.reload(config_module)
    return config_module.Settings


def test_redis_url_unchanged_when_no_password(monkeypatch, fresh_settings):
    monkeypatch.delenv("REDIS_PASSWORD", raising=False)
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    assert fresh_settings().redis_url == "redis://localhost:6379/0"


def test_redis_url_injects_simple_password(monkeypatch, fresh_settings):
    monkeypatch.setenv("REDIS_PASSWORD", "secret123")
    monkeypatch.setenv("REDIS_URL", "redis://124.22.30.10:6999/0")
    assert (
        fresh_settings().redis_url
        == "redis://:secret123@124.22.30.10:6999/0"
    )


def test_redis_url_encodes_special_chars_in_password(monkeypatch, fresh_settings):
    monkeypatch.setenv("REDIS_PASSWORD", "p@ss/w:ord+#")
    monkeypatch.setenv("REDIS_URL", "redis://host:6379/0")
    url = fresh_settings().redis_url
    # @ / : + # must be percent-encoded to keep URL parseable
    assert "%40" in url and "%2F" in url and "%3A" in url
    assert "%2B" in url and "%23" in url
    assert url.endswith("@host:6379/0")


def test_redis_url_preserves_existing_userinfo(monkeypatch, fresh_settings):
    monkeypatch.setenv("REDIS_PASSWORD", "should-be-ignored")
    monkeypatch.setenv("REDIS_URL", "redis://:existing@host:6379/0")
    # User explicitly provided auth — never overwrite
    assert fresh_settings().redis_url == "redis://:existing@host:6379/0"


def test_redis_url_rediss_tls_scheme(monkeypatch, fresh_settings):
    monkeypatch.setenv("REDIS_PASSWORD", "tls-pwd")
    monkeypatch.setenv("REDIS_URL", "rediss://host:6380/1")
    assert fresh_settings().redis_url == "rediss://:tls-pwd@host:6380/1"


def test_redis_url_built_from_host_port_password(monkeypatch, fresh_settings):
    """REDIS_HOST + REDIS_PORT + REDIS_PASSWORD 三段式自动合成完整 URL。

    backend (Go) 和 ai-service 对齐到同一套配置, 避免两边 env 各自维护 URL /
    host-port 的漂移。不显式设 REDIS_URL 时, _build_redis_url_from_parts 应当
    合成出 redis://:pwd@host:port/0 形式。
    """
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("REDIS_HOST", "124.221.0.1")
    monkeypatch.setenv("REDIS_PORT", "6999")
    monkeypatch.setenv("REDIS_PASSWORD", "3-var-pwd")
    assert fresh_settings()().redis_url == "redis://:3-var-pwd@124.221.0.1:6999/0"


def test_redis_url_built_from_host_without_password(monkeypatch, fresh_settings):
    """REDIS_HOST 有值但 REDIS_PASSWORD 缺省 → URL 不带 userinfo, 保持对无认证
    Redis 的兼容。"""
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("REDIS_PASSWORD", raising=False)
    monkeypatch.setenv("REDIS_HOST", "cache.internal")
    monkeypatch.setenv("REDIS_PORT", "6379")
    assert fresh_settings()().redis_url == "redis://cache.internal:6379/0"


def test_explicit_redis_url_wins_over_three_var(monkeypatch, fresh_settings):
    """显式 REDIS_URL 优先级高于三段式变量, 兼容外部 Redis cluster / TLS 场景。"""
    monkeypatch.setenv("REDIS_URL", "rediss://:explicit@external.example.com:6380/2")
    monkeypatch.setenv("REDIS_HOST", "should-be-ignored")
    monkeypatch.setenv("REDIS_PORT", "9999")
    monkeypatch.setenv("REDIS_PASSWORD", "should-be-ignored")
    assert (
        fresh_settings()().redis_url
        == "rediss://:explicit@external.example.com:6380/2"
    )


def test_empty_redis_url_falls_through_to_three_var(monkeypatch, fresh_settings):
    """docker-compose.prod.yml 的 ``REDIS_URL: ${AI_REDIS_URL:-}`` 在 AI_REDIS_URL
    未配置时会往容器里注入空串, 此时应该走三段式合成而不是保留空 URL。"""
    monkeypatch.setenv("REDIS_URL", "")
    monkeypatch.setenv("REDIS_HOST", "redis")
    monkeypatch.setenv("REDIS_PORT", "6379")
    monkeypatch.setenv("REDIS_PASSWORD", "fallback-pwd")
    assert fresh_settings()().redis_url == "redis://:fallback-pwd@redis:6379/0"


def test_redis_password_field_drives_merge(monkeypatch, fresh_settings):
    """Validator should prefer the pydantic-parsed field over os.environ.

    pydantic-settings populates ``redis_password`` from both ``os.environ`` and
    ``.env`` files, whereas the previous ``os.environ.get`` read missed the
    .env path. If the parsed field is authoritative, the URL still gets auth
    even when the raw environ lookup returns empty — which is the case dev
    setups that only declare REDIS_PASSWORD in .env hit.
    """
    monkeypatch.setenv("REDIS_PASSWORD", "env-pwd")
    monkeypatch.setenv("REDIS_URL", "redis://host:6379/0")
    settings = fresh_settings()()
    # Field should be parsed, not None.
    assert settings.redis_password == "env-pwd"
    # URL should carry the merged auth.
    assert settings.redis_url == "redis://:env-pwd@host:6379/0"
