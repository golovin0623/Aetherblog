from __future__ import annotations

import logging

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
    def __init__(self, pool) -> None:
        self.pool = pool

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
    ) -> None:
        try:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO ai_usage_logs "
                    "(user_id, endpoint, model, request_chars, response_chars, tokens_in, tokens_out, "
                    "latency_ms, success, cached, error_code, request_id) "
                    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
                    user_id,
                    endpoint,
                    model,
                    request_chars,
                    response_chars,
                    tokens_in,
                    tokens_out,
                    latency_ms,
                    success,
                    cached,
                    error_code,
                    request_id,
                )
        except Exception as exc:  # pragma: no cover - don't fail request
            logger.warning("ai_usage_log_failed", extra={"error": str(exc)})
