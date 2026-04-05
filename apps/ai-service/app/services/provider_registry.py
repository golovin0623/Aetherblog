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

PRICING_UNIT_MILLION_TOKENS = "millionTokens"
PRICING_UNIT_NAMES = {
    "input": "textInput",
    "output": "textOutput",
    "cached_input": "textInput_cacheRead",
}


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


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_pricing_rate(pricing: dict[str, Any], key: str) -> float | None:
    direct_key = {
        "input": "input",
        "output": "output",
        "cached_input": "cachedInput",
    }[key]
    direct_value = _to_float(pricing.get(direct_key))
    if direct_value is not None:
        return direct_value

    units = pricing.get("units")
    if not isinstance(units, list):
        return None

    expected_name = PRICING_UNIT_NAMES[key]
    for unit in units:
        if not isinstance(unit, dict):
            continue
        if unit.get("name") != expected_name:
            continue
        if unit.get("unit") != PRICING_UNIT_MILLION_TOKENS:
            continue
        rate = _to_float(unit.get("rate"))
        if rate is not None:
            return rate
    return None


def _merge_pricing_units(existing_units: list[Any], rates: dict[str, float | None]) -> list[dict[str, Any]]:
    managed_names = set(PRICING_UNIT_NAMES.values())
    merged_units = [
        unit
        for unit in existing_units
        if isinstance(unit, dict) and unit.get("name") not in managed_names
    ]
    for key in ("input", "output", "cached_input"):
        rate = rates.get(key)
        if rate is None:
            continue
        merged_units.append(
            {
                "name": PRICING_UNIT_NAMES[key],
                "rate": rate,
                "strategy": "fixed",
                "unit": PRICING_UNIT_MILLION_TOKENS,
            }
        )
    return merged_units


