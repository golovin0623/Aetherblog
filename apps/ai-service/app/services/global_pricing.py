# ref: §5.1 - 全局模型价格服务
"""
全局模型价格管理。

核心需求：在多个 provider 下重复出现的同一个 model_id
（例如 ``gpt-4o-mini`` 出现在 OpenAI / AIHubMix / AI302 多个供应商下），
其单价（输入 / 输出 / 缓存读取）天然是同一个值，但目前每个供应商行都要单独维护。

本模块对外暴露：

* CRUD：列表 / 读取 / upsert / 删除
* coverage：把数据库里所有 distinct model_id 与全局表 join，给前端一张
  「全局已配置 / 未配置 / 部分同步 / 完全脱锚」的总览表。
* apply：把全局价格批量回填到所有同名 ``model_id`` 的 ``ai_models`` 行。
* sync_from_model：从某条具体 ``ai_models`` 行把价格写回全局表，作为
  「单条编辑后一键同步」的反向闭环。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import asyncpg

from app.services.provider_registry import (
    _encode_json,
    _parse_json,
    _sync_model_pricing_capabilities,
    _to_float,
)

logger = logging.getLogger("ai-service")


@dataclass
class GlobalPricingRow:
    id: int
    model_id: str
    display_name: str | None
    currency: str
    input_cost_per_1m: float | None
    output_cost_per_1m: float | None
    cached_input_cost_per_1m: float | None
    pricing: dict[str, Any]
    notes: str | None
    updated_at: datetime
    provider_count: int = 0
    in_sync_count: int = 0


@dataclass
class GlobalPricingCoverage:
    model_id: str
    display_name: str | None
    provider_count: int
    has_global: bool
    in_sync_count: int
    out_of_sync_count: int
    missing_count: int
    global_input_per_1m: float | None
    global_output_per_1m: float | None
    global_cached_input_per_1m: float | None
    currency: str | None
    providers: list[str] = field(default_factory=list)


def _model_input_per_1m(row: dict[str, Any]) -> float | None:
    """复用 capabilities 优先 → input_cost_per_1k * 1000 兜底的同一规则。"""
    capabilities = _parse_json(row.get("capabilities"))
    pricing = capabilities.get("pricing") if isinstance(capabilities, dict) else None
    if isinstance(pricing, dict):
        for key in ("input",):
            if key in pricing and pricing[key] is not None:
                v = _to_float(pricing[key])
                if v is not None:
                    return v
    legacy = _to_float(row.get("input_cost_per_1k"))
    return legacy * 1000 if legacy is not None else None


def _model_output_per_1m(row: dict[str, Any]) -> float | None:
    capabilities = _parse_json(row.get("capabilities"))
    pricing = capabilities.get("pricing") if isinstance(capabilities, dict) else None
    if isinstance(pricing, dict):
        v = _to_float(pricing.get("output"))
        if v is not None:
            return v
    legacy = _to_float(row.get("output_cost_per_1k"))
    return legacy * 1000 if legacy is not None else None


def _model_cached_input_per_1m(row: dict[str, Any]) -> float | None:
    capabilities = _parse_json(row.get("capabilities"))
    pricing = capabilities.get("pricing") if isinstance(capabilities, dict) else None
    if isinstance(pricing, dict):
        v = _to_float(pricing.get("cachedInput"))
        if v is not None:
            return v
    return None


def _approx_equal(a: float | None, b: float | None) -> bool:
    """两个 1M 单价是否「实际上一致」。

    ai_models 这一侧把 1M 单价换算成 1K 后用 DECIMAL(12,8) 储存，
    再读回乘 1000 会引入约 1e-5 量级的浮点漂移。这里用相对误差 1e-5
    判定，避免 UI 把数值上等同的行误判为「已脱锚」。
    """
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    if a == b:
        return True
    diff = abs(a - b)
    scale = max(abs(a), abs(b))
    return diff <= max(1e-6, scale * 1e-5)


class GlobalPricingService:
    """``ai_global_pricing`` 表的访问层 + 跨表批量操作。"""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool

    # ------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------

    async def list_all(self) -> list[GlobalPricingRow]:
        """列出全部全局价格条目，并附带每个 model_id 在 ai_models 中的覆盖统计。"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, model_id, display_name, currency,
                       input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m,
                       pricing, notes, updated_at
                FROM ai_global_pricing
                ORDER BY model_id ASC
                """
            )
            # 一次性取出所有 ai_models 用于覆盖统计，避免 N+1
            model_rows = await conn.fetch(
                """
                SELECT m.model_id, m.input_cost_per_1k, m.output_cost_per_1k, m.capabilities
                FROM ai_models m
                """
            )

        # 按 model_id 聚合 ai_models
        by_model_id: dict[str, list[dict[str, Any]]] = {}
        for r in model_rows:
            by_model_id.setdefault(r["model_id"], []).append(dict(r))

        result: list[GlobalPricingRow] = []
        for r in rows:
            model_id = r["model_id"]
            related = by_model_id.get(model_id, [])
            global_input = _to_float(r["input_cost_per_1m"])
            global_output = _to_float(r["output_cost_per_1m"])
            global_cached = _to_float(r["cached_input_cost_per_1m"])
            in_sync = sum(
                1
                for rel in related
                if _approx_equal(_model_input_per_1m(rel), global_input)
                and _approx_equal(_model_output_per_1m(rel), global_output)
                and _approx_equal(_model_cached_input_per_1m(rel), global_cached)
            )
            result.append(
                GlobalPricingRow(
                    id=r["id"],
                    model_id=model_id,
                    display_name=r["display_name"],
                    currency=r["currency"] or "USD",
                    input_cost_per_1m=global_input,
                    output_cost_per_1m=global_output,
                    cached_input_cost_per_1m=global_cached,
                    pricing=_parse_json(r["pricing"]),
                    notes=r["notes"],
                    updated_at=r["updated_at"],
                    provider_count=len(related),
                    in_sync_count=in_sync,
                )
            )
        return result

    async def get_by_model_id(self, model_id: str) -> GlobalPricingRow | None:
        async with self.pool.acquire() as conn:
            r = await conn.fetchrow(
                """
                SELECT id, model_id, display_name, currency,
                       input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m,
                       pricing, notes, updated_at
                FROM ai_global_pricing
                WHERE model_id = $1
                """,
                model_id,
            )
        if not r:
            return None
        return GlobalPricingRow(
            id=r["id"],
            model_id=r["model_id"],
            display_name=r["display_name"],
            currency=r["currency"] or "USD",
            input_cost_per_1m=_to_float(r["input_cost_per_1m"]),
            output_cost_per_1m=_to_float(r["output_cost_per_1m"]),
            cached_input_cost_per_1m=_to_float(r["cached_input_cost_per_1m"]),
            pricing=_parse_json(r["pricing"]),
            notes=r["notes"],
            updated_at=r["updated_at"],
        )

    async def upsert(
        self,
        *,
        model_id: str,
        display_name: str | None,
        currency: str,
        input_cost_per_1m: float | None,
        output_cost_per_1m: float | None,
        cached_input_cost_per_1m: float | None,
        pricing: dict[str, Any],
        notes: str | None,
    ) -> GlobalPricingRow:
        # 用 _sync_model_pricing_capabilities 的同一套规则把单价与 pricing JSON
        # 反复对齐，避免「填了三个数字但 pricing.units 还停在旧值」
        (
            resolved_input,
            resolved_output,
            resolved_cached,
            normalized_pricing_caps,
        ) = _sync_model_pricing_capabilities(
            {"pricing": pricing} if pricing else {},
            input_cost_per_1m=input_cost_per_1m,
            output_cost_per_1m=output_cost_per_1m,
            cached_input_cost_per_1m=cached_input_cost_per_1m,
        )
        normalized_pricing = (
            normalized_pricing_caps.get("pricing")
            if isinstance(normalized_pricing_caps, dict)
            else {}
        ) or {}

        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO ai_global_pricing
                    (model_id, display_name, currency,
                     input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m,
                     pricing, notes, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
                ON CONFLICT (model_id) DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    currency = EXCLUDED.currency,
                    input_cost_per_1m = EXCLUDED.input_cost_per_1m,
                    output_cost_per_1m = EXCLUDED.output_cost_per_1m,
                    cached_input_cost_per_1m = EXCLUDED.cached_input_cost_per_1m,
                    pricing = EXCLUDED.pricing,
                    notes = EXCLUDED.notes,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id, model_id, display_name, currency,
                          input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m,
                          pricing, notes, updated_at
                """,
                model_id,
                display_name,
                currency or "USD",
                resolved_input,
                resolved_output,
                resolved_cached,
                _encode_json(normalized_pricing),
                notes,
            )
        return GlobalPricingRow(
            id=row["id"],
            model_id=row["model_id"],
            display_name=row["display_name"],
            currency=row["currency"] or "USD",
            input_cost_per_1m=_to_float(row["input_cost_per_1m"]),
            output_cost_per_1m=_to_float(row["output_cost_per_1m"]),
            cached_input_cost_per_1m=_to_float(row["cached_input_cost_per_1m"]),
            pricing=_parse_json(row["pricing"]),
            notes=row["notes"],
            updated_at=row["updated_at"],
        )

    async def delete(self, model_id: str) -> bool:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "DELETE FROM ai_global_pricing WHERE model_id = $1 RETURNING id",
                model_id,
            )
        return row is not None

    # ------------------------------------------------------------
    # 覆盖率视图：所有 distinct model_id × 全局表
    # ------------------------------------------------------------

    async def coverage(self) -> list[GlobalPricingCoverage]:
        """以「全部 ai_models 中出现过的 distinct model_id」为左表，
        join 全局价格表，给出每个 model_id 的覆盖与同步状况。

        前端用这张表实现「已配置 / 未配置 / 部分脱锚」三档过滤。
        """
        async with self.pool.acquire() as conn:
            model_rows = await conn.fetch(
                """
                SELECT m.model_id, m.display_name, m.input_cost_per_1k,
                       m.output_cost_per_1k, m.capabilities, p.code AS provider_code
                FROM ai_models m
                JOIN ai_providers p ON p.id = m.provider_id
                """
            )
            global_rows = await conn.fetch(
                """
                SELECT model_id, display_name, currency,
                       input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m
                FROM ai_global_pricing
                """
            )

        global_by_id: dict[str, dict[str, Any]] = {
            g["model_id"]: dict(g) for g in global_rows
        }

        grouped: dict[str, list[dict[str, Any]]] = {}
        for r in model_rows:
            grouped.setdefault(r["model_id"], []).append(dict(r))

        out: list[GlobalPricingCoverage] = []
        for model_id, rows in sorted(grouped.items()):
            g = global_by_id.get(model_id)
            global_input = _to_float(g["input_cost_per_1m"]) if g else None
            global_output = _to_float(g["output_cost_per_1m"]) if g else None
            global_cached = _to_float(g["cached_input_cost_per_1m"]) if g else None

            in_sync = 0
            out_of_sync = 0
            missing = 0
            for rel in rows:
                m_in = _model_input_per_1m(rel)
                m_out = _model_output_per_1m(rel)
                m_cached = _model_cached_input_per_1m(rel)
                if m_in is None and m_out is None and m_cached is None:
                    missing += 1
                    continue
                if g and (
                    _approx_equal(m_in, global_input)
                    and _approx_equal(m_out, global_output)
                    and _approx_equal(m_cached, global_cached)
                ):
                    in_sync += 1
                elif g:
                    out_of_sync += 1
                else:
                    # 没有全局价格但模型自身有定价 —— 既不算 missing 也不算 in_sync,
                    # 归为 out_of_sync（前端语义：与全局基准存在差异）
                    out_of_sync += 1

            display_name: str | None = None
            if g and g.get("display_name"):
                display_name = g["display_name"]
            else:
                for rel in rows:
                    if rel.get("display_name"):
                        display_name = rel["display_name"]
                        break

            providers = sorted({rel["provider_code"] for rel in rows if rel.get("provider_code")})

            out.append(
                GlobalPricingCoverage(
                    model_id=model_id,
                    display_name=display_name,
                    provider_count=len(rows),
                    has_global=g is not None,
                    in_sync_count=in_sync,
                    out_of_sync_count=out_of_sync,
                    missing_count=missing,
                    global_input_per_1m=global_input,
                    global_output_per_1m=global_output,
                    global_cached_input_per_1m=global_cached,
                    currency=(g.get("currency") if g else None) or "USD",
                    providers=providers,
                )
            )
        return out

    # ------------------------------------------------------------
    # 批量应用：全局 → 多 provider
    # ------------------------------------------------------------

    async def apply_to_models(
        self,
        *,
        model_id: str,
        provider_codes: list[str] | None = None,
        overwrite_existing: bool = True,
    ) -> tuple[int, int, int]:
        """把全局价格写入所有同名 ai_models 行。

        Returns: (updated, skipped, target_count)
        """
        global_row = await self.get_by_model_id(model_id)
        if not global_row:
            return 0, 0, 0

        # 选出要更新的目标行
        if provider_codes:
            query = """
                SELECT m.id, m.input_cost_per_1k, m.output_cost_per_1k, m.capabilities,
                       p.code AS provider_code
                FROM ai_models m
                JOIN ai_providers p ON p.id = m.provider_id
                WHERE m.model_id = $1 AND p.code = ANY($2::text[])
            """
            params = (model_id, provider_codes)
        else:
            query = """
                SELECT m.id, m.input_cost_per_1k, m.output_cost_per_1k, m.capabilities,
                       p.code AS provider_code
                FROM ai_models m
                JOIN ai_providers p ON p.id = m.provider_id
                WHERE m.model_id = $1
            """
            params = (model_id,)

        async with self.pool.acquire() as conn:
            target_rows = await conn.fetch(query, *params)

        target_count = len(target_rows)
        updated = 0
        skipped = 0

        # 直接拿全局表的扩展 pricing 作为目标，再叠加单价
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                for rel in target_rows:
                    row = dict(rel)
                    capabilities = _parse_json(row.get("capabilities"))
                    if not isinstance(capabilities, dict):
                        capabilities = {}

                    # overwrite=False 时：只填充缺失字段
                    if not overwrite_existing:
                        existing_in = _model_input_per_1m(row)
                        existing_out = _model_output_per_1m(row)
                        existing_cached = _model_cached_input_per_1m(row)
                        if (
                            existing_in is not None
                            and existing_out is not None
                            and existing_cached is not None
                        ):
                            skipped += 1
                            continue
                        target_in = (
                            existing_in if existing_in is not None else global_row.input_cost_per_1m
                        )
                        target_out = (
                            existing_out
                            if existing_out is not None
                            else global_row.output_cost_per_1m
                        )
                        target_cached = (
                            existing_cached
                            if existing_cached is not None
                            else global_row.cached_input_cost_per_1m
                        )
                    else:
                        target_in = global_row.input_cost_per_1m
                        target_out = global_row.output_cost_per_1m
                        target_cached = global_row.cached_input_cost_per_1m

                    # 把全局表里的扩展 pricing JSON 合并进 model 的 capabilities.pricing,
                    # 然后用统一的 _sync 规范化（保留模型原本的非 pricing capabilities）。
                    merged_pricing = dict(capabilities.get("pricing") or {})
                    for k, v in (global_row.pricing or {}).items():
                        # units 会在 _sync 内重建，避免双重写入
                        if k == "units":
                            continue
                        merged_pricing[k] = v
                    if global_row.currency:
                        merged_pricing["currency"] = global_row.currency
                    capabilities["pricing"] = merged_pricing

                    (
                        resolved_in,
                        resolved_out,
                        _resolved_cached,
                        normalized_caps,
                    ) = _sync_model_pricing_capabilities(
                        capabilities,
                        input_cost_per_1m=target_in,
                        output_cost_per_1m=target_out,
                        cached_input_cost_per_1m=target_cached,
                    )

                    new_input_1k = resolved_in / 1000 if resolved_in is not None else None
                    new_output_1k = resolved_out / 1000 if resolved_out is not None else None

                    await conn.execute(
                        """
                        UPDATE ai_models
                        SET input_cost_per_1k = $1,
                            output_cost_per_1k = $2,
                            capabilities = $3,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = $4
                        """,
                        new_input_1k,
                        new_output_1k,
                        _encode_json(normalized_caps),
                        row["id"],
                    )
                    updated += 1

        return updated, skipped, target_count

    # ------------------------------------------------------------
    # 反向同步：model → 全局
    # ------------------------------------------------------------

    async def sync_from_model(self, model_db_id: int) -> GlobalPricingRow | None:
        """从指定 ai_models 行把价格 / 高级 pricing JSON 写回 ai_global_pricing。"""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT m.model_id, m.display_name, m.input_cost_per_1k,
                       m.output_cost_per_1k, m.capabilities
                FROM ai_models m
                WHERE m.id = $1
                """,
                model_db_id,
            )
        if not row:
            return None

        model_dict = dict(row)
        capabilities = _parse_json(model_dict.get("capabilities"))
        pricing = capabilities.get("pricing") if isinstance(capabilities, dict) else {}
        if not isinstance(pricing, dict):
            pricing = {}
        currency = pricing.get("currency") or "USD"

        return await self.upsert(
            model_id=row["model_id"],
            display_name=row["display_name"],
            currency=currency,
            input_cost_per_1m=_model_input_per_1m(model_dict),
            output_cost_per_1m=_model_output_per_1m(model_dict),
            cached_input_cost_per_1m=_model_cached_input_per_1m(model_dict),
            pricing=pricing,
            notes=None,
        )
