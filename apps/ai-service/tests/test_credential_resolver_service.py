from __future__ import annotations

import os
import pytest

from app.core import config as config_module
from app.services.credential_resolver import CredentialResolver
from app.utils.provider_urls import normalize_api_base
from tests.support import FakeConn, FakePool


@pytest.mark.asyncio
async def test_save_credential_default_unsets_previous():
    calls = {"execute": 0}

    def execute(_query, _args):
        calls["execute"] += 1
        return "OK"

    def fetchrow(_query, _args):
        return {"id": 123}

    conn = FakeConn(execute=execute, fetchrow=fetchrow)
    pool = FakePool(conn)
    resolver = CredentialResolver(pool)

    cred_id = await resolver.save_credential(
        provider_code="openai",
        api_key="sk-test",
        is_default=True,
    )
    assert cred_id == 123
    assert calls["execute"] == 1


@pytest.mark.asyncio
async def test_get_credential_by_id_and_normalize_base():
    resolver = CredentialResolver(FakePool(FakeConn()))
    encrypted = resolver.encrypt_api_key("sk-test")

    def fetchrow(_query, _args):
        return {
            "id": 10,
            "provider_id": 1,
            "provider_code": "openai",
            "api_type": "openai_compat",
            "api_key_encrypted": encrypted,
            "base_url": "https://api.example.com/v",
            "extra_config": {"api_path_mode": "append_v1"},
            "is_default": True,
        }

    resolver.pool = FakePool(FakeConn(fetchrow=fetchrow))
    cred = await resolver.get_credential("openai", user_id=1, credential_id=10)
    assert cred is not None
    assert cred.api_key == "sk-test"
    assert cred.base_url == normalize_api_base("https://api.example.com/v", "openai_compat", {"api_path_mode": "append_v1"})


@pytest.mark.asyncio
async def test_get_credential_fallback_env():
    os.environ["OPENAI_API_KEY"] = "sk-env"
    os.environ["OPENAI_BASE_URL"] = "https://api.openai.com"
    config_module._settings = None

    resolver = CredentialResolver(FakePool(FakeConn()))
    cred = await resolver.get_credential("openai")
    assert cred is not None
    assert cred.api_key == "sk-env"


@pytest.mark.asyncio
async def test_list_delete_and_update_credentials():
    rows = [
        {
            "id": 1,
            "name": "default",
            "api_key_hint": "sk-...123",
            "provider_code": "openai",
            "provider_name": "OpenAI",
            "base_url_override": None,
            "extra_config": {"api_path_mode": "auto"},
            "is_default": True,
            "is_enabled": True,
            "last_used_at": None,
            "last_error": None,
            "created_at": "2026-01-01",
        }
    ]

    def fetch(_query, _args):
        return rows

    def fetchrow(_query, _args):
        return {"id": 1}

    conn = FakeConn(fetch=fetch, fetchrow=fetchrow)
    resolver = CredentialResolver(FakePool(conn))

    listed = await resolver.list_credentials(user_id=1)
    assert listed[0]["provider_code"] == "openai"

    deleted = await resolver.delete_credential(1, user_id=1)
    assert deleted is True

    await resolver.update_last_used(1, error=None)
    assert conn.execute_calls
