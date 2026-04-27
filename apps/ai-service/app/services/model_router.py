# ref: §5.1 - 模型路由服务（Model Routing Service）
"""
将 AI 请求路由到合适模型的服务。
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
    """为 asyncpg 编码 JSON 字段（dict -> str）。"""
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
    """单个 AI 任务的完整路由配置。"""
    task_type: str
    model: ModelInfo
    credential: CredentialInfo
    config: dict[str, Any]
    prompt_template: str | None = None
    fallback_model: ModelInfo | None = None


class ModelRouter:
    """
    将 AI 任务路由到合适模型的服务。

    解析任务对应的完整配置（模型 + 凭证 + 参数）。
    优先级：用户级路由 > 系统默认路由 > 环境变量配置。
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
        解析任务的完整路由配置。

        Args:
            task_type: 任务类型 code（如 'summary'、'tags'）
            user_id: 可选的用户 ID，用于按用户维度的路由

        Returns:
            含 model、credential 与参数的 RoutingConfig
        """
        user_id = _normalize_user_id(user_id)
        # 查询路由配置（先匹配用户级，再回落到系统默认）
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
        
        # 获取模型信息
        primary_model = await self.provider_registry.get_model(
            row["primary_model"], row["primary_provider_code"]
        )
        if not primary_model:
            logger.error(f"Primary model not found: {row['primary_model']}")
            return None

        # 若配置了 fallback 模型，则一并加载
        fallback_model = None
        if row["fallback_model"]:
            fallback_model = await self.provider_registry.get_model(
                row["fallback_model"], row["fallback_provider_code"]
            )

        # 解析凭证
        credential = await self.credential_resolver.get_credential(
            row["primary_provider_code"],
            user_id=user_id,
            credential_id=row["credential_id"],
        )
        if not credential:
            logger.error(f"No credential found for provider: {row['primary_provider_code']}")
            return None

        # 解析 prompt
        prompt_template = row["custom_prompt"] or row["default_prompt"]

        # 构造 config
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
        仅返回 ai_task_routing 行中的原始 ID 字段，不解析凭证。

        resolve_routing() 一旦凭证查找失败就直接返回 None，这会让管理员的
        GET 响应在尚未绑定凭证时丢掉刚保存的 primary_model_id —— 让管理员
        以为保存没生效。本方法暴露裸 ID，让调用方可以独立于凭证校验，
        通过 provider_registry（负责价格派生）拼出 ModelResponse。
        """
        user_id = _normalize_user_id(user_id)
        query = """
            SELECT r.primary_model_id, r.fallback_model_id,
                   r.credential_id, r.config_override
            FROM ai_task_routing r
            JOIN ai_task_types tt ON r.task_type_id = tt.id
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
            "fallback_model_id": row["fallback_model_id"],
            "credential_id": row["credential_id"],
            "config_override": _parse_json(row["config_override"]),
        }

    async def list_task_types(self) -> list[dict[str, Any]]:
        """列出所有可用的 task type。"""
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
        更新某个 task 的路由配置。

        若传入 user_id，则创建/更新用户级路由；
        否则更新系统默认行。
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
        """创建新的 AI task type。"""
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
        """按 code 删除一个 AI task type。"""
        # 注意：迁移里 ai_task_routing 对 ai_task_types.id 的 FK 是否带
        # ON DELETE CASCADE？实际上只是 REFERENCES ai_task_types(id)，
        # 因此需要先删 routing，再删 task type。
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # 先删除 routing 行
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
        """更新已有的 AI task type。"""
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
