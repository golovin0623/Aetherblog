# ref: §5.1 - Provider Registry Service
"""
Service for managing AI providers and models.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

import asyncpg

logger = logging.getLogger("ai-service")


def _parse_json(value: Any) -> dict[str, Any]:
    """Parse JSON field - handles both dict and string."""
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


def _encode_json(value: Any) -> Any:
    """Encode JSON field for asyncpg (dict -> str)."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value)


@dataclass
class ProviderInfo:
    """Provider information."""
    id: int
    code: str
    name: str
    display_name: str | None
    api_type: str
    base_url: str | None
    doc_url: str | None
    icon: str | None
    is_enabled: bool
    priority: int
    capabilities: dict[str, Any]
    config_schema: dict[str, Any] | None


@dataclass
class ModelInfo:
    """Model information."""
    id: int
    provider_id: int
    provider_code: str
    model_id: str
    display_name: str | None
    model_type: str
    context_window: int | None
    max_output_tokens: int | None
    input_cost_per_1k: float | None
    output_cost_per_1k: float | None
    capabilities: dict[str, Any]
    is_enabled: bool


class ProviderRegistry:
    """
    Service for querying AI providers and models from database.
    """

    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool
        self._provider_cache: dict[str, ProviderInfo] = {}
        self._model_cache: dict[str, ModelInfo] = {}

    async def list_providers(self, enabled_only: bool = True) -> list[ProviderInfo]:
        """List all AI providers."""
        query = """
            SELECT id, code, name, display_name, api_type, base_url, doc_url, icon,
                   is_enabled, priority, capabilities, config_schema
            FROM ai_providers
            WHERE ($1 = FALSE OR is_enabled = TRUE)
            ORDER BY priority DESC
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, enabled_only)
        
        return [
            ProviderInfo(
                id=row["id"],
                code=row["code"],
                name=row["name"],
                display_name=row["display_name"],
                api_type=row["api_type"],
                base_url=row["base_url"],
                doc_url=row["doc_url"],
                icon=row["icon"],
                is_enabled=row["is_enabled"],
                priority=row["priority"],
                capabilities=_parse_json(row["capabilities"]),
                config_schema=_parse_json(row["config_schema"]),
            )
            for row in rows
        ]

    async def get_provider(self, code: str) -> ProviderInfo | None:
        """Get provider by code."""
        if code in self._provider_cache:
            return self._provider_cache[code]
        
        query = """
            SELECT id, code, name, display_name, api_type, base_url, doc_url, icon,
                   is_enabled, priority, capabilities, config_schema
            FROM ai_providers
            WHERE code = $1
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, code)
        
        if not row:
            return None
        
        provider = ProviderInfo(
            id=row["id"],
            code=row["code"],
            name=row["name"],
            display_name=row["display_name"],
            api_type=row["api_type"],
            base_url=row["base_url"],
            doc_url=row["doc_url"],
            icon=row["icon"],
            is_enabled=row["is_enabled"],
            priority=row["priority"],
            capabilities=_parse_json(row["capabilities"]),
            config_schema=_parse_json(row["config_schema"]),
        )
        self._provider_cache[code] = provider
        return provider

    async def list_models(
        self, provider_code: str | None = None, model_type: str | None = None, enabled_only: bool = True
    ) -> list[ModelInfo]:
        """List AI models with optional filters."""
        query = """
            SELECT m.id, m.provider_id, p.code as provider_code, m.model_id, 
                   m.display_name, m.model_type, m.context_window, m.max_output_tokens,
                   m.input_cost_per_1k, m.output_cost_per_1k, m.capabilities, m.is_enabled
            FROM ai_models m
            JOIN ai_providers p ON m.provider_id = p.id
            WHERE ($1::text IS NULL OR p.code = $1)
              AND ($2::text IS NULL OR m.model_type = $2)
              AND ($3 = FALSE OR m.is_enabled = TRUE)
            ORDER BY
              COALESCE((m.capabilities->>'sort')::int, 999999) ASC,
              m.is_enabled DESC,
              p.priority DESC,
              m.display_name
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, provider_code, model_type, enabled_only)
        
        return [
            ModelInfo(
                id=row["id"],
                provider_id=row["provider_id"],
                provider_code=row["provider_code"],
                model_id=row["model_id"],
                display_name=row["display_name"],
                model_type=row["model_type"],
                context_window=row["context_window"],
                max_output_tokens=row["max_output_tokens"],
                input_cost_per_1k=float(row["input_cost_per_1k"]) if row["input_cost_per_1k"] else None,
                output_cost_per_1k=float(row["output_cost_per_1k"]) if row["output_cost_per_1k"] else None,
                capabilities=_parse_json(row["capabilities"]),
                is_enabled=row["is_enabled"],
            )
            for row in rows
        ]

    async def get_model(self, model_id: str, provider_code: str | None = None) -> ModelInfo | None:
        """Get model by model_id."""
        cache_key = f"{provider_code or ''}:{model_id}"
        if cache_key in self._model_cache:
            return self._model_cache[cache_key]
        
        query = """
            SELECT m.id, m.provider_id, p.code as provider_code, m.model_id, 
                   m.display_name, m.model_type, m.context_window, m.max_output_tokens,
                   m.input_cost_per_1k, m.output_cost_per_1k, m.capabilities, m.is_enabled
            FROM ai_models m
            JOIN ai_providers p ON m.provider_id = p.id
            WHERE m.model_id = $1
              AND ($2::text IS NULL OR p.code = $2)
            LIMIT 1
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, model_id, provider_code)
        
        if not row:
            return None
        
        model = ModelInfo(
            id=row["id"],
            provider_id=row["provider_id"],
            provider_code=row["provider_code"],
            model_id=row["model_id"],
            display_name=row["display_name"],
            model_type=row["model_type"],
            context_window=row["context_window"],
            max_output_tokens=row["max_output_tokens"],
            input_cost_per_1k=float(row["input_cost_per_1k"]) if row["input_cost_per_1k"] else None,
            output_cost_per_1k=float(row["output_cost_per_1k"]) if row["output_cost_per_1k"] else None,
            capabilities=_parse_json(row["capabilities"]),
            is_enabled=row["is_enabled"],
        )
        self._model_cache[cache_key] = model
        return model

    async def create_provider(
        self,
        *,
        code: str,
        name: str,
        display_name: str | None,
        api_type: str,
        base_url: str | None,
        doc_url: str | None,
        icon: str | None,
        is_enabled: bool,
        priority: int,
        capabilities: dict[str, Any],
        config_schema: dict[str, Any] | None,
    ) -> ProviderInfo:
        query = """
            INSERT INTO ai_providers
                (code, name, display_name, api_type, base_url, doc_url, icon,
                 is_enabled, priority, capabilities, config_schema)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id, code, name, display_name, api_type, base_url, doc_url, icon,
                      is_enabled, priority, capabilities, config_schema
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                query,
                code,
                name,
                display_name,
                api_type,
                base_url,
                doc_url,
                icon,
                is_enabled,
                priority,
                _encode_json(capabilities),
                _encode_json(config_schema),
            )
        self.clear_cache()
        return ProviderInfo(
            id=row["id"],
            code=row["code"],
            name=row["name"],
            display_name=row["display_name"],
            api_type=row["api_type"],
            base_url=row["base_url"],
            doc_url=row["doc_url"],
            icon=row["icon"],
            is_enabled=row["is_enabled"],
            priority=row["priority"],
            capabilities=_parse_json(row["capabilities"]),
            config_schema=_parse_json(row["config_schema"]),
        )

    async def update_provider(
        self, provider_id: int, updates: dict[str, Any]
    ) -> ProviderInfo | None:
        if not updates:
            return await self.get_provider_by_id(provider_id)
        set_clauses = []
        values: list[Any] = []
        for idx, (column, value) in enumerate(updates.items(), start=1):
            if column in {"capabilities", "config_schema"}:
                value = _encode_json(value)
            set_clauses.append(f"{column} = ${idx}")
            values.append(value)
        values.append(provider_id)
        query = f"""
            UPDATE ai_providers
            SET {", ".join(set_clauses)}
            WHERE id = ${len(values)}
            RETURNING id, code, name, display_name, api_type, base_url, doc_url, icon,
                      is_enabled, priority, capabilities, config_schema
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, *values)
        if not row:
            return None
        self.clear_cache()
        return ProviderInfo(
            id=row["id"],
            code=row["code"],
            name=row["name"],
            display_name=row["display_name"],
            api_type=row["api_type"],
            base_url=row["base_url"],
            doc_url=row["doc_url"],
            icon=row["icon"],
            is_enabled=row["is_enabled"],
            priority=row["priority"],
            capabilities=_parse_json(row["capabilities"]),
            config_schema=_parse_json(row["config_schema"]),
        )

    async def delete_provider(self, provider_id: int) -> bool:
        """Delete a provider, first clearing any related credentials and routing references."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Get credential IDs for this provider
                cred_ids = await conn.fetch(
                    "SELECT id FROM ai_credentials WHERE provider_id = $1",
                    provider_id,
                )
                cred_id_list = [row["id"] for row in cred_ids]
                
                # Clear routing references to these credentials
                if cred_id_list:
                    await conn.execute(
                        """
                        UPDATE ai_task_routing
                        SET credential_id = NULL
                        WHERE credential_id = ANY($1::bigint[])
                        """,
                        cred_id_list,
                    )
                
                # Get model IDs for this provider (to clear routing references)
                model_ids = await conn.fetch(
                    "SELECT id FROM ai_models WHERE provider_id = $1",
                    provider_id,
                )
                model_id_list = [row["id"] for row in model_ids]
                
                # Clear routing references to these models
                if model_id_list:
                    await conn.execute(
                        """
                        UPDATE ai_task_routing
                        SET primary_model_id = NULL
                        WHERE primary_model_id = ANY($1::bigint[])
                        """,
                        model_id_list,
                    )
                    await conn.execute(
                        """
                        UPDATE ai_task_routing
                        SET fallback_model_id = NULL
                        WHERE fallback_model_id = ANY($1::bigint[])
                        """,
                        model_id_list,
                    )
                
                # Delete credentials (now safe)
                await conn.execute(
                    "DELETE FROM ai_credentials WHERE provider_id = $1",
                    provider_id,
                )
                
                # Delete the provider (models will CASCADE)
                row = await conn.fetchrow(
                    "DELETE FROM ai_providers WHERE id = $1 RETURNING id",
                    provider_id,
                )
        if row:
            self.clear_cache()
            return True
        return False

    async def create_model(
        self,
        *,
        provider_code: str,
        model_id: str,
        display_name: str | None,
        model_type: str,
        context_window: int | None,
        max_output_tokens: int | None,
        input_cost_per_1k: float | None,
        output_cost_per_1k: float | None,
        capabilities: dict[str, Any],
        is_enabled: bool,
    ) -> ModelInfo | None:
        provider = await self.get_provider(provider_code)
        if not provider:
            return None
        query = """
            INSERT INTO ai_models
                (provider_id, model_id, display_name, model_type, context_window,
                 max_output_tokens, input_cost_per_1k, output_cost_per_1k,
                 capabilities, is_enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, provider_id, $11::text as provider_code, model_id, display_name,
                      model_type, context_window, max_output_tokens, input_cost_per_1k,
                      output_cost_per_1k, capabilities, is_enabled
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                query,
                provider.id,
                model_id,
                display_name,
                model_type,
                context_window,
                max_output_tokens,
                input_cost_per_1k,
                output_cost_per_1k,
                _encode_json(capabilities),
                is_enabled,
                provider.code,
            )
        self.clear_cache()
        return ModelInfo(
            id=row["id"],
            provider_id=row["provider_id"],
            provider_code=row["provider_code"],
            model_id=row["model_id"],
            display_name=row["display_name"],
            model_type=row["model_type"],
            context_window=row["context_window"],
            max_output_tokens=row["max_output_tokens"],
            input_cost_per_1k=float(row["input_cost_per_1k"]) if row["input_cost_per_1k"] else None,
            output_cost_per_1k=float(row["output_cost_per_1k"]) if row["output_cost_per_1k"] else None,
            capabilities=_parse_json(row["capabilities"]),
            is_enabled=row["is_enabled"],
        )

    async def update_model(self, model_db_id: int, updates: dict[str, Any]) -> ModelInfo | None:
        if not updates:
            return await self.get_model_by_id(model_db_id)
        set_clauses = []
        values: list[Any] = []
        for idx, (column, value) in enumerate(updates.items(), start=1):
            if column == "capabilities":
                value = _encode_json(value)
            set_clauses.append(f"{column} = ${idx}")
            values.append(value)
        values.append(model_db_id)
        query = f"""
            UPDATE ai_models
            SET {", ".join(set_clauses)}
            WHERE id = ${len(values)}
            RETURNING id, provider_id, model_id, display_name, model_type, context_window,
                      max_output_tokens, input_cost_per_1k, output_cost_per_1k,
                      capabilities, is_enabled
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, *values)
        if not row:
            return None
        provider = await self.get_provider_by_id(row["provider_id"])
        self.clear_cache()
        return ModelInfo(
            id=row["id"],
            provider_id=row["provider_id"],
            provider_code=provider.code if provider else "",
            model_id=row["model_id"],
            display_name=row["display_name"],
            model_type=row["model_type"],
            context_window=row["context_window"],
            max_output_tokens=row["max_output_tokens"],
            input_cost_per_1k=float(row["input_cost_per_1k"]) if row["input_cost_per_1k"] else None,
            output_cost_per_1k=float(row["output_cost_per_1k"]) if row["output_cost_per_1k"] else None,
            capabilities=_parse_json(row["capabilities"]),
            is_enabled=row["is_enabled"],
        )

    async def delete_model(self, model_db_id: int) -> bool:
        """Delete a model, first clearing any routing references."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Clear references in ai_task_routing to avoid FK constraint errors
                await conn.execute(
                    """
                    UPDATE ai_task_routing
                    SET primary_model_id = NULL
                    WHERE primary_model_id = $1
                    """,
                    model_db_id,
                )
                await conn.execute(
                    """
                    UPDATE ai_task_routing
                    SET fallback_model_id = NULL
                    WHERE fallback_model_id = $1
                    """,
                    model_db_id,
                )
                # Now delete the model
                row = await conn.fetchrow(
                    "DELETE FROM ai_models WHERE id = $1 RETURNING id",
                    model_db_id,
                )
        if row:
            self.clear_cache()
            return True
        return False

    async def bulk_insert_models(self, provider_code: str, models: list[Any]) -> int:
        """Bulk insert models (ignore duplicates)."""
        if not models:
            return 0
        provider = await self.get_provider(provider_code)
        if not provider:
            return 0

        query = """
            INSERT INTO ai_models
                (provider_id, model_id, display_name, model_type, context_window,
                 max_output_tokens, input_cost_per_1k, output_cost_per_1k, capabilities, is_enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (provider_id, model_id) DO NOTHING
        """
        values = [
            (
                provider.id,
                m.model_id,
                m.display_name,
                m.model_type,
                m.context_window,
                m.max_output_tokens,
                m.input_cost_per_1k,
                m.output_cost_per_1k,
                _encode_json(m.capabilities),
                m.is_enabled,
            )
            for m in models
        ]

        async with self.pool.acquire() as conn:
            await conn.executemany(query, values)

        self.clear_cache()
        return len(values)

    async def delete_models_by_provider(self, provider_code: str, source: str | None = None) -> int:
        """Delete models for a provider (optionally filtered by source)."""
        provider = await self.get_provider(provider_code)
        if not provider:
            return 0

        if source:
            query = """
                DELETE FROM ai_models
                WHERE provider_id = $1
                  AND COALESCE(capabilities->>'source', '') = $2
                RETURNING id
            """
            params = (provider.id, source)
        else:
            query = "DELETE FROM ai_models WHERE provider_id = $1 RETURNING id"
            params = (provider.id,)

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, *params)

        if rows:
            self.clear_cache()
        return len(rows)

    async def batch_toggle_models(self, ids: list[int], enabled: bool) -> int:
        """Batch toggle model enabled state by ids."""
        if not ids:
            return 0
        query = """
            UPDATE ai_models
            SET is_enabled = $2
            WHERE id = ANY($1::bigint[])
            RETURNING id
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, ids, enabled)
        if rows:
            self.clear_cache()
        return len(rows)

    async def update_models_sort(self, items: list[dict[str, int]]) -> int:
        """Update model sort order using capabilities.sort."""
        if not items:
            return 0
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                for item in items:
                    await conn.execute(
                        """
                        UPDATE ai_models
                        SET capabilities = COALESCE(capabilities, '{}'::jsonb) || $2::jsonb
                        WHERE id = $1
                        """,
                        item["id"],
                        _encode_json({"sort": item["sort"]}),
                    )
        self.clear_cache()
        return len(items)

    async def get_provider_by_id(self, provider_id: int) -> ProviderInfo | None:
        query = """
            SELECT id, code, name, display_name, api_type, base_url, doc_url, icon,
                   is_enabled, priority, capabilities, config_schema
            FROM ai_providers
            WHERE id = $1
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, provider_id)
        if not row:
            return None
        return ProviderInfo(
            id=row["id"],
            code=row["code"],
            name=row["name"],
            display_name=row["display_name"],
            api_type=row["api_type"],
            base_url=row["base_url"],
            doc_url=row["doc_url"],
            icon=row["icon"],
            is_enabled=row["is_enabled"],
            priority=row["priority"],
            capabilities=_parse_json(row["capabilities"]),
            config_schema=_parse_json(row["config_schema"]),
        )

    async def get_model_by_id(self, model_db_id: int) -> ModelInfo | None:
        query = """
            SELECT m.id, m.provider_id, p.code as provider_code, m.model_id,
                   m.display_name, m.model_type, m.context_window, m.max_output_tokens,
                   m.input_cost_per_1k, m.output_cost_per_1k, m.capabilities, m.is_enabled
            FROM ai_models m
            JOIN ai_providers p ON m.provider_id = p.id
            WHERE m.id = $1
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, model_db_id)
        if not row:
            return None
        return ModelInfo(
            id=row["id"],
            provider_id=row["provider_id"],
            provider_code=row["provider_code"],
            model_id=row["model_id"],
            display_name=row["display_name"],
            model_type=row["model_type"],
            context_window=row["context_window"],
            max_output_tokens=row["max_output_tokens"],
            input_cost_per_1k=float(row["input_cost_per_1k"]) if row["input_cost_per_1k"] else None,
            output_cost_per_1k=float(row["output_cost_per_1k"]) if row["output_cost_per_1k"] else None,
            capabilities=_parse_json(row["capabilities"]),
            is_enabled=row["is_enabled"],
        )

    def clear_cache(self) -> None:
        """Clear provider and model caches."""
        self._provider_cache.clear()
        self._model_cache.clear()
