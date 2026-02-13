from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock
from typing import Dict

from app.core.config import get_settings


class MetricsStore:
    def __init__(
        self,
        *,
        usage_log_alert_threshold: int = 10,
        usage_log_sample_limit: int = 50,
    ) -> None:
        self._lock = Lock()
        self._total = {
            "requests": 0,
            "errors": 0,
            "latency_ms_sum": 0.0,
            "tokens_in": 0,
            "tokens_out": 0,
            "cached_hits": 0,
        }
        self._endpoints: Dict[str, dict] = {}

        self._usage_log_sample_limit = max(1, int(usage_log_sample_limit))
        self._usage_logging = {
            "failures_total": 0,
            "degraded_success_total": 0,
            "alert_threshold": max(1, int(usage_log_alert_threshold)),
            "alert_events": 0,
            "error_categories": {},
            "endpoints": {},
            "samples": [],
        }

    def record(
        self,
        *,
        endpoint: str,
        duration_ms: float,
        success: bool,
        tokens_in: int,
        tokens_out: int,
        model: str | None,
        cached: bool,
    ) -> None:
        with self._lock:
            self._total["requests"] += 1
            if not success:
                self._total["errors"] += 1
            if cached:
                self._total["cached_hits"] += 1
            self._total["latency_ms_sum"] += duration_ms
            self._total["tokens_in"] += tokens_in
            self._total["tokens_out"] += tokens_out

            endpoint_stats = self._endpoints.setdefault(
                endpoint,
                {
                    "requests": 0,
                    "errors": 0,
                    "latency_ms_sum": 0.0,
                    "tokens_in": 0,
                    "tokens_out": 0,
                    "cached_hits": 0,
                    "models": {},
                },
            )
            endpoint_stats["requests"] += 1
            if not success:
                endpoint_stats["errors"] += 1
            if cached:
                endpoint_stats["cached_hits"] += 1
            endpoint_stats["latency_ms_sum"] += duration_ms
            endpoint_stats["tokens_in"] += tokens_in
            endpoint_stats["tokens_out"] += tokens_out
            if model:
                endpoint_stats["models"][model] = endpoint_stats["models"].get(model, 0) + 1

    def record_usage_log_failure(
        self,
        *,
        endpoint: str,
        error_category: str,
        error_message: str,
        request_id: str | None,
        business_success: bool,
    ) -> dict[str, int | bool]:
        with self._lock:
            usage_logging = self._usage_logging
            usage_logging["failures_total"] += 1
            failure_count = usage_logging["failures_total"]

            if business_success:
                usage_logging["degraded_success_total"] += 1
            degraded_count = usage_logging["degraded_success_total"]

            usage_logging["error_categories"][error_category] = (
                usage_logging["error_categories"].get(error_category, 0) + 1
            )
            usage_logging["endpoints"][endpoint] = usage_logging["endpoints"].get(endpoint, 0) + 1

            usage_logging["samples"].append(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "endpoint": endpoint,
                    "request_id": request_id,
                    "error_category": error_category,
                    "error": error_message,
                    "business_success": business_success,
                }
            )
            overflow = len(usage_logging["samples"]) - self._usage_log_sample_limit
            if overflow > 0:
                del usage_logging["samples"][0:overflow]

            threshold = usage_logging["alert_threshold"]
            alert_triggered = threshold > 0 and failure_count % threshold == 0
            if alert_triggered:
                usage_logging["alert_events"] += 1

        return {
            "failure_count": failure_count,
            "degraded_success_count": degraded_count,
            "alert_triggered": alert_triggered,
        }

    def snapshot(self) -> dict:
        with self._lock:
            total = deepcopy(self._total)
            endpoints = deepcopy(self._endpoints)
            usage_logging = deepcopy(self._usage_logging)

        total["latency_ms_avg"] = (
            total["latency_ms_sum"] / total["requests"] if total["requests"] else 0.0
        )
        for stats in endpoints.values():
            stats["latency_ms_avg"] = (
                stats["latency_ms_sum"] / stats["requests"] if stats["requests"] else 0.0
            )

        usage_logging["alert_active"] = (
            usage_logging["alert_threshold"] > 0
            and usage_logging["failures_total"] >= usage_logging["alert_threshold"]
        )

        return {"total": total, "endpoints": endpoints, "usage_logging": usage_logging}


_metrics: MetricsStore | None = None


def get_metrics_store() -> MetricsStore:
    global _metrics
    if _metrics is None:
        settings = get_settings()
        _metrics = MetricsStore(
            usage_log_alert_threshold=settings.usage_log_failure_alert_threshold,
            usage_log_sample_limit=settings.usage_log_failure_sample_limit,
        )
    return _metrics
