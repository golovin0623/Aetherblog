"""global_pricing 全局模型价格服务的单元测试。

覆盖：
* 模型行价格解析（capabilities.pricing 优先 → legacy input_cost_per_1k 兜底）
* 币种归一与近似相等判定（DECIMAL 12,8 往返漂移容差）
* list_all / get_by_model_id / upsert / delete 的 CRUD 映射
* coverage 覆盖率视图的 in_sync / out_of_sync / missing 三分类
* 数据源目录同步：_proposal_status 判定、preview / apply 的 diff 与写入语义
* apply_to_models 全局 → 多 provider 回填（overwrite 两种策略 + skip 判定）
* sync_from_model 反向同步保留操作员元数据
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from app.services.global_pricing import (
    GlobalPricingCoverage,
    GlobalPricingService,
    _approx_equal,
    _currency_matches,
    _model_cached_input_per_1m,
    _model_currency,
    _model_input_per_1m,
    _model_output_per_1m,
)
from app.services.pricing_catalog import CatalogEntry, PricingCatalog
from app.services.provider_registry import _sync_model_pricing_capabilities
from tests.support import FakeConn, FakePool

_NOW = datetime(2026, 8, 18, tzinfo=timezone.utc)


def _caps(pricing: dict | None) -> str:
    return json.dumps({"pricing": pricing} if pricing is not None else {})


def _global_row(**overrides) -> dict:
    row = {
        "id": 1,
        "model_id": "gpt-4o-mini",
        "display_name": "GPT-4o mini",
        "currency": "USD",
        "input_cost_per_1m": 0.15,
        "output_cost_per_1m": 0.6,
        "cached_input_cost_per_1m": 0.075,
        "pricing": json.dumps({"currency": "USD", "input": 0.15, "output": 0.6}),
        "notes": None,
        "updated_at": _NOW,
    }
    row.update(overrides)
    return row


def _coverage_row(**overrides) -> GlobalPricingCoverage:
    row = dict(
        model_id="gpt-4o-mini",
        display_name="GPT-4o mini",
        provider_count=1,
        has_global=True,
        in_sync_count=1,
        out_of_sync_count=0,
        missing_count=0,
        global_input_per_1m=0.15,
        global_output_per_1m=0.6,
        global_cached_input_per_1m=0.075,
        currency="USD",
        providers=["openai"],
    )
    row.update(overrides)
    return GlobalPricingCoverage(**row)


def _entry(**overrides) -> CatalogEntry:
    values = dict(
        source_key="gpt-4o-mini",
        input_per_1m=0.15,
        output_per_1m=0.6,
        cached_input_per_1m=0.075,
        mode="chat",
    )
    values.update(overrides)
    return CatalogEntry(**values)


def _upsert_echo_row(query: str, args: tuple) -> dict | None:
    """把 INSERT ... RETURNING 的参数按列序回显为行。"""
    if "INSERT INTO ai_global_pricing" not in query:
        return None
    return {
        "id": 99,
        "model_id": args[0],
        "display_name": args[1],
        "currency": args[2],
        "input_cost_per_1m": args[3],
        "output_cost_per_1m": args[4],
        "cached_input_cost_per_1m": args[5],
        "pricing": args[6],
        "notes": args[7],
        "updated_at": _NOW,
    }


# ------------------------------------------------------------------
# 模型行价格解析辅助
# ------------------------------------------------------------------
def test_model_prices_prefer_capabilities_pricing():
    row = {
        "capabilities": _caps({"input": 0.15, "output": 0.6, "cachedInput": 0.075}),
        "input_cost_per_1k": 0.9,  # 应被 capabilities 覆盖
        "output_cost_per_1k": 0.9,
    }
    assert _model_input_per_1m(row) == 0.15
    assert _model_output_per_1m(row) == 0.6
    assert _model_cached_input_per_1m(row) == 0.075


def test_model_prices_fall_back_to_legacy_per_1k_columns():
    row = {"capabilities": None, "input_cost_per_1k": 0.00015, "output_cost_per_1k": 0.0006}
    assert _model_input_per_1m(row) == pytest.approx(0.15)
    assert _model_output_per_1m(row) == pytest.approx(0.6)
    # cachedInput 无 legacy 列可兜底
    assert _model_cached_input_per_1m(row) is None


def test_model_prices_all_missing():
    row = {"capabilities": "not-json", "input_cost_per_1k": None, "output_cost_per_1k": None}
    assert _model_input_per_1m(row) is None
    assert _model_output_per_1m(row) is None
    assert _model_cached_input_per_1m(row) is None


def test_model_currency_normalizes_and_defaults_to_usd():
    assert _model_currency({"capabilities": _caps({"currency": " cny "})}) == "CNY"
    assert _model_currency({"capabilities": _caps({"currency": "  "})}) == "USD"
    assert _model_currency({"capabilities": _caps({})}) == "USD"
    assert _model_currency({"capabilities": None}) == "USD"


def test_currency_matches_treats_missing_as_usd():
    assert _currency_matches(None, None) is True
    assert _currency_matches("usd", "USD") is True
    assert _currency_matches(None, "USD") is True
    assert _currency_matches("CNY", "USD") is False


def test_approx_equal_tolerates_decimal_roundtrip_drift():
    assert _approx_equal(None, None) is True
    assert _approx_equal(0.15, None) is False
    assert _approx_equal(0.15, 0.15) is True
    # DECIMAL(12,8) 1K 往返引入的 1e-5 量级相对漂移
    assert _approx_equal(0.15, 0.15 * (1 + 5e-6)) is True
    assert _approx_equal(0.15, 0.16) is False
    assert _approx_equal(0.0, 0.0) is True


# ------------------------------------------------------------------
# CRUD
# ------------------------------------------------------------------
@pytest.mark.asyncio
async def test_list_all_counts_in_sync_providers():
    def fetch(query, _args):
        if "FROM ai_global_pricing" in query:
            return [_global_row()]
        if "FROM ai_models" in query:
            return [
                {  # capabilities 定价与全局一致 → in_sync
                    "model_id": "gpt-4o-mini",
                    "input_cost_per_1k": None,
                    "output_cost_per_1k": None,
                    "capabilities": _caps({"input": 0.15, "output": 0.6, "cachedInput": 0.075}),
                },
                {  # legacy 定价数值不同 → out of sync
                    "model_id": "gpt-4o-mini",
                    "input_cost_per_1k": 0.0002,
                    "output_cost_per_1k": 0.0006,
                    "capabilities": None,
                },
                {  # 其它 model_id 不参与统计
                    "model_id": "unrelated",
                    "input_cost_per_1k": None,
                    "output_cost_per_1k": None,
                    "capabilities": None,
                },
            ]
        raise AssertionError(f"unexpected query: {query}")

    service = GlobalPricingService(FakePool(FakeConn(fetch=fetch)))
    rows = await service.list_all()

    assert len(rows) == 1
    row = rows[0]
    assert row.model_id == "gpt-4o-mini"
    assert row.provider_count == 2
    assert row.in_sync_count == 1
    assert row.pricing == {"currency": "USD", "input": 0.15, "output": 0.6}


@pytest.mark.asyncio
async def test_get_by_model_id_found_and_missing():
    def fetchrow(query, args):
        assert "FROM ai_global_pricing" in query
        return _global_row(currency=None) if args[0] == "gpt-4o-mini" else None

    service = GlobalPricingService(FakePool(FakeConn(fetchrow=fetchrow)))

    row = await service.get_by_model_id("gpt-4o-mini")
    assert row is not None
    assert row.currency == "USD"  # NULL 币种归一
    assert row.input_cost_per_1m == 0.15
    assert row.pricing["input"] == 0.15

    assert await service.get_by_model_id("nope") is None


@pytest.mark.asyncio
async def test_upsert_normalizes_pricing_and_defaults_currency():
    conn = FakeConn(fetchrow=_upsert_echo_row)
    service = GlobalPricingService(FakePool(conn))

    row = await service.upsert(
        model_id="gpt-4o-mini",
        display_name="GPT-4o mini",
        currency="",
        input_cost_per_1m=0.15,
        output_cost_per_1m=0.6,
        cached_input_cost_per_1m=None,
        pricing={"currency": "USD", "audioInput": 1.5},
        notes="操作员备注",
    )

    assert row.currency == "USD"  # 空币种落回默认
    assert row.input_cost_per_1m == 0.15
    assert row.output_cost_per_1m == 0.6
    assert row.cached_input_cost_per_1m is None
    # pricing JSON 与三个单价字段被 _sync 规则对齐，扩展键保留
    assert row.pricing["input"] == 0.15
    assert row.pricing["output"] == 0.6
    assert "cachedInput" not in row.pricing
    assert row.pricing["audioInput"] == 1.5
    units = {u["name"]: u["rate"] for u in row.pricing["units"]}
    assert units == {"textInput": 0.15, "textOutput": 0.6}
    assert row.notes == "操作员备注"


@pytest.mark.asyncio
async def test_delete_reports_whether_row_existed():
    def fetchrow(query, args):
        assert "DELETE FROM ai_global_pricing" in query
        return {"id": 3} if args[0] == "exists" else None

    service = GlobalPricingService(FakePool(FakeConn(fetchrow=fetchrow)))
    assert await service.delete("exists") is True
    assert await service.delete("missing") is False


# ------------------------------------------------------------------
# coverage 覆盖率视图
# ------------------------------------------------------------------
@pytest.mark.asyncio
async def test_coverage_classifies_sync_states():
    def fetch(query, args):
        if "FROM ai_models" in query:
            assert args == (True,)  # enabled_only 透传
            return [
                {  # a：与全局一致
                    "model_id": "model-a",
                    "display_name": None,
                    "input_cost_per_1k": None,
                    "output_cost_per_1k": None,
                    "capabilities": _caps({"input": 0.15, "output": 0.6}),
                    "provider_code": "openai",
                },
                {  # a：数值一致但币种不同 → out_of_sync
                    "model_id": "model-a",
                    "display_name": "Model A (aihubmix)",
                    "input_cost_per_1k": None,
                    "output_cost_per_1k": None,
                    "capabilities": _caps({"input": 0.15, "output": 0.6, "currency": "CNY"}),
                    "provider_code": "aihubmix",
                },
                {  # a：完全没有定价 → missing
                    "model_id": "model-a",
                    "display_name": None,
                    "input_cost_per_1k": None,
                    "output_cost_per_1k": None,
                    "capabilities": None,
                    "provider_code": "ai302",
                },
                {  # b：无全局条目但自带定价 → out_of_sync
                    "model_id": "model-b",
                    "display_name": "Model B",
                    "input_cost_per_1k": 0.001,
                    "output_cost_per_1k": None,
                    "capabilities": None,
                    "provider_code": "deepseek",
                },
            ]
        if "FROM ai_global_pricing" in query:
            return [
                {
                    "model_id": "model-a",
                    "display_name": None,
                    "currency": "USD",
                    "input_cost_per_1m": 0.15,
                    "output_cost_per_1m": 0.6,
                    "cached_input_cost_per_1m": None,
                },
            ]
        raise AssertionError(f"unexpected query: {query}")

    service = GlobalPricingService(FakePool(FakeConn(fetch=fetch)))
    out = await service.coverage(enabled_only=True)

    assert [c.model_id for c in out] == ["model-a", "model-b"]
    a, b = out
    assert a.has_global is True
    assert (a.in_sync_count, a.out_of_sync_count, a.missing_count) == (1, 1, 1)
    assert a.display_name == "Model A (aihubmix)"  # 全局无展示名 → 模型行兜底
    assert a.providers == ["ai302", "aihubmix", "openai"]  # 去重排序
    assert a.currency == "USD"

    assert b.has_global is False
    assert (b.in_sync_count, b.out_of_sync_count, b.missing_count) == (0, 1, 0)
    assert b.global_input_per_1m is None
    assert b.display_name == "Model B"


# ------------------------------------------------------------------
# 数据源目录同步：_proposal_status / preview / apply
# ------------------------------------------------------------------
def test_proposal_status_new_update_unchanged():
    svc = GlobalPricingService

    assert svc._proposal_status(_entry(), _coverage_row(has_global=False)) == "new"
    assert svc._proposal_status(_entry(), _coverage_row()) == "unchanged"
    assert svc._proposal_status(_entry(input_per_1m=0.3), _coverage_row()) == "update"
    # 数据源未提供的子价（None）不参与比对
    assert (
        svc._proposal_status(
            _entry(input_per_1m=None, output_per_1m=None),
            _coverage_row(global_input_per_1m=123.0, global_output_per_1m=456.0),
        )
        == "unchanged"
    )
    # 数值一致但现值币种非 USD → 仍需更新
    assert svc._proposal_status(_entry(), _coverage_row(currency="CNY")) == "update"


def _patched_catalog(monkeypatch) -> PricingCatalog:
    catalog = PricingCatalog(
        {
            "gpt-4o-mini": _entry(),
            "deepseek-chat": _entry(
                source_key="deepseek-chat",
                input_per_1m=0.27,
                output_per_1m=1.1,
                cached_input_per_1m=None,
                mode=None,
            ),
        },
        source="litellm test",
    )
    monkeypatch.setattr(
        "app.services.global_pricing.get_catalog",
        lambda source, force_reload=False: catalog,
    )
    return catalog


def _patch_coverage(monkeypatch, service, rows):
    async def fake_coverage(*, enabled_only=True):
        return rows

    monkeypatch.setattr(service, "coverage", fake_coverage)


@pytest.mark.asyncio
async def test_preview_catalog_sync_reports_status_per_model(monkeypatch):
    _patched_catalog(monkeypatch)
    service = GlobalPricingService(FakePool(FakeConn()))
    _patch_coverage(
        monkeypatch,
        service,
        [
            _coverage_row(),  # unchanged
            _coverage_row(model_id="deepseek-chat", has_global=False,
                          global_input_per_1m=None, global_output_per_1m=None,
                          global_cached_input_per_1m=None),  # new
            _coverage_row(model_id="unknown-model"),  # no_match
        ],
    )

    source, model_count, proposals = await service.preview_catalog_sync(overwrite_existing=False)

    assert source == "litellm test"
    assert model_count == 2
    by_id = {p.model_id: p for p in proposals}
    assert by_id["gpt-4o-mini"].status == "unchanged"
    assert by_id["gpt-4o-mini"].will_apply is False
    assert by_id["deepseek-chat"].status == "new"
    assert by_id["deepseek-chat"].will_apply is True
    assert by_id["deepseek-chat"].matched_key == "deepseek-chat"
    assert by_id["deepseek-chat"].source_input_per_1m == 0.27
    assert by_id["unknown-model"].status == "no_match"
    assert by_id["unknown-model"].matched_key is None
    assert by_id["unknown-model"].will_apply is False


@pytest.mark.asyncio
async def test_preview_catalog_sync_update_needs_overwrite_flag(monkeypatch):
    _patched_catalog(monkeypatch)
    service = GlobalPricingService(FakePool(FakeConn()))
    stale = _coverage_row(global_input_per_1m=9.9)  # 与数据源 0.15 不一致

    _patch_coverage(monkeypatch, service, [stale])
    _s, _c, proposals = await service.preview_catalog_sync(overwrite_existing=False)
    assert proposals[0].status == "update"
    assert proposals[0].will_apply is False

    _patch_coverage(monkeypatch, service, [stale])
    _s, _c, proposals = await service.preview_catalog_sync(overwrite_existing=True)
    assert proposals[0].will_apply is True


@pytest.mark.asyncio
async def test_apply_catalog_sync_empty_selection_writes_nothing(monkeypatch):
    _patched_catalog(monkeypatch)
    service = GlobalPricingService(FakePool(FakeConn()))
    _patch_coverage(monkeypatch, service, [_coverage_row()])

    result = await service.apply_catalog_sync(model_ids=[])

    assert (result.matched, result.created, result.updated, result.skipped) == (0, 0, 0, 0)
    assert result.total_candidates == 1


@pytest.mark.asyncio
async def test_apply_catalog_sync_creates_new_and_skips_existing_without_overwrite(monkeypatch):
    _patched_catalog(monkeypatch)
    service = GlobalPricingService(FakePool(FakeConn()))
    _patch_coverage(
        monkeypatch,
        service,
        [
            _coverage_row(global_input_per_1m=9.9),  # 已有全局 + 未开 overwrite → skip
            _coverage_row(model_id="deepseek-chat", has_global=False, display_name="DeepSeek",
                          global_input_per_1m=None, global_output_per_1m=None,
                          global_cached_input_per_1m=None),  # 新建
            _coverage_row(model_id="unknown-model"),  # 目录未命中
        ],
    )

    upserts: list[dict] = []

    async def record_upsert(**kwargs):
        upserts.append(kwargs)

    monkeypatch.setattr(service, "upsert", record_upsert)
    result = await service.apply_catalog_sync(model_ids=None, overwrite_existing=False)

    assert (result.matched, result.created, result.updated, result.skipped) == (2, 1, 0, 1)
    assert len(upserts) == 1
    created = upserts[0]
    assert created["model_id"] == "deepseek-chat"
    assert created["display_name"] == "DeepSeek"
    assert created["currency"] == "USD"
    assert created["input_cost_per_1m"] == 0.27
    assert created["cached_input_cost_per_1m"] is None
    assert created["pricing"]["source"] == "litellm test"
    assert created["pricing"]["sourceKey"] == "deepseek-chat"
    assert created["notes"] is None


@pytest.mark.asyncio
async def test_apply_catalog_sync_overwrite_preserves_operator_metadata(monkeypatch):
    catalog = PricingCatalog(
        {
            # 数据源只给 cached 价（cache_read 独有条目）→ input/output 保留现值
            "gpt-4o-mini": _entry(input_per_1m=None, output_per_1m=None, cached_input_per_1m=0.05),
        },
        source="litellm test",
    )
    monkeypatch.setattr(
        "app.services.global_pricing.get_catalog",
        lambda source, force_reload=False: catalog,
    )

    def fetch(query, args):
        assert "FROM ai_global_pricing" in query and "ANY($1::text[])" in query
        assert args[0] == ["gpt-4o-mini"]
        return [
            {
                "model_id": "gpt-4o-mini",
                "display_name": "操作员改名",
                "pricing": json.dumps({"audioInput": 2.0, "units": [{"name": "旧"}]}),
                "notes": "手工备注",
            }
        ]

    service = GlobalPricingService(FakePool(FakeConn(fetch=fetch)))
    _patch_coverage(monkeypatch, service, [_coverage_row()])  # cached 现值 0.075 ≠ 0.05 → update

    upserts: list[dict] = []

    async def record_upsert(**kwargs):
        upserts.append(kwargs)

    monkeypatch.setattr(service, "upsert", record_upsert)
    result = await service.apply_catalog_sync(model_ids=["gpt-4o-mini"], overwrite_existing=True)

    assert (result.matched, result.created, result.updated, result.skipped) == (1, 0, 1, 0)
    updated = upserts[0]
    assert updated["display_name"] == "操作员改名"
    assert updated["notes"] == "手工备注"
    # 数据源未提供的子价保留操作员现值
    assert updated["input_cost_per_1m"] == 0.15
    assert updated["output_cost_per_1m"] == 0.6
    assert updated["cached_input_cost_per_1m"] == 0.05
    # 扩展键保留 + 数据源标记叠加
    assert updated["pricing"]["audioInput"] == 2.0
    assert updated["pricing"]["source"] == "litellm test"


@pytest.mark.asyncio
async def test_apply_catalog_sync_overwrite_skips_unchanged(monkeypatch):
    _patched_catalog(monkeypatch)

    def fetch(_query, _args):
        return [
            {"model_id": "gpt-4o-mini", "display_name": None, "pricing": None, "notes": None},
        ]

    service = GlobalPricingService(FakePool(FakeConn(fetch=fetch)))
    _patch_coverage(monkeypatch, service, [_coverage_row()])  # 与数据源完全一致

    result = await service.apply_catalog_sync(overwrite_existing=True)
    assert (result.matched, result.created, result.updated, result.skipped) == (1, 0, 0, 1)


# ------------------------------------------------------------------
# apply_to_models：全局 → 多 provider 回填
# ------------------------------------------------------------------
def _aligned_caps() -> dict:
    """构造与全局基准 overwrite 后完全一致的 capabilities。"""
    _in, _out, _cached, caps = _sync_model_pricing_capabilities(
        {"pricing": {"currency": "USD", "input": 0.15, "output": 0.6}},
        input_cost_per_1m=0.15,
        output_cost_per_1m=0.6,
        cached_input_cost_per_1m=None,
    )
    return caps


@pytest.mark.asyncio
async def test_apply_to_models_returns_zero_without_global_row():
    service = GlobalPricingService(FakePool(FakeConn()))
    assert await service.apply_to_models(model_id="missing") == (0, 0, 0)


@pytest.mark.asyncio
async def test_apply_to_models_overwrite_updates_and_skips_aligned_rows():
    aligned_caps = _aligned_caps()

    def fetchrow(query, _args):
        if "FROM ai_global_pricing" in query:
            return _global_row(cached_input_cost_per_1m=None)
        return None

    def fetch(query, args):
        assert "FROM ai_models" in query
        assert args == ("gpt-4o-mini",)
        return [
            {  # 无任何定价 → 更新
                "id": 11,
                "input_cost_per_1k": None,
                "output_cost_per_1k": None,
                "capabilities": None,
                "provider_code": "openai",
            },
            {  # 已与全局基准一致 → skip
                "id": 12,
                "input_cost_per_1k": 0.00015,
                "output_cost_per_1k": 0.0006,
                "capabilities": json.dumps(aligned_caps),
                "provider_code": "aihubmix",
            },
        ]

    conn = FakeConn(fetch=fetch, fetchrow=fetchrow)
    service = GlobalPricingService(FakePool(conn))

    updated, skipped, target_count = await service.apply_to_models(
        model_id="gpt-4o-mini", overwrite_existing=True
    )

    assert (updated, skipped, target_count) == (1, 1, 2)
    assert len(conn.execute_calls) == 1
    _query, args = conn.execute_calls[0]
    new_input_1k, new_output_1k, caps_json, row_id = args
    assert new_input_1k == pytest.approx(0.00015)
    assert new_output_1k == pytest.approx(0.0006)
    assert row_id == 11
    written = json.loads(caps_json)
    assert written["pricing"]["input"] == 0.15
    assert written["pricing"]["output"] == 0.6
    assert written["pricing"]["currency"] == "USD"


@pytest.mark.asyncio
async def test_apply_to_models_without_overwrite_keeps_model_specific_prices():
    def fetchrow(query, _args):
        if "FROM ai_global_pricing" in query:
            return _global_row(cached_input_cost_per_1m=None)
        return None

    def fetch(query, args):
        assert "ANY($2::text[])" in query  # provider_codes 过滤分支
        assert args == ("gpt-4o-mini", ["aihubmix"])
        return [
            {  # 模型自带 input 定价（0.2）→ 保留；output 缺失 → 用全局补齐
                "id": 21,
                "input_cost_per_1k": None,
                "output_cost_per_1k": None,
                "capabilities": _caps({"input": 0.2, "currency": "CNY"}),
                "provider_code": "aihubmix",
            },
        ]

    conn = FakeConn(fetch=fetch, fetchrow=fetchrow)
    service = GlobalPricingService(FakePool(conn))

    updated, skipped, target_count = await service.apply_to_models(
        model_id="gpt-4o-mini", provider_codes=["aihubmix"], overwrite_existing=False
    )

    assert (updated, skipped, target_count) == (1, 0, 1)
    _query, args = conn.execute_calls[0]
    new_input_1k, new_output_1k, caps_json, _row_id = args
    assert new_input_1k == pytest.approx(0.0002)  # 保留模型自有 input
    assert new_output_1k == pytest.approx(0.0006)  # 缺失项用全局补
    written = json.loads(caps_json)
    assert written["pricing"]["currency"] == "CNY"  # 模型自有币种不被覆盖


# ------------------------------------------------------------------
# sync_from_model：反向同步
# ------------------------------------------------------------------
@pytest.mark.asyncio
async def test_sync_from_model_returns_none_for_missing_model():
    service = GlobalPricingService(FakePool(FakeConn()))
    assert await service.sync_from_model(404) is None


@pytest.mark.asyncio
async def test_sync_from_model_preserves_operator_metadata():
    def fetchrow(query, args):
        if "FROM ai_models" in query:
            assert args == (7,)
            return {
                "model_id": "deepseek-chat",
                "display_name": None,  # 模型无展示名 → 保留全局现值
                "input_cost_per_1k": 0.0002,
                "output_cost_per_1k": None,
                "capabilities": _caps({"currency": "CNY", "cachedInput": 0.01}),
            }
        if "SELECT display_name, notes FROM ai_global_pricing" in query:
            return {"display_name": "既有展示名", "notes": "既有备注"}
        return _upsert_echo_row(query, args)

    service = GlobalPricingService(FakePool(FakeConn(fetchrow=fetchrow)))
    row = await service.sync_from_model(7)

    assert row is not None
    assert row.model_id == "deepseek-chat"
    assert row.display_name == "既有展示名"
    assert row.notes == "既有备注"
    assert row.currency == "CNY"
    assert row.input_cost_per_1m == pytest.approx(0.2)  # legacy 1K → 1M
    assert row.output_cost_per_1m is None
    assert row.cached_input_cost_per_1m == 0.01
