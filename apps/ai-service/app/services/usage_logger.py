from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP

from app.services.metrics import MetricsStore

logger = logging.getLogger(__name__)

try:  # optional dependency
    import tiktoken
except Exception:  # pragma: no cover
    tiktoken = None


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    if tiktoken is None:
        return max(1, len(text) // 4)
    try:
        encoding = tiktoken.get_encoding("cl100k_base")
        return len(encoding.encode(text))
    except Exception:
        return max(1, len(text) // 4)


class UsageLogger:
    def __init__(self, pool, metrics: MetricsStore | None = None) -> None:
        self.pool = pool
        self.metrics = metrics

    @staticmethod
    def _extract_task(endpoint: str) -> str:
        if not endpoint:
            return "unknown"
        parts = [segment for segment in endpoint.strip("/").split("/") if segment]
        if "ai" in parts:
            ai_index = parts.index("ai")
            if ai_index + 1 < len(parts):
                return parts[ai_index + 1]
        return parts[-1] if parts else "unknown"

    @staticmethod
    def _normalize_model(model: str | None) -> tuple[str, str]:
        if not model:
            return "", ""
        if "/" not in model:
            return "", model
        provider_code, model_id = model.split("/", 1)
        return provider_code, model_id

    @staticmethod
    def _estimate_cost(tokens_in: int, tokens_out: int, input_cost_per_1k: float | None, output_cost_per_1k: float | None) -> Decimal:
        in_cost = Decimal(str(input_cost_per_1k or 0)) * (Decimal(tokens_in) / Decimal(1000))
        out_cost = Decimal(str(output_cost_per_1k or 0)) * (Decimal(tokens_out) / Decimal(1000))
        return (in_cost + out_cost).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP)

    @staticmethod
    def _classify_error(exc: Exception) -> str:
        error_text = str(exc).lower()
        error_type = exc.__class__.__name__.lower()

        if "timeout" in error_text or "timeout" in error_type:
            return "timeout"

        network_keywords = ("connection", "network", "closed", "refused", "broken pipe", "reset by peer")
        if any(keyword in error_text for keyword in network_keywords) or "connection" in error_type:
            return "network"

        db_write_keywords = (
            "duplicate",
            "constraint",
            "violates",
            "null value",
            "not-null",
            "read-only",
            "permission denied",
            "deadlock",
            "lock timeout",
        )
        if any(keyword in error_text for keyword in db_write_keywords):
            return "db_write"

        return "unknown"

    async def record(
        self,
        *,
        user_id: str,
        endpoint: str,
        model: str,
        request_chars: int,
        response_chars: int,
        tokens_in: int,
        tokens_out: int,
        latency_ms: int,
        success: bool,
        cached: bool,
        error_code: str | None,
        request_id: str | None,
        task_type: str | None = None,
        provider_code: str | None = None,
        model_id: str | None = None,
        estimated_cost: float | None = None,
        input_cost_per_1k: float | None = None,
        output_cost_per_1k: float | None = None,
    ) -> None:
        normalized_provider, normalized_model_id = self._normalize_model(model)
        effective_provider = provider_code or normalized_provider
        effective_model_id = model_id or normalized_model_id or model
        effective_task_type = task_type or self._extract_task(endpoint)
        total_tokens = int(tokens_in or 0) + int(tokens_out or 0)

        if estimated_cost is not None:
            effective_cost = Decimal(str(estimated_cost)).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP)
        else:
            effective_cost = self._estimate_cost(tokens_in, tokens_out, input_cost_per_1k, output_cost_per_1k)

        try:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO ai_usage_logs "
                    "(user_id, endpoint, task_type, provider_code, model_id, model, request_chars, response_chars, "
                    "tokens_in, tokens_out, total_tokens, latency_ms, estimated_cost, success, cached, error_code, request_id) "
                    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
                    user_id,
                    endpoint,
                    effective_task_type,
                    effective_provider,
                    effective_model_id,
                    model,
                    request_chars,
                    response_chars,
                    tokens_in,
                    tokens_out,
                    total_tokens,
                    latency_ms,
                    effective_cost,
                    success,
                    cached,
                    error_code,
                    request_id,
                )
        except Exception as exc:  # pragma: no cover - don't fail request
            error_category = self._classify_error(exc)
            metric_result = {
                "failure_count": 0,
                "degraded_success_count": 0,
                "alert_triggered": False,
            }
            if self.metrics is not None:
                metric_result = self.metrics.record_usage_log_failure(
                    endpoint=endpoint,
                    error_category=error_category,
                    error_message=str(exc),
                    request_id=request_id,
                    business_success=bool(success),
                )

            failure_count = int(metric_result.get("failure_count", 0))
            alert_triggered = bool(metric_result.get("alert_triggered", False))

            log_extra = {
                "endpoint": endpoint,
                "request_id": request_id,
                "error_category": error_category,
                "error": str(exc),
                "degraded": bool(success),
                "failure_count": failure_count,
                "alert_triggered": alert_triggered,
            }
            should_warn = self.metrics is None or failure_count <= 3 or alert_triggered
            if should_warn:
                logger.warning("ai_usage_log_failed", extra=log_extra)
            else:
                logger.debug("ai_usage_log_failed.sampled", extra=log_extra)

            if alert_triggered:
                logger.error(
                    "ai_usage_log_failed.alert",
                    extra={
                        "endpoint": endpoint,
                        "request_id": request_id,
                        "error_category": error_category,
                        "failure_count": failure_count,
                    },
                )
