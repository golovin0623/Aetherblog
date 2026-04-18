# ref: §5.1 - Credential Resolver Service
"""
Service for managing and resolving AI API credentials.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import asyncpg
from cryptography.fernet import Fernet, MultiFernet

from app.core.config import get_settings
from app.utils.provider_urls import normalize_api_base

logger = logging.getLogger("ai-service")


def _encode_json(value: Any) -> Any:
    """Encode JSON field for asyncpg (dict -> str)."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value)


def _parse_json(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {}
    return {}


def _normalize_user_id(user_id: int | str | None) -> int | None:
    if user_id is None:
        return None
    return int(user_id)


def _legacy_jwt_derived_key(secret: str) -> bytes:
    """Compute the legacy Fernet key that was derived from JWT_SECRET.

    Retained ONLY so the rotation script (scripts/rotate_credentials.py) can
    seed AI_CREDENTIAL_ENCRYPTION_KEYS with the legacy key as a fallback during
    the migration window. Production code path no longer uses this — see
    VULN-056 fix plan in docs/qa/fix-plans/vuln-056-fernet-jwt-key-split.md.
    """
    key_bytes = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(key_bytes)


@dataclass
class CredentialInfo:
    """Resolved credential information."""
    id: int
    provider_id: int
    provider_code: str
    api_type: str | None
    api_key: str  # Decrypted
    base_url: str | None
    extra_config: dict[str, Any]
    is_default: bool


class CredentialResolver:
    """
    Service for managing and resolving AI API credentials.
    
    Credentials are stored encrypted in the database using Fernet symmetric encryption.
    """

    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool
        self.settings = get_settings()
        # SECURITY (VULN-056): credential encryption uses a dedicated key set
        # (AI_CREDENTIAL_ENCRYPTION_KEYS), NOT JWT_SECRET. MultiFernet picks the
        # first key for new encryption and tries every key for decryption,
        # which lets operators rotate without downtime — see rotation script
        # in scripts/rotate_credentials.py.
        self._fernet = MultiFernet([
            Fernet(k.encode()) for k in self.settings.ai_credential_encryption_keys
        ])

    def encrypt_api_key(self, api_key: str) -> str:
        """Encrypt an API key for storage (uses the first key in the list)."""
        return self._fernet.encrypt(api_key.encode()).decode()

    def decrypt_api_key(self, encrypted: str) -> str:
        """Decrypt an API key from storage (tries every configured key)."""
        return self._fernet.decrypt(encrypted.encode()).decode()

    def reencrypt_api_key(self, encrypted: str) -> str:
        """Decrypt with any configured key, re-encrypt with the first key.

        Used by the offline rotation script (scripts/rotate_credentials.py)
        when retiring an old encryption key.
        """
        return self._fernet.rotate(encrypted.encode()).decode()

    def generate_hint(self, api_key: str) -> str:
        """Generate a hint for display (e.g., 'sk-abc...xyz')."""
        if len(api_key) <= 12:
            return "********"
        return f"{api_key[:3]}...{api_key[-3:]}"

    async def save_credential(
        self,
        provider_code: str,
        api_key: str,
        user_id: int | None = None,
        name: str | None = None,
        base_url_override: str | None = None,
        is_default: bool = False,
        extra_config: dict[str, Any] | None = None,
    ) -> int:
        """Save a new credential."""
        user_id = _normalize_user_id(user_id)
        encrypted = self.encrypt_api_key(api_key.strip())
        hint = self.generate_hint(api_key.strip())
        
        query = """
            INSERT INTO ai_credentials 
                (user_id, provider_id, name, api_key_encrypted, api_key_hint, 
                 base_url_override, is_default, extra_config)
            SELECT $1, p.id, $2, $3, $4, $5, $6, $7
            FROM ai_providers p WHERE p.code = $8
            RETURNING id
        """
        async with self.pool.acquire() as conn:
            # If setting as default, unset other defaults for this user/provider
            if is_default:
                await conn.execute(
                    """
                    UPDATE ai_credentials 
                    SET is_default = FALSE 
                    WHERE user_id IS NOT DISTINCT FROM $1 
                      AND provider_id = (SELECT id FROM ai_providers WHERE code = $2)
                    """,
                    user_id,
                    provider_code,
                )
            
            row = await conn.fetchrow(
                query,
                user_id,
                name,
                encrypted,
                hint,
                base_url_override,
                is_default,
                _encode_json(extra_config or {}),
                provider_code,
            )
        
        return row["id"]

    async def get_credential(
        self,
        provider_code: str,
        user_id: int | None = None,
        credential_id: int | None = None,
    ) -> CredentialInfo | None:
        """
        Resolve credential for a provider.
        
        Priority:
        1. Specific credential_id if provided
        2. User's default credential for this provider
        3. Any user credential for this provider
        4. System default (from environment)
        """
        user_id = _normalize_user_id(user_id)
        if credential_id:
            # When user_id is None the call comes from a background worker or
            # the system-default routing probe — trust the credential_id alone
            # and do not filter by user_id. Otherwise every credential saved
            # under an admin user_id would be invisible to the indexer and the
            # SearchConfig page would falsely report "no credential".
            base_query = """
                SELECT c.id, c.provider_id, p.code as provider_code, p.api_type,
                       c.api_key_encrypted,
                       COALESCE(c.base_url_override, p.base_url) as base_url,
                       c.extra_config, c.is_default
                FROM ai_credentials c
                JOIN ai_providers p ON c.provider_id = p.id
                WHERE c.id = $1
                  AND c.is_enabled = TRUE
            """
            async with self.pool.acquire() as conn:
                if user_id is None:
                    row = await conn.fetchrow(base_query, credential_id)
                else:
                    row = await conn.fetchrow(
                        base_query
                        + " AND (c.user_id IS NOT DISTINCT FROM $2 OR c.user_id IS NULL)",
                        credential_id,
                        user_id,
                    )
        elif user_id is None:
            # 内部服务（Go backend 通过 X-Internal-Service 调用）没有登录用户上下文。
            # 此时 user_id 字段上原本的 "c.user_id = $2" 条件永远为 FALSE（SQL 里
            # NULL 不等于自己），会把所有绑定了用户的凭证全部过滤掉，只剩 system
            # 凭证；没有 system 凭证时又进一步 fallback 到 env，导致"后台索引用了
            # 虚空捏造的 api.openai.com 官方地址"这种 bug。
            # 对内部调用：直接在所有启用的凭证里按 is_default / id 取第一条。
            query = """
                SELECT c.id, c.provider_id, p.code as provider_code, p.api_type,
                       c.api_key_encrypted,
                       COALESCE(c.base_url_override, p.base_url) as base_url,
                       c.extra_config, c.is_default
                FROM ai_credentials c
                JOIN ai_providers p ON c.provider_id = p.id
                WHERE p.code = $1
                  AND c.is_enabled = TRUE
                ORDER BY c.is_default DESC, c.id ASC
                LIMIT 1
            """
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow(query, provider_code)
        else:
            # Try user's credentials first, then system
            query = """
                SELECT c.id, c.provider_id, p.code as provider_code, p.api_type,
                       c.api_key_encrypted,
                       COALESCE(c.base_url_override, p.base_url) as base_url,
                       c.extra_config, c.is_default
                FROM ai_credentials c
                JOIN ai_providers p ON c.provider_id = p.id
                WHERE p.code = $1
                  AND (c.user_id = $2 OR c.user_id IS NULL)
                  AND c.is_enabled = TRUE
                ORDER BY c.user_id NULLS LAST, c.is_default DESC
                LIMIT 1
            """
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow(query, provider_code, user_id)
        
        if row:
            extra_config = _parse_json(row["extra_config"])
            normalized_base = normalize_api_base(row["base_url"], row["api_type"], extra_config)
            return CredentialInfo(
                id=row["id"],
                provider_id=row["provider_id"],
                provider_code=row["provider_code"],
                api_type=row["api_type"],
                api_key=self.decrypt_api_key(row["api_key_encrypted"]),
                base_url=normalized_base,
                extra_config=extra_config,
                is_default=row["is_default"],
            )
        
        # Fallback to environment config
        return self._get_env_credential(provider_code)

    def _get_env_credential(self, provider_code: str) -> CredentialInfo | None:
        """Get credential from environment variables."""
        settings = self.settings
        
        if provider_code == "openai" and settings.openai_api_key:
            return CredentialInfo(
                id=0,
                provider_id=0,
                provider_code="openai",
                api_type="openai_compat",
                api_key=settings.openai_api_key,
                base_url=normalize_api_base(settings.openai_base_url, "openai_compat", {}),
                extra_config={},
                is_default=True,
            )
        elif provider_code == "openai_compat" and settings.openai_compat_api_key:
            return CredentialInfo(
                id=0,
                provider_id=0,
                provider_code="openai_compat",
                api_type="openai_compat",
                api_key=settings.openai_compat_api_key,
                base_url=normalize_api_base(settings.openai_compat_base_url, "openai_compat", {}),
                extra_config={},
                is_default=True,
            )
        
        return None

    async def list_credentials(self, user_id: int | None = None) -> list[dict[str, Any]]:
        """List credentials for a user (without exposing API keys)."""
        user_id = _normalize_user_id(user_id)
        query = """
            SELECT c.id, c.name, c.api_key_hint, p.code as provider_code, p.display_name as provider_name,
                   c.base_url_override, c.extra_config, c.is_default, c.is_enabled, c.last_used_at, c.last_error,
                   c.created_at
            FROM ai_credentials c
            JOIN ai_providers p ON c.provider_id = p.id
            WHERE c.user_id IS NOT DISTINCT FROM $1
            ORDER BY c.is_default DESC, c.created_at DESC
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, user_id)
        
        records = []
        for row in rows:
            record = dict(row)
            record["extra_config"] = _parse_json(record.get("extra_config"))
            records.append(record)
        return records

    async def get_credential_by_id(
        self, 
        credential_id: int, 
        user_id: int | None = None,
        decrypt_key: bool = False,
    ) -> dict[str, Any] | None:
        """
        Get a single credential by ID.
        
        Args:
            credential_id: The credential ID
            user_id: The user ID (for access control)
            decrypt_key: If True, return decrypted API key (for admin reveal feature)
        """
        user_id = _normalize_user_id(user_id)
        query = """
            SELECT c.id, c.name, c.api_key_hint, c.api_key_encrypted,
                   p.code as provider_code, p.display_name as provider_name,
                   c.base_url_override, c.extra_config, c.is_default, c.is_enabled, 
                   c.last_used_at, c.last_error, c.created_at
            FROM ai_credentials c
            JOIN ai_providers p ON c.provider_id = p.id
            WHERE c.id = $1 AND c.user_id IS NOT DISTINCT FROM $2
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, credential_id, user_id)
        
        if not row:
            return None
        
        result = dict(row)
        result["extra_config"] = _parse_json(result.get("extra_config"))
        
        if decrypt_key:
            result["api_key"] = self.decrypt_api_key(result["api_key_encrypted"])
        
        # Remove encrypted key from response
        del result["api_key_encrypted"]
        
        return result

    async def delete_credential(self, credential_id: int, user_id: int | None = None) -> bool:
        """Delete a credential, first clearing any routing references."""
        user_id = _normalize_user_id(user_id)
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Clear references in ai_task_routing to avoid FK constraint errors
                await conn.execute(
                    """
                    UPDATE ai_task_routing
                    SET credential_id = NULL
                    WHERE credential_id = $1
                    """,
                    credential_id,
                )
                # Now delete the credential
                row = await conn.fetchrow(
                    """
                    DELETE FROM ai_credentials 
                    WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2
                    RETURNING id
                    """,
                    credential_id,
                    user_id,
                )
        return row is not None

    async def update_last_used(self, credential_id: int, error: str | None = None) -> None:
        """Update last used timestamp and error."""
        query = """
            UPDATE ai_credentials
            SET last_used_at = $1, last_error = $2
            WHERE id = $3
        """
        async with self.pool.acquire() as conn:
            # Column `last_used_at` is TIMESTAMP (no TZ); asyncpg refuses tz-aware
            # datetimes ("can't subtract offset-naive and offset-aware"). Compute
            # an explicit UTC timestamp and strip tzinfo for storage.
            now_utc_naive = datetime.now(timezone.utc).replace(tzinfo=None)
            await conn.execute(query, now_utc_naive, error, credential_id)
