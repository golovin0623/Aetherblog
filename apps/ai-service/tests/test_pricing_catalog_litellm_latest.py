from app.services.pricing_catalog import (
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
