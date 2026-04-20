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
