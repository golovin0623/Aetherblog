from __future__ import annotations

from copy import deepcopy
from threading import Lock
from typing import Dict


class MetricsStore:
    def __init__(self) -> None:
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

    def snapshot(self) -> dict:
        with self._lock:
            total = deepcopy(self._total)
            endpoints = deepcopy(self._endpoints)

        total["latency_ms_avg"] = (
            total["latency_ms_sum"] / total["requests"] if total["requests"] else 0.0
        )
        for stats in endpoints.values():
            stats["latency_ms_avg"] = (
                stats["latency_ms_sum"] / stats["requests"] if stats["requests"] else 0.0
            )
        return {"total": total, "endpoints": endpoints}


_metrics: MetricsStore | None = None


def get_metrics_store() -> MetricsStore:
    global _metrics
    if _metrics is None:
        _metrics = MetricsStore()
    return _metrics
