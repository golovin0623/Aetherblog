import app.services.pricing_catalog as pricing_catalog
from app.services.pricing_catalog import (
    CatalogEntry,
    PricingCatalog,
    _entries_from_litellm_map,
)


def test_entries_from_litellm_map_converts_remote_prices():
    entries = _entries_from_litellm_map(
        {
            "sample_spec": {"input_cost_per_token": "ignore"},
            "gpt-5.5": {
                "input_cost_per_token": 0.000005,
                "output_cost_per_token": 0.00003,
                "input_cost_per_token_cache_hit": 0.0000005,
                "mode": "chat",
            },
            "chatgpt/gpt-5.3-codex-spark": {
                "mode": "chat",
            },
        }
    )

    assert set(entries) == {"gpt-5.5"}
    assert entries["gpt-5.5"].input_per_1m == 5
    assert entries["gpt-5.5"].output_per_1m == 30
    assert entries["gpt-5.5"].cached_input_per_1m == 0.5
    assert entries["gpt-5.5"].mode == "chat"


def test_pricing_catalog_matches_provider_prefixed_key():
    entries = _entries_from_litellm_map(
        {
            "novita/qwen/qwen3-embedding-8b": {
                "input_cost_per_token": 0.00000007,
                "output_cost_per_token": 0,
                "mode": "embedding",
            }
        }
    )
    catalog = PricingCatalog(entries, source="litellm latest")

    entry, match_form = catalog.match("qwen3-embedding-8b")

    assert entry is not None
    assert entry.source_key == "novita/qwen/qwen3-embedding-8b"
    assert entry.input_per_1m == 0.07
    assert entry.output_per_1m == 0
    assert match_form == "qwen3-embedding-8b"


def test_cache_only_entry_keeps_input_output_none():
    """仅有缓存价的条目：input/output 归一为 None，让 apply 路径保留操作员现值。"""
    entries = _entries_from_litellm_map(
        {
            "gpt-cache-only": {
                "cache_read_input_token_cost": 0.0000005,
                "mode": "chat",
            }
        }
    )

    assert set(entries) == {"gpt-cache-only"}
    entry = entries["gpt-cache-only"]
    assert entry.input_per_1m is None
    assert entry.output_per_1m is None
    assert entry.cached_input_per_1m == 0.5


def test_remote_failure_is_negative_cached(monkeypatch):
    """远程拉取失败后，TTL 内不再重复发起远程探测，直接回退本地表。"""
    remote_calls = {"count": 0}
    local_entry = {
        "local-model": CatalogEntry(
            source_key="local-model",
            input_per_1m=1.0,
            output_per_1m=2.0,
            cached_input_per_1m=None,
            mode="chat",
        )
    }

    def fake_remote():
        remote_calls["count"] += 1
        raise RuntimeError("network down")

    monkeypatch.setattr(pricing_catalog, "_load_litellm_remote_entries", fake_remote)
    monkeypatch.setattr(
        pricing_catalog, "_load_litellm_local_entries", lambda: local_entry
    )
    monkeypatch.setattr(pricing_catalog, "_remote_failure_until", 0.0)

    first_entries, first_source = pricing_catalog._load_litellm_entries()
    second_entries, second_source = pricing_catalog._load_litellm_entries()

    assert first_source == "litellm local"
    assert second_source == "litellm local"
    assert first_entries == local_entry == second_entries
    # 第二次调用应命中负缓存，不再触发远程探测。
    assert remote_calls["count"] == 1
