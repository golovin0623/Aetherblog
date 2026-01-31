# ref: §5.1 - Model Routing Service
"""
Service for routing AI requests to appropriate models.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

import asyncpg

from app.services.provider_registry import ProviderRegistry, ModelInfo
from app.services.credential_resolver import CredentialResolver, CredentialInfo

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


@dataclass
class RoutingConfig:
    """Complete routing configuration for an AI task."""
    task_type: str
    model: ModelInfo
    credential: CredentialInfo
    config: dict[str, Any]
    prompt_template: str | None = None
    fallback_model: ModelInfo | None = None


class ModelRouter:
    """
    Service for routing AI tasks to appropriate models.
    
    Resolves the complete configuration (model + credential + params) for a task.
    Priority: user-level routing > system default routing > env config.
    """

    def __init__(
        self,
        pool: asyncpg.Pool,
        provider_registry: ProviderRegistry,
        credential_resolver: CredentialResolver,
    ) -> None:
        self.pool = pool
        self.provider_registry = provider_registry
        self.credential_resolver = credential_resolver

    async def resolve_routing(
        self,
        task_type: str,
        user_id: int | None = None,
    ) -> RoutingConfig | None:
        """
        Resolve complete routing configuration for a task.
        
        Args:
            task_type: Task type code (e.g., 'summary', 'tags')
            user_id: Optional user ID for user-level routing
            
        Returns:
            RoutingConfig with model, credential, and parameters
        """
        user_id = _normalize_user_id(user_id)
        # Query routing config (user-level first, then system default)
        query = """
            SELECT r.id, r.config_override, r.credential_id, r.prompt_template as custom_prompt,
                   tt.code as task_code, tt.default_temperature, tt.default_max_tokens,
                   tt.prompt_template as default_prompt,
                   pm.id as primary_model_id, pm.model_id as primary_model,
                   pp.code as primary_provider_code, pp.base_url as primary_base_url,
                   fm.id as fallback_model_id, fm.model_id as fallback_model,
                   fp.code as fallback_provider_code
            FROM ai_task_routing r
            JOIN ai_task_types tt ON r.task_type_id = tt.id
            LEFT JOIN ai_models pm ON r.primary_model_id = pm.id
            LEFT JOIN ai_providers pp ON pm.provider_id = pp.id
            LEFT JOIN ai_models fm ON r.fallback_model_id = fm.id
            LEFT JOIN ai_providers fp ON fm.provider_id = fp.id
            WHERE tt.code = $1
              AND (r.user_id = $2 OR r.user_id IS NULL)
              AND r.is_enabled = TRUE
            ORDER BY r.user_id NULLS LAST
            LIMIT 1
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, task_type, user_id)
        
        if not row or not row["primary_model"]:
            logger.warning(f"No routing found for task: {task_type}")
            return None
        
        # Get model info
        primary_model = await self.provider_registry.get_model(
            row["primary_model"], row["primary_provider_code"]
        )
        if not primary_model:
            logger.error(f"Primary model not found: {row['primary_model']}")
            return None
        
        # Get fallback model if configured
        fallback_model = None
        if row["fallback_model"]:
            fallback_model = await self.provider_registry.get_model(
                row["fallback_model"], row["fallback_provider_code"]
            )
        
        # Resolve credential
        credential = await self.credential_resolver.get_credential(
            row["primary_provider_code"],
            user_id=user_id,
            credential_id=row["credential_id"],
        )
        if not credential:
            logger.error(f"No credential found for provider: {row['primary_provider_code']}")
            return None
        
        # Resolve prompt
        prompt_template = row["custom_prompt"] or row["default_prompt"]
        
        # Build config
        config = {
            "temperature": float(row["default_temperature"]) if row["default_temperature"] else 0.7,
            "max_tokens": row["default_max_tokens"],
        }
        config_override = _parse_json(row["config_override"])
        if config_override:
            config.update(config_override)
        
        return RoutingConfig(
            task_type=task_type,
            model=primary_model,
            credential=credential,
            config=config,
            prompt_template=prompt_template,
            fallback_model=fallback_model,
        )

    async def list_task_types(self) -> list[dict[str, Any]]:
        """List all available task types."""
        query = """
            SELECT code, name, description, default_model_type, 
                   default_temperature, default_max_tokens
            FROM ai_task_types
            ORDER BY code
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query)
        
        return [
            {
                "code": row["code"],
                "name": row["name"],
                "description": row["description"],
                "model_type": row["default_model_type"],
                "temperature": float(row["default_temperature"]) if row["default_temperature"] else None,
                "max_tokens": row["default_max_tokens"],
            }
            for row in rows
        ]

    async def update_routing(
        self,
        task_type: str,
        primary_model_id: int | None = None,
        fallback_model_id: int | None = None,
        credential_id: int | None = None,
        config_override: dict[str, Any] | None = None,
        prompt_template: str | None = None,
        update_primary: bool = False,
        update_fallback: bool = False,
        update_credential: bool = False,
        update_config: bool = False,
        update_prompt: bool = False,
        user_id: int | None = None,
    ) -> bool:
        """
        Update routing configuration for a task.
        
        If user_id is provided, creates/updates user-level routing.
        Otherwise updates system default.
        """
        user_id = _normalize_user_id(user_id)
        config_value = _encode_json(config_override if update_config else {})
        upsert_query = """
            INSERT INTO ai_task_routing 
                (user_id, task_type_id, primary_model_id, fallback_model_id, credential_id, config_override, prompt_template)
            SELECT $1, tt.id, $2, $3, $4, $5, $12
            FROM ai_task_types tt WHERE tt.code = $6
            ON CONFLICT ON CONSTRAINT uq_ai_task_routing_user_task
            DO UPDATE SET
                primary_model_id = CASE WHEN $7 THEN EXCLUDED.primary_model_id ELSE ai_task_routing.primary_model_id END,
                fallback_model_id = CASE WHEN $8 THEN EXCLUDED.fallback_model_id ELSE ai_task_routing.fallback_model_id END,
                credential_id = CASE WHEN $9 THEN EXCLUDED.credential_id ELSE ai_task_routing.credential_id END,
                config_override = CASE WHEN $10 THEN EXCLUDED.config_override ELSE ai_task_routing.config_override END,
                prompt_template = CASE WHEN $11 THEN EXCLUDED.prompt_template ELSE ai_task_routing.prompt_template END
        """
        async with self.pool.acquire() as conn:
            await conn.execute(
                upsert_query,
                user_id,
                primary_model_id,
                fallback_model_id,
                credential_id,
                config_value,
                task_type,
                update_primary,
                update_fallback,
                update_credential,
                update_config,
                update_prompt,
                prompt_template,
            )
        
        return True
