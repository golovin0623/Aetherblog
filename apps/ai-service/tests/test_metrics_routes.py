from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import deps as deps_module
from app.api.routes import metrics as metrics_module
from app.services.metrics import MetricsStore


@pytest.mark.asyncio
async def test_ai_metrics_route_returns_usage_logging_snapshot():
    metrics = MetricsStore(usage_log_alert_threshold=2, usage_log_sample_limit=5)
    metrics.record(
        endpoint="/api/v1/ai/summary",
        duration_ms=100.0,
        success=True,
        tokens_in=10,
        tokens_out=20,
        model="gpt-5-mini",
        cached=False,
    )
    metrics.record_usage_log_failure(
        endpoint="/api/v1/ai/summary",
        error_category="network",
        error_message="connection reset",
        request_id="req-1",
        business_success=True,
    )

    response = await metrics_module.ai_metrics(user=SimpleNamespace(role="admin"), metrics=metrics)

    assert response.data["total"]["requests"] == 1
    assert response.data["usage_logging"]["failures_total"] == 1
    assert response.data["usage_logging"]["degraded_success_total"] == 1


@pytest.mark.asyncio
async def test_require_admin_rejects_non_admin_user():
    with pytest.raises(HTTPException) as exc:
        await deps_module.require_admin(SimpleNamespace(role="user"))

    assert exc.value.status_code == 403
