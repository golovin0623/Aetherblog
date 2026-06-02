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

from app.services.pricing_catalog import CatalogEntry, get_catalog
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


@dataclass
class PricingSyncProposal:
    """一条「把数据源价格同步进全局表」的预览提案。"""
    model_id: str
    display_name: str | None
    matched_key: str | None        # 命中的数据源 key（None = 未匹配）
    match_form: str | None         # 命中所用的归一化形式
    source_input_per_1m: float | None
    source_output_per_1m: float | None
    source_cached_input_per_1m: float | None
    current_input_per_1m: float | None
    current_output_per_1m: float | None
    current_cached_input_per_1m: float | None
    currency: str | None
    has_global: bool
    status: str                    # new | update | unchanged | no_match
    will_apply: bool               # 按当前 overwrite 策略是否会被写入


@dataclass
class PricingSyncResult:
    source: str
    total_candidates: int
    matched: int
    created: int
    updated: int
    skipped: int


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


def _model_currency(row: dict[str, Any]) -> str:
    """读取模型的币种；未声明则与默认 USD 一致。

    全局表的 currency 列默认 USD，模型侧只能从 capabilities.pricing.currency
    读取。同步判定要把币种纳入对比，避免数值相同但币种不同的行被误标为
    「全部同步」（1.0 USD ≠ 1.0 CNY）。
    """
    capabilities = _parse_json(row.get("capabilities"))
    pricing = capabilities.get("pricing") if isinstance(capabilities, dict) else None
    if isinstance(pricing, dict):
        currency = pricing.get("currency")
        if isinstance(currency, str) and currency.strip():
            return currency.strip().upper()
    return "USD"


