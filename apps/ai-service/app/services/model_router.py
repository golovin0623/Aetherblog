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
            SELECT r.id, r.config_override, r.credential_id, 
                   COALESCE(r.prompt_template, r.config_override->>'prompt_template') as custom_prompt,
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

    async def get_routing_db(
        self,
        task_type: str,
        user_id: int | None = None,
    ) -> dict[str, Any] | None:
        """
        Admin-facing read: 返回 ai_task_routing 中存储的原始行 (JOIN 过 model /
        provider 元数据), 不做 credential 解析, 不依赖 provider_registry 缓存.

        resolve_routing() 是运行时解析路径, 只要 credential 缺失就返回 None ——
        这对于"查询当前保存了哪个模型"的 UI 场景来说过于严格, 会导致:
        刚保存完的 primary_model_id 因为 openai_compat 还没绑凭证就被隐身,
        前端下拉框显示"未选择", 让管理员以为没保存成功.

        此方法只读 DB, 只要行存在 + model JOIN 成功就原样返回, 供 Admin UI
        直接回显保存状态.
        """
        user_id = _normalize_user_id(user_id)
        query = """
            SELECT r.id, r.primary_model_id, r.fallback_model_id,
                   r.credential_id, r.config_override,
                   pm.model_id as primary_model_code,
                   pm.display_name as primary_model_name,
                   pm.model_type as primary_model_type,
                   pm.context_window as primary_context_window,
                   pm.max_output_tokens as primary_max_output_tokens,
                   pm.input_cost_per_1k as primary_input_cost_per_1k,
                   pm.output_cost_per_1k as primary_output_cost_per_1k,
                   pm.capabilities as primary_capabilities,
                   pm.is_enabled as primary_is_enabled,
                   pm.provider_id as primary_provider_id,
                   pp.code as primary_provider_code,
                   fm.model_id as fallback_model_code,
                   fm.display_name as fallback_model_name,
                   fm.model_type as fallback_model_type,
                   fm.context_window as fallback_context_window,
                   fm.max_output_tokens as fallback_max_output_tokens,
                   fm.input_cost_per_1k as fallback_input_cost_per_1k,
                   fm.output_cost_per_1k as fallback_output_cost_per_1k,
                   fm.capabilities as fallback_capabilities,
                   fm.is_enabled as fallback_is_enabled,
                   fm.provider_id as fallback_provider_id,
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

        if not row:
            return None

        return {
            "primary_model_id": row["primary_model_id"],
            "primary_model": (
                {
                    "id": row["primary_model_id"],
                    "provider_id": row["primary_provider_id"],
                    "provider_code": row["primary_provider_code"],
                    "model_id": row["primary_model_code"],
                    "display_name": row["primary_model_name"],
                    "model_type": row["primary_model_type"],
                    "context_window": row["primary_context_window"],
                    "max_output_tokens": row["primary_max_output_tokens"],
                    "input_cost_per_1k": row["primary_input_cost_per_1k"],
                    "output_cost_per_1k": row["primary_output_cost_per_1k"],
                    "capabilities": _parse_json(row["primary_capabilities"]),
                    "is_enabled": row["primary_is_enabled"],
                }
                if row["primary_model_id"] is not None
                   and row["primary_model_code"] is not None
                else None
            ),
            "fallback_model_id": row["fallback_model_id"],
            "fallback_model": (
                {
                    "id": row["fallback_model_id"],
                    "provider_id": row["fallback_provider_id"],
                    "provider_code": row["fallback_provider_code"],
                    "model_id": row["fallback_model_code"],
                    "display_name": row["fallback_model_name"],
                    "model_type": row["fallback_model_type"],
                    "context_window": row["fallback_context_window"],
                    "max_output_tokens": row["fallback_max_output_tokens"],
                    "input_cost_per_1k": row["fallback_input_cost_per_1k"],
                    "output_cost_per_1k": row["fallback_output_cost_per_1k"],
                    "capabilities": _parse_json(row["fallback_capabilities"]),
                    "is_enabled": row["fallback_is_enabled"],
                }
                if row["fallback_model_id"] is not None
                   and row["fallback_model_code"] is not None
                else None
            ),
            "credential_id": row["credential_id"],
            "config_override": _parse_json(row["config_override"]),
        }

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

    async def create_task_type(
        self,
        code: str,
        name: str,
        description: str | None = None,
        model_type: str = "chat",
        temperature: float = 0.7,
        max_tokens: int | None = None,
        prompt_template: str | None = None,
    ) -> int:
        """Create a new AI task type."""
        query = """
            INSERT INTO ai_task_types (code, name, description, default_model_type, default_temperature, default_max_tokens, prompt_template)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
        """
        async with self.pool.acquire() as conn:
            return await conn.fetchval(
                query, code, name, description, model_type, temperature, max_tokens, prompt_template
            )

    async def delete_task_type(self, code: str) -> bool:
        """Delete an AI task type by code."""
        # Note: ai_task_routing has FK to ai_task_types.id without ON DELETE CASCADE in migration?
        # Actually it has REFERENCES ai_task_types(id). 
        # We might need to delete routing first.
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Delete routings first
                await conn.execute(
                    "DELETE FROM ai_task_routing WHERE task_type_id = (SELECT id FROM ai_task_types WHERE code = $1)",
                    code
                )
                res = await conn.execute("DELETE FROM ai_task_types WHERE code = $1", code)
                return res == "DELETE 1"

    async def update_task_type(
        self,
        code: str,
        name: str | None = None,
        description: str | None = None,
        model_type: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        prompt_template: str | None = None,
    ) -> bool:
        """Update an existing AI task type."""
        updates = []
        params = []
        idx = 1
        
        if name is not None:
            updates.append(f"name = ${idx}")
            params.append(name)
            idx += 1
        if description is not None:
            updates.append(f"description = ${idx}")
            params.append(description)
            idx += 1
        if model_type is not None:
            updates.append(f"default_model_type = ${idx}")
            params.append(model_type)
            idx += 1
        if temperature is not None:
            updates.append(f"default_temperature = ${idx}")
            params.append(temperature)
            idx += 1
        if max_tokens is not None:
            updates.append(f"default_max_tokens = ${idx}")
            params.append(max_tokens)
            idx += 1
        if prompt_template is not None:
            updates.append(f"prompt_template = ${idx}")
            params.append(prompt_template)
            idx += 1
            
        if not updates:
            return True
            
        params.append(code)
        query = f"UPDATE ai_task_types SET {', '.join(updates)} WHERE code = ${idx}"
        
        async with self.pool.acquire() as conn:
            res = await conn.execute(query, *params)
            return res == "UPDATE 1"
