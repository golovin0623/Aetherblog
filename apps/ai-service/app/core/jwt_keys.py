"""基于数据库的 JWT key 缓存,支持密钥轮换 (VULN-152 后续工作)。

Go 后端把 JWT 签名密钥存放在 ``jwt_secrets`` 表 (migration 000033),
并按计划周期轮换 (见 ``internal/pkg/jwtkeys``)。本模块是 FastAPI 端的
对应实现: 服务启动时挂载一个后台任务,持续从 Postgres 同步活跃的
``current`` + ``previous`` 密钥到本地副本,以便 token 验签在轮换宽限窗口内
仍能匹配任意一把 key,无需强制用户重新登录。

设计约束:
  * ``decode_token`` 必须保持同步 (它在 ``jwt.decode`` 内被同步代码路径调用),
    因此缓存采用模块级 list,由一个 async 后台任务写入,读取无锁。
  * 服务首次接受流量时如果数据库不可达,回退到 ``settings.jwt_secret``
    (启动 seed,与 Go 后端的 bootstrap 环境变量一致),保证鉴权仍可用 ——
    在 refresher 首次成功之前,行为等同于轮换前的世界。
  * 缓存显式声明为 *list*,验签按顺序尝试每个 key。
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Iterable

import asyncpg

from app.core.config import get_settings

logger = logging.getLogger("ai-service")

# 刷新节奏。与 Go 后端的默认 JWT.ReloadInterval (60s) 对齐 ——
# 非 leader 实例在一个 tick 内就能拿到 leader 完成的轮换。
REFRESH_INTERVAL_SECONDS = 60.0

# _STATE 由同步代码读 (decode 路径),由一个 async 任务 (refresher) 写。
# Python 中向 dict 赋一个新 list 因为 GIL 是原子操作,
# 所以这里用最终一致性换取无锁读取。
_STATE: dict[str, Any] = {"keys": [], "loaded_at": 0.0}

_TASK: asyncio.Task | None = None


async def refresh(pool: asyncpg.Pool) -> list[str]:
    """把活跃的 (current + previous) keys 拉到模块缓存中。

    返回行按 ``current, previous`` (字母序) 排列,这样验签时主签名 key
    会先被尝试,与 Go 后端的验签方式保持一致。
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
    """返回缓存的 key 列表,缺失时回退到 ``settings.jwt_secret`` seed。

    回退行为: 若 refresher 还没填充缓存 (冷启动 / DB 故障),返回
    ``[settings.jwt_secret]``,让鉴权可以靠环境 seed 继续工作。
    这与 Go 后端的 BootstrapIfEmpty 语义一致:
    环境变量值始终至少是有效验签 key 之一。
    """
    cached: Iterable[str] = _STATE.get("keys") or ()
    cached_list = list(cached)
    if cached_list:
        return cached_list
    seed = get_settings().jwt_secret
    return [seed] if seed else []


async def start_refresher(pool: asyncpg.Pool) -> None:
    """启动后台 refresher 任务并执行一次初始拉取。

    在 ``main.py`` 的 ``lifespan`` 启动阶段被调用。任务会一直运行,
    直到被取消 (lifespan 关闭时)。
    """
    global _TASK
    if _TASK is not None and not _TASK.done():
        return

    # 初始阻塞拉取一次,这样第一个请求就已经看得到 DB 状态。
    # 这里失败会记录日志并继续 —— get_cached_keys 通过环境 seed 回退,
    # 保持鉴权可用。
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