def _currency_matches(model_currency: str | None, global_currency: str | None) -> bool:
    """两条价格是否同币种，缺省皆视为 USD。"""
    a = (model_currency or "USD").upper()
    b = (global_currency or "USD").upper()
    return a == b


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
            global_currency = r["currency"] or "USD"
            in_sync = sum(
                1
                for rel in related
                if _approx_equal(_model_input_per_1m(rel), global_input)
                and _approx_equal(_model_output_per_1m(rel), global_output)
                and _approx_equal(_model_cached_input_per_1m(rel), global_cached)
                and _currency_matches(_model_currency(rel), global_currency)
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

    async def coverage(self, *, enabled_only: bool = True) -> list[GlobalPricingCoverage]:
        """以「ai_models 中出现过的 distinct model_id」为左表，
        join 全局价格表，给出每个 model_id 的覆盖与同步状况。

        前端用这张表实现「已配置 / 未配置 / 部分脱锚」三档过滤。

        默认（``enabled_only=True``）仅统计「供应商启用」的模型 —— 即
        ``m.is_enabled AND p.is_enabled``（与 provider_registry 取用模型的口径一致），
        因为全量模型目录里绝大多数是从远程拉取但从未启用的条目，对定价维护没有意义。
        传 ``enabled_only=False`` 可退回全量目录视图。
        """
        async with self.pool.acquire() as conn:
            model_rows = await conn.fetch(
                """
                SELECT m.model_id, m.display_name, m.input_cost_per_1k,
                       m.output_cost_per_1k, m.capabilities, p.code AS provider_code
                FROM ai_models m
                JOIN ai_providers p ON p.id = m.provider_id
                WHERE ($1 = FALSE OR (m.is_enabled = TRUE AND p.is_enabled = TRUE))
                """,
                enabled_only,
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
            global_currency = (g["currency"] if g else None) or "USD"

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
                    and _currency_matches(_model_currency(rel), global_currency)
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
    # 自动同步：数据源价格目录（LiteLLM）→ 全局表
    # ------------------------------------------------------------

    @staticmethod
    def _proposal_status(
        entry: CatalogEntry, cov: GlobalPricingCoverage
    ) -> str:
        """与全局现值比对，给出 new / update / unchanged。

        只比对数据源「确有提供」的子价（input/output/cached）；数据源未提供
        的字段（值为 None）由 apply 路径保留操作员现值、不视为差异 —— 否则
        会与「保留缺失项」的写入语义打架，导致 status 永远停在 update、反复
        apply 只刷 updated_at 而数值不收敛。
        """
        if not cov.has_global:
            return "new"
        same_numbers = True
        if entry.input_per_1m is not None:
            same_numbers = same_numbers and _approx_equal(
                entry.input_per_1m, cov.global_input_per_1m
            )
        if entry.output_per_1m is not None:
            same_numbers = same_numbers and _approx_equal(
                entry.output_per_1m, cov.global_output_per_1m
            )
        if entry.cached_input_per_1m is not None:
            same_numbers = same_numbers and _approx_equal(
                entry.cached_input_per_1m, cov.global_cached_input_per_1m
            )
        # 数据源恒为 USD；现值若是别的币种，即使数字相同也算需要更新。
        same_currency = (cov.currency or "USD").upper() == "USD"
        return "unchanged" if (same_numbers and same_currency) else "update"

    async def preview_catalog_sync(
        self,
        *,
        enabled_only: bool = True,
        overwrite_existing: bool = False,
        source: str = "litellm",
    ) -> tuple[str, int, list[PricingSyncProposal]]:
        """把（默认启用的）model_id 逐个匹配数据源价格，给出 diff 预览。

        Returns: (source, source_model_count, proposals)
        """
        catalog = get_catalog(source, force_reload=True)
        coverage_rows = await self.coverage(enabled_only=enabled_only)

        proposals: list[PricingSyncProposal] = []
        for cov in coverage_rows:
            entry, form = catalog.match(cov.model_id)
            if entry is None:
                proposals.append(
                    PricingSyncProposal(
                        model_id=cov.model_id,
                        display_name=cov.display_name,
                        matched_key=None,
                        match_form=None,
                        source_input_per_1m=None,
                        source_output_per_1m=None,
                        source_cached_input_per_1m=None,
                        current_input_per_1m=cov.global_input_per_1m,
                        current_output_per_1m=cov.global_output_per_1m,
                        current_cached_input_per_1m=cov.global_cached_input_per_1m,
                        currency=cov.currency,
                        has_global=cov.has_global,
                        status="no_match",
                        will_apply=False,
                    )
                )
                continue

            status = self._proposal_status(entry, cov)
            will_apply = status == "new" or (status == "update" and overwrite_existing)
            proposals.append(
                PricingSyncProposal(
                    model_id=cov.model_id,
                    display_name=cov.display_name,
                    matched_key=entry.source_key,
                    match_form=form,
                    source_input_per_1m=entry.input_per_1m,
                    source_output_per_1m=entry.output_per_1m,
                    source_cached_input_per_1m=entry.cached_input_per_1m,
                    current_input_per_1m=cov.global_input_per_1m,
                    current_output_per_1m=cov.global_output_per_1m,
                    current_cached_input_per_1m=cov.global_cached_input_per_1m,
                    currency=cov.currency,
                    has_global=cov.has_global,
                    status=status,
                    will_apply=will_apply,
                )
            )
        return catalog.source, catalog.model_count, proposals

    async def apply_catalog_sync(
        self,
        *,
        model_ids: list[str] | None = None,
        enabled_only: bool = True,
        overwrite_existing: bool = False,
        source: str = "litellm",
    ) -> PricingSyncResult:
        """把数据源价格写入全局表。

        服务端按 model_id 重新匹配数据源价格（不信任客户端传来的数值）。
        ``model_ids`` 语义：``None``（省略）= 同步全部可同步项（供编程调用）；
        显式给出列表 = 只同步列表里的 model_id；显式空列表 ``[]`` = 不同步任何项
        （前端「未勾选任何项」即此意，按钮也会禁用，故 ``[]`` 不会误同步全部）。
        已有全局价格的 model_id：仅在 ``overwrite_existing=True`` 时更新，
        且更新时保留操作员维护的 notes / display_name。
        """
        catalog = get_catalog(source, force_reload=True)
        coverage_rows = await self.coverage(enabled_only=enabled_only)
        selected = set(model_ids) if model_ids is not None else None

        # overwrite 时一次性批量取回待更新行的元数据，避免循环内 N+1 查询。
        existing_meta: dict[str, dict[str, Any]] = {}
        if overwrite_existing:
            targets = [
                cov.model_id
                for cov in coverage_rows
                if cov.has_global and (selected is None or cov.model_id in selected)
            ]
            if targets:
                async with self.pool.acquire() as conn:
                    rows = await conn.fetch(
                        """
                        SELECT model_id, display_name, pricing, notes
                        FROM ai_global_pricing
                        WHERE model_id = ANY($1::text[])
                        """,
                        targets,
                    )
                for r in rows:
                    existing_meta[r["model_id"]] = {
                        "display_name": r["display_name"],
                        "pricing": _parse_json(r["pricing"]),
                        "notes": r["notes"],
                    }

        matched = created = updated = skipped = 0
        for cov in coverage_rows:
            if selected is not None and cov.model_id not in selected:
                continue
            entry, _form = catalog.match(cov.model_id)
            if entry is None:
                continue
            matched += 1

            if cov.has_global:
                if not overwrite_existing:
                    skipped += 1
                    continue
                if self._proposal_status(entry, cov) == "unchanged":
                    skipped += 1
                    continue
                # 保留操作员维护的元数据：notes / display_name + pricing JSON 里的
                # 扩展字段（custom units / audioInput / 其它非 LiteLLM 键）。
                # 标准 input/output/cached 单价由 upsert 内的
                # _sync_model_pricing_capabilities 用下面的数据源价格刷新。
                existing = existing_meta.get(cov.model_id)
                display_name = existing["display_name"] if existing else cov.display_name
                notes = existing["notes"] if existing else None
                pricing = dict(existing["pricing"]) if existing else {}
            else:
                display_name = cov.display_name
                notes = None
                pricing = {}

            pricing.update(
                {
                    "currency": "USD",
                    "source": catalog.source,
                    "sourceKey": entry.source_key,
                }
            )
            if entry.mode:
                pricing["mode"] = entry.mode

            await self.upsert(
                model_id=cov.model_id,
                display_name=display_name,
                currency="USD",
                input_cost_per_1m=entry.input_per_1m,
                output_cost_per_1m=entry.output_per_1m,
                cached_input_cost_per_1m=entry.cached_input_per_1m,
                pricing=pricing,
                notes=notes,
            )
            if cov.has_global:
                updated += 1
            else:
                created += 1

        return PricingSyncResult(
            source=catalog.source,
            total_candidates=len(coverage_rows),
            matched=matched,
            created=created,
            updated=updated,
            skipped=skipped,
        )

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

                    # overwrite=False 时：仅作为 target_in/out/cached 的解析依据；
                    # 不再因为三个核心价格齐全就 fast-path skip —— 扩展键
                    # (currency / audioInput / 其他) 仍可能缺失，需要补齐。
                    if not overwrite_existing:
                        existing_in = _model_input_per_1m(row)
                        existing_out = _model_output_per_1m(row)
                        existing_cached = _model_cached_input_per_1m(row)
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
                    if overwrite_existing:
                        # 完全替换为全局基准 —— 模型上残留的旧键（含 pricing.input
                        # 等）必须被清掉，否则全局的"清空"无法传播：_sync 会从
                        # 旧 pricing.input 解析回老数值。
                        merged_pricing = {
                            k: v for k, v in (global_row.pricing or {}).items() if k != "units"
                        }
                        if global_row.input_cost_per_1m is None:
                            merged_pricing.pop("input", None)
                        if global_row.output_cost_per_1m is None:
                            merged_pricing.pop("output", None)
                        if global_row.cached_input_cost_per_1m is None:
                            merged_pricing.pop("cachedInput", None)
                        if global_row.currency:
                            merged_pricing["currency"] = global_row.currency
                    else:
                        merged_pricing = dict(capabilities.get("pricing") or {})
                        for k, v in (global_row.pricing or {}).items():
                            if k == "units":
                                continue
                            # 仅填充缺失的扩展键，保留模型自有的 currency /
                            # audioInput / 其他自定义字段
                            if k in merged_pricing:
                                continue
                            merged_pricing[k] = v
                        if global_row.currency and not merged_pricing.get("currency"):
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

                    # 与行的当前状态对比，确认是否真的需要 UPDATE —— 避免
                    # overwrite=False 下扫到完全对齐的行也徒劳 bump updated_at,
                    # 同时仍能体现 "skipped" 计数语义。
                    old_input_1k = _to_float(row.get("input_cost_per_1k"))
                    old_output_1k = _to_float(row.get("output_cost_per_1k"))
                    old_caps = _parse_json(row.get("capabilities")) or {}
                    if (
                        _approx_equal(old_input_1k, new_input_1k)
                        and _approx_equal(old_output_1k, new_output_1k)
                        and old_caps == normalized_caps
                    ):
                        skipped += 1
                        continue

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
        """从指定 ai_models 行把价格 / 高级 pricing JSON 写回 ai_global_pricing。

        反向同步只关心价格 / pricing JSON，不应擦除 ai_global_pricing 上由
        操作员维护的元数据 (notes / display_name)。先把现存元数据捞出来，
        当 ai_models 这边没有更新值（NULL）时透传给 upsert，避免 ON CONFLICT
        分支用 None 覆盖。
        """
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
            existing = await conn.fetchrow(
                "SELECT display_name, notes FROM ai_global_pricing WHERE model_id = $1",
                row["model_id"],
            )

        model_dict = dict(row)
        capabilities = _parse_json(model_dict.get("capabilities"))
        pricing = capabilities.get("pricing") if isinstance(capabilities, dict) else {}
        if not isinstance(pricing, dict):
            pricing = {}
        currency = pricing.get("currency") or "USD"

        existing_display = existing["display_name"] if existing else None
        existing_notes = existing["notes"] if existing else None
        # ai_models.display_name 可能为 NULL —— 这种情况下保留全局表已有的
        # 展示名，而不是用 None 静默覆盖。
        next_display = row["display_name"] if row["display_name"] else existing_display

        return await self.upsert(
            model_id=row["model_id"],
            display_name=next_display,
            currency=currency,
            input_cost_per_1m=_model_input_per_1m(model_dict),
            output_cost_per_1m=_model_output_per_1m(model_dict),
            cached_input_cost_per_1m=_model_cached_input_per_1m(model_dict),
            pricing=pricing,
            notes=existing_notes,
        )
