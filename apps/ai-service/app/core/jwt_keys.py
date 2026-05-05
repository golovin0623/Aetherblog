"""基于数据库的 JWT key 缓存,支持密钥轮换 (VULN-152 后续工作)。

Go 后端把 JWT 签名密钥存放在 ``jwt_secrets`` 表 (migration 000033),
并按计划周期轮换 (见 ``internal/pkg/jwtkeys``)。本模块是 FastAPI 端的
对应实现: 服务启动时挂载一个后台任务,持续从 Postgres 同步活跃的
``current`` + ``previous`` 密钥到本地副本,以便 token 验签在轮换宽限窗口内
仍能匹配任意一把 key,无需强制用户重新登录。

设计约束:
  * ``decode_token`` 必须保持同步 (它在 ``jwt.decode`` 内被同步代码路径调用),
    因此缓存采用模块级 list,由一个 async 后台任务写入,读取无锁。
  * 服务首次接受流量时如果数据库不可达,缓存保持为空并由调用方 fail-closed;
    同时由启动阶段的重试逻辑持续拉起 refresher,直到 DB 恢复。
  * 缓存显式声明为 *list*,验签按顺序尝试每个 key。
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Iterable

import asyncpg

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
    """返回缓存中的活跃 key 列表。

    当缓存为空时返回空列表,调用方应拒绝验签请求并等待 refresher
    从数据库加载 current/previous key,避免回退到可能已退役的 seed。
    """
    cached: Iterable[str] = _STATE.get("keys") or ()
    cached_list = list(cached)
    return cached_list


async def start_refresher(pool: asyncpg.Pool) -> None:
    """启动后台 refresher 任务并执行一次初始拉取。

    在 ``main.py`` 的 ``lifespan`` 启动阶段被调用。任务会一直运行,
    直到被取消 (lifespan 关闭时)。

    若初始 ``refresh(pool)`` 失败 (例如 DB 可达但 ``jwt_secrets`` 表
    尚未迁移完成), 本函数会**抛出**异常且**不**创建后台 task ——
    这样调用方的重试逻辑能立即再次尝试, 不会被误判为 "成功" 而陷入
    长达一个 ``REFRESH_INTERVAL_SECONDS`` 的 fail-closed 冷窗口。
    """
    global _TASK
    if _TASK is not None and not _TASK.done():
        return

    # 初始阻塞拉取一次,这样第一个请求就已经看得到 DB 状态。
    # 失败时直接抛出: 不创建后台 task, 让调用方决定是否重试 —— 此时缓存
    # 为空, decode 路径会 fail-closed, 与本模块的安全语义一致。
    await refresh(pool)

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
