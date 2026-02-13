from __future__ import annotations

import pytest

from app.services.metrics import MetricsStore
from app.services.usage_logger import UsageLogger


class _FailingConnection:
    async def execute(self, *args, **kwargs):
        raise RuntimeError("connection reset by peer")


class _AcquireContext:
    async def __aenter__(self):
        return _FailingConnection()

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FailingPool:
    def acquire(self):
        return _AcquireContext()


def test_metrics_store_usage_log_failure_alert_and_sampling():
    store = MetricsStore(usage_log_alert_threshold=2, usage_log_sample_limit=2)

    first = store.record_usage_log_failure(
        endpoint="/api/v1/ai/summary",
        error_category="network",
        error_message="connection reset",
        request_id="req-1",
        business_success=True,
    )
    second = store.record_usage_log_failure(
        endpoint="/api/v1/ai/summary",
        error_category="network",
        error_message="connection refused",
        request_id="req-2",
        business_success=False,
    )
    third = store.record_usage_log_failure(
        endpoint="/api/v1/ai/tags",
        error_category="db_write",
        error_message="duplicate key",
        request_id="req-3",
        business_success=True,
    )

    assert first["alert_triggered"] is False
    assert second["alert_triggered"] is True
    assert third["alert_triggered"] is False

    usage_logging = store.snapshot()["usage_logging"]
    assert usage_logging["failures_total"] == 3
    assert usage_logging["degraded_success_total"] == 2
    assert usage_logging["error_categories"]["network"] == 2
    assert usage_logging["error_categories"]["db_write"] == 1
    assert usage_logging["alert_events"] == 1
    assert usage_logging["alert_active"] is True
    assert len(usage_logging["samples"]) == 2
    assert usage_logging["samples"][0]["request_id"] == "req-2"
    assert usage_logging["samples"][1]["request_id"] == "req-3"


@pytest.mark.asyncio
async def test_usage_logger_failure_records_metrics_without_blocking_business():
    metrics = MetricsStore(usage_log_alert_threshold=1, usage_log_sample_limit=5)
    usage_logger = UsageLogger(_FailingPool(), metrics)

    await usage_logger.record(
        user_id="u-1",
        endpoint="/api/v1/ai/summary",
        task_type="summary",
        provider_code="openai",
        model_id="gpt-5-mini",
        model="openai/gpt-5-mini",
        request_chars=100,
        response_chars=120,
        tokens_in=25,
        tokens_out=40,
        latency_ms=120,
        estimated_cost=0.001,
        success=True,
        cached=False,
        error_code=None,
        request_id="req-usage-1",
    )

    usage_logging = metrics.snapshot()["usage_logging"]
    assert usage_logging["failures_total"] == 1
    assert usage_logging["degraded_success_total"] == 1
    assert usage_logging["error_categories"]["network"] == 1
    sample = usage_logging["samples"][0]
    assert sample["endpoint"] == "/api/v1/ai/summary"
    assert sample["request_id"] == "req-usage-1"
    assert sample["business_success"] is True
