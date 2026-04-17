"""DB-backed JWT key cache for rotation support (VULN-152 follow-up).

The Go backend stores JWT signing secrets in ``jwt_secrets`` (migration 000033)
and rotates them on a schedule (see ``internal/pkg/jwtkeys``). This module is
the FastAPI side of the same story: at startup, the service attaches a
background task that keeps a local copy of the active ``current`` + ``previous``
keys refreshed from Postgres, so token verification can succeed against either
key during the rotation grace window without forcing users to re-login.

Design constraints:
  * ``decode_token`` must stay synchronous (it's called from synchronous code
    paths inside ``jwt.decode``), so the cache is a module-level list populated
    by an async background task and read lock-free.
  * If the DB is unreachable when the service first accepts traffic, we fall
    back to ``settings.jwt_secret`` (the startup seed that matches the Go
    backend's bootstrap env var) so auth still works — it just behaves like
    the pre-rotation world until the refresher succeeds.
  * The cache is explicitly a *list*, verification tries each key in order.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Iterable

import asyncpg

from app.core.config import get_settings

logger = logging.getLogger("ai-service")

# Refresh cadence. Matches the Go backend's default JWT.ReloadInterval (60s) —
# non-leader instances pick up leader rotations within one tick.
REFRESH_INTERVAL_SECONDS = 60.0

# _STATE is read from sync code (decode path) and written from one async task
# (the refresher). Python dict assignment of a new list is atomic due to the
# GIL, so we accept eventual consistency in exchange for lock-free reads.
_STATE: dict[str, Any] = {"keys": [], "loaded_at": 0.0}

_TASK: asyncio.Task | None = None


async def refresh(pool: asyncpg.Pool) -> list[str]:
    """Fetch active (current + previous) keys into the module cache.

    Rows are ordered ``current, previous`` (alphabetical) so the primary
    signing key is tried first during verification, which matches the way
    the Go backend verifies.
    """
    rows = await pool.fetch(
        """
        SELECT secret_value, status
        FROM jwt_secrets
        WHERE status IN ('current', 'previous')
        ORDER BY status
        """
    )
    keys = [r["secret_value"] for r in rows]
    _STATE["keys"] = keys
    _STATE["loaded_at"] = time.time()
    logger.info("jwt_keys.refreshed", extra={"data": {"active_keys": len(keys)}})
    return keys


def get_cached_keys() -> list[str]:
    """Return the cached key list, falling back to ``settings.jwt_secret`` seed.

    Fallback behaviour: if the refresher hasn't populated the cache yet (cold
    start / DB failure), return ``[settings.jwt_secret]`` so auth still works
    with the env seed. This matches the Go backend's BootstrapIfEmpty semantics:
    the env value is always at least one of the valid verification keys.
    """
    cached: Iterable[str] = _STATE.get("keys") or ()
    cached_list = list(cached)
    if cached_list:
        return cached_list
    seed = get_settings().jwt_secret
    return [seed] if seed else []


async def start_refresher(pool: asyncpg.Pool) -> None:
    """Launch the background refresher task and perform an initial fetch.

    Called from ``main.py``'s ``lifespan`` on startup. The task runs until
    cancelled (lifespan shutdown).
    """
    global _TASK
    if _TASK is not None and not _TASK.done():
        return

    # Initial blocking fetch so the first request already sees the DB state.
    # A failure here logs and continues — fallback to env seed via
    # get_cached_keys keeps auth available.
    try:
        await refresh(pool)
    except Exception as exc:
        logger.warning("jwt_keys.initial_refresh_failed", extra={"data": {"error": str(exc)}})

    async def _loop() -> None:
        while True:
            try:
                await asyncio.sleep(REFRESH_INTERVAL_SECONDS)
                await refresh(pool)
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.warning("jwt_keys.refresh_failed", extra={"data": {"error": str(exc)}})

    _TASK = asyncio.create_task(_loop(), name="jwt_keys_refresher")


async def stop_refresher() -> None:
    global _TASK
    if _TASK is None:
        return
    _TASK.cancel()
    try:
        await _TASK
    except (asyncio.CancelledError, Exception):
        pass
    _TASK = None
