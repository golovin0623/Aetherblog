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
from datetime import datetime
from typing import Any

import asyncpg
from cryptography.fernet import Fernet

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


def _derive_key(secret: str) -> bytes:
    """Derive a Fernet-compatible key from a secret string."""
    # Use SHA256 to get 32 bytes, then base64 encode for Fernet
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
        self._fernet = Fernet(_derive_key(self.settings.jwt_secret))  # Reuse JWT secret for encryption

    def encrypt_api_key(self, api_key: str) -> str:
        """Encrypt an API key for storage."""
        return self._fernet.encrypt(api_key.encode()).decode()

    def decrypt_api_key(self, encrypted: str) -> str:
        """Decrypt an API key from storage."""
        return self._fernet.decrypt(encrypted.encode()).decode()

    def generate_hint(self, api_key: str) -> str:
        """Generate a hint for display (e.g., 'sk-...abc')."""
        if len(api_key) <= 8:
            return "***"
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
        encrypted = self.encrypt_api_key(api_key)
        hint = self.generate_hint(api_key)
        
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
            query = """
                SELECT c.id, c.provider_id, p.code as provider_code, p.api_type,
                       c.api_key_encrypted,
                       COALESCE(c.base_url_override, p.base_url) as base_url,
                       c.extra_config, c.is_default
                FROM ai_credentials c
                JOIN ai_providers p ON c.provider_id = p.id
                WHERE c.id = $1 
                  AND c.is_enabled = TRUE
                  AND (c.user_id IS NOT DISTINCT FROM $2 OR c.user_id IS NULL)
            """
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow(query, credential_id, user_id)
        else:
            # Try user's credentials first
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

    async def delete_credential(self, credential_id: int, user_id: int | None = None) -> bool:
        """Delete a credential."""
        user_id = _normalize_user_id(user_id)
        query = """
            DELETE FROM ai_credentials 
            WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2
            RETURNING id
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, credential_id, user_id)
        return row is not None

    async def update_last_used(self, credential_id: int, error: str | None = None) -> None:
        """Update last used timestamp and error."""
        query = """
            UPDATE ai_credentials 
            SET last_used_at = $1, last_error = $2
            WHERE id = $3
        """
        async with self.pool.acquire() as conn:
            await conn.execute(query, datetime.utcnow(), error, credential_id)