def _sync_model_pricing_capabilities(
    capabilities: dict[str, Any] | None,
    *,
    input_cost_per_1m: float | None = None,
    output_cost_per_1m: float | None = None,
    cached_input_cost_per_1m: float | None = None,
) -> tuple[float | None, float | None, float | None, dict[str, Any]]:
    caps = dict(capabilities or {})
    pricing = caps.get("pricing")
    if not isinstance(pricing, dict):
        pricing = {}

    resolved_input_per_1m = input_cost_per_1m
    if resolved_input_per_1m is None:
        resolved_input_per_1m = _extract_pricing_rate(pricing, "input")

    resolved_output_per_1m = output_cost_per_1m
    if resolved_output_per_1m is None:
        resolved_output_per_1m = _extract_pricing_rate(pricing, "output")

    resolved_cached_input_per_1m = cached_input_cost_per_1m
    if resolved_cached_input_per_1m is None:
        resolved_cached_input_per_1m = _extract_pricing_rate(pricing, "cached_input")

    if resolved_input_per_1m is not None:
        pricing["input"] = resolved_input_per_1m
    else:
        pricing.pop("input", None)

    if resolved_output_per_1m is not None:
        pricing["output"] = resolved_output_per_1m
    else:
        pricing.pop("output", None)

    if resolved_cached_input_per_1m is not None:
        pricing["cachedInput"] = resolved_cached_input_per_1m
    else:
        pricing.pop("cachedInput", None)

    existing_units = pricing.get("units")
    if not isinstance(existing_units, list):
        existing_units = []
    pricing["units"] = _merge_pricing_units(
        existing_units,
        {
            "input": resolved_input_per_1m,
            "output": resolved_output_per_1m,
            "cached_input": resolved_cached_input_per_1m,
        },
    )
    if not pricing["units"]:
        pricing.pop("units", None)

    if pricing:
        caps["pricing"] = pricing
    else:
        caps.pop("pricing", None)

    return (
        resolved_input_per_1m,
        resolved_output_per_1m,
        resolved_cached_input_per_1m,
        caps,
    )


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
    input_cost_per_1m: float | None
    output_cost_per_1m: float | None
    cached_input_cost_per_1m: float | None
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

    @staticmethod
    def _build_model_info(row: Any) -> ModelInfo:
        capabilities = _parse_json(row["capabilities"])
        input_cost_per_1k = _to_float(row["input_cost_per_1k"])
        output_cost_per_1k = _to_float(row["output_cost_per_1k"])
        (
            input_cost_per_1m,
            output_cost_per_1m,
            cached_input_cost_per_1m,
            normalized_capabilities,
        ) = _sync_model_pricing_capabilities(
            capabilities,
            input_cost_per_1m=input_cost_per_1k * 1000 if input_cost_per_1k is not None else None,
            output_cost_per_1m=output_cost_per_1k * 1000 if output_cost_per_1k is not None else None,
        )
        return ModelInfo(
            id=row["id"],
            provider_id=row["provider_id"],
            provider_code=row["provider_code"],
            model_id=row["model_id"],
            display_name=row["display_name"],
            model_type=row["model_type"],
            context_window=row["context_window"],
            max_output_tokens=row["max_output_tokens"],
            input_cost_per_1k=input_cost_per_1k,
            output_cost_per_1k=output_cost_per_1k,
            input_cost_per_1m=input_cost_per_1m,
            output_cost_per_1m=output_cost_per_1m,
            cached_input_cost_per_1m=cached_input_cost_per_1m,
            capabilities=normalized_capabilities,
            is_enabled=row["is_enabled"],
        )

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
        
        return [self._build_model_info(row) for row in rows]

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
        
        model = self._build_model_info(row)
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
        """Delete a provider.

        Cascade behavior:
        - ai_models: CASCADE deleted (FK with ON DELETE CASCADE)
        - ai_credentials: CASCADE deleted (FK with ON DELETE CASCADE)
        - ai_task_routing references: Automatically SET NULL via FK constraints
        """
        async with self.pool.acquire() as conn:
            # Direct delete - FK constraints will handle all cascades and nullifications
            row = await conn.fetchrow(
                "DELETE FROM ai_providers WHERE id = $1 RETURNING id",
                provider_id,
            )
        if row:
            self.clear_cache()
            return True
        return False

    async def batch_toggle_providers(self, ids: list[int], enabled: bool) -> int:
        """Batch toggle provider enabled state by ids."""
        if not ids:
            return 0
        query = """
            UPDATE ai_providers
            SET is_enabled = $2
            WHERE id = ANY($1::bigint[])
            RETURNING id
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, ids, enabled)
        if rows:
            self.clear_cache()
        return len(rows)


    async def create_model(
        self,
        *,
        provider_code: str,
        model_id: str,
        display_name: str | None,
        model_type: str,
        context_window: int | None,
        max_output_tokens: int | None,
        input_cost_per_1m: float | None,
        output_cost_per_1m: float | None,
        cached_input_cost_per_1m: float | None,
        capabilities: dict[str, Any],
        is_enabled: bool,
    ) -> ModelInfo | None:
        provider = await self.get_provider(provider_code)
        if not provider:
            return None
        (
            resolved_input_cost_per_1m,
            resolved_output_cost_per_1m,
            _resolved_cached_input_cost_per_1m,
            normalized_capabilities,
        ) = _sync_model_pricing_capabilities(
            capabilities,
            input_cost_per_1m=input_cost_per_1m,
            output_cost_per_1m=output_cost_per_1m,
            cached_input_cost_per_1m=cached_input_cost_per_1m,
        )
        input_cost_per_1k = (
            resolved_input_cost_per_1m / 1000 if resolved_input_cost_per_1m is not None else None
        )
        output_cost_per_1k = (
            resolved_output_cost_per_1m / 1000 if resolved_output_cost_per_1m is not None else None
        )
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
                _encode_json(normalized_capabilities),
                is_enabled,
                provider.code,
            )
        self.clear_cache()
        return self._build_model_info(row)

    async def update_model(self, model_db_id: int, updates: dict[str, Any]) -> ModelInfo | None:
        if not updates:
            return await self.get_model_by_id(model_db_id)
        current_model = await self.get_model_by_id(model_db_id)
        if not current_model:
            return None

        capabilities = updates.get("capabilities", current_model.capabilities)
        input_cost_per_1m = updates.pop("input_cost_per_1m", current_model.input_cost_per_1m)
        output_cost_per_1m = updates.pop("output_cost_per_1m", current_model.output_cost_per_1m)
        cached_input_cost_per_1m = updates.pop(
            "cached_input_cost_per_1m",
            current_model.cached_input_cost_per_1m,
        )
        if "input_cost_per_1k" in updates and input_cost_per_1m is None:
            input_cost_per_1m = _to_float(updates["input_cost_per_1k"])
            if input_cost_per_1m is not None:
                input_cost_per_1m *= 1000
        if "output_cost_per_1k" in updates and output_cost_per_1m is None:
            output_cost_per_1m = _to_float(updates["output_cost_per_1k"])
            if output_cost_per_1m is not None:
                output_cost_per_1m *= 1000

        (
            resolved_input_cost_per_1m,
            resolved_output_cost_per_1m,
            _resolved_cached_input_cost_per_1m,
            normalized_capabilities,
        ) = _sync_model_pricing_capabilities(
            capabilities,
            input_cost_per_1m=input_cost_per_1m,
            output_cost_per_1m=output_cost_per_1m,
            cached_input_cost_per_1m=cached_input_cost_per_1m,
        )
        updates["capabilities"] = normalized_capabilities
        updates["input_cost_per_1k"] = (
            resolved_input_cost_per_1m / 1000 if resolved_input_cost_per_1m is not None else None
        )
        updates["output_cost_per_1k"] = (
            resolved_output_cost_per_1m / 1000 if resolved_output_cost_per_1m is not None else None
        )
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
        self.clear_cache()
        provider = await self.get_provider_by_id(row["provider_id"])
        if provider:
            row = dict(row)
            row["provider_code"] = provider.code
        return self._build_model_info(row)

    async def delete_model(self, model_db_id: int) -> bool:
        """Delete a model.

        Note: ai_task_routing references will be automatically SET NULL via FK constraint.
        No manual cleanup needed.
        """
        async with self.pool.acquire() as conn:
            # Direct delete - FK constraints with ON DELETE SET NULL will handle cleanup
            row = await conn.fetchrow(
                "DELETE FROM ai_models WHERE id = $1 RETURNING id",
                model_db_id,
            )
        if row:
            self.clear_cache()
            return True
        return False

    async def bulk_insert_models(self, provider_code: str, models: list[Any]) -> int:
        """Bulk insert models (ignore duplicates).

        Returns:
            int: Actual number of models inserted (excluding duplicates)
        """
        if not models:
            return 0
        provider = await self.get_provider(provider_code)
        if not provider:
            return 0

        # Use RETURNING to count actual inserts (not skipped by ON CONFLICT)
        query = """
            INSERT INTO ai_models
                (provider_id, model_id, display_name, model_type, context_window,
                 max_output_tokens, input_cost_per_1k, output_cost_per_1k, capabilities, is_enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (provider_id, model_id) DO NOTHING
            RETURNING id
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

        inserted_count = 0
        async with self.pool.acquire() as conn:
            async with conn.transaction():  # Add transaction protection
                for value_tuple in values:
                    result = await conn.fetchrow(query, *value_tuple)
                    if result:  # Only count if actually inserted (not skipped by ON CONFLICT)
                        inserted_count += 1

        self.clear_cache()
        return inserted_count  # Return actual inserted count

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
        return self._build_model_info(row)

    def clear_cache(self) -> None:
        """Clear provider and model caches."""
        self._provider_cache.clear()
        self._model_cache.clear()
