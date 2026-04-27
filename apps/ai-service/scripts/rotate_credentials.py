"""使用 ``AI_CREDENTIAL_ENCRYPTION_KEYS`` 中的第一个 key 重新加密所有
已存储的 AI 凭证,并可选修复那些指向无法再解密的凭证的路由行。

请在 VULN-056 迁移窗口期使用:

    # 1. 计算从 JWT_SECRET 派生的旧 key (这样 MultiFernet 在过渡期
    #    仍能解密已有行)。
    OLD_KEY=$(python3 -c "from app.services.credential_resolver import _legacy_jwt_derived_key; \
                          import os; print(_legacy_jwt_derived_key(os.environ['JWT_SECRET']).decode())")

    # 2. 生成一把全新的主 key。
    NEW_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

    # 3. 同时配置两把,新 key 在前。
    export AI_CREDENTIAL_ENCRYPTION_KEYS="$NEW_KEY,$OLD_KEY"

    # 4. 重启 ai-service 让它读到新 key,然后运行本脚本。
    python3 -m scripts.rotate_credentials

    # 5. 验证完成后从环境变量里删除旧 key。
    export AI_CREDENTIAL_ENCRYPTION_KEYS="$NEW_KEY"
    # 再重启一次 ai-service

本脚本幂等: 已经用第一把 key 加密的行会被重新包装
(新密文、相同明文),不会丢数据。

孤儿路由修复 (``--repair-orphans``):
    如果某条凭证行无法解密 (因为最初加密它的 key 已不在
    ``AI_CREDENTIAL_ENCRYPTION_KEYS`` 中),``ai_task_routing.credential_id``
    可能仍在指向它 —— 此时路由探针会记录 ``"credential probe failed for ...: "``
    (InvalidToken 消息为空),管理端 UI 报"no credential available",
    reindex 会悄悄回退到环境默认值。

    传入 ``--repair-orphans`` 可让脚本将这类路由重新挂到同 provider 下
    可用的默认/启用凭证 (若无可替代则置 ``credential_id = NULL`` ——
    外键是 ``ON DELETE SET NULL``,resolver 会回退到 provider 默认值)。
    传入 ``--delete-dead`` 可进一步清除永远无法解密的凭证行。
    两个 flag 都是显式开启且具破坏性的;请先不带它们跑一遍预览影响。
"""

from __future__ import annotations

import argparse
import asyncio

import asyncpg

from app.core.config import get_settings
from app.services.credential_resolver import CredentialResolver


async def _repair_orphan_routings(
    conn: asyncpg.Connection, dead_ids: list[int]
) -> tuple[int, int]:
    """把指向已失效凭证的 ai_task_routing 行重新挂到同 provider 下
    可用的替代凭证。返回 ``(repaired, set_null)``。"""
    if not dead_ids:
        return 0, 0
    orphan_rows = await conn.fetch(
        """
        SELECT r.id AS routing_id, r.credential_id AS dead_cid,
               m.provider_id AS provider_id, p.code AS provider_code
        FROM ai_task_routing r
        LEFT JOIN ai_models m ON m.id = r.primary_model_id
        LEFT JOIN ai_providers p ON p.id = m.provider_id
        WHERE r.credential_id = ANY($1::int[])
        """,
        dead_ids,
    )
    repaired = 0
    cleared = 0
    for orow in orphan_rows:
        replacement = None
        if orow["provider_id"] is not None:
            replacement = await conn.fetchval(
                """
                SELECT id FROM ai_credentials
                WHERE provider_id = $1
                  AND is_enabled = TRUE
                  AND id <> ALL($2::int[])
                ORDER BY is_default DESC, id ASC
                LIMIT 1
                """,
                orow["provider_id"],
                dead_ids,
            )
        if replacement is not None:
            await conn.execute(
                "UPDATE ai_task_routing SET credential_id = $1 WHERE id = $2",
                replacement,
                orow["routing_id"],
            )
            print(
                f"  🔧 routing id={orow['routing_id']}: "
                f"credential_id {orow['dead_cid']} → {replacement} "
                f"(provider={orow['provider_code']})"
            )
            repaired += 1
        else:
            await conn.execute(
                "UPDATE ai_task_routing SET credential_id = NULL WHERE id = $1",
                orow["routing_id"],
            )
            print(
                f"  ⚠️  routing id={orow['routing_id']}: no live credential for "
                f"provider={orow['provider_code']}, set credential_id = NULL"
            )
            cleared += 1
    return repaired, cleared


async def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument(
        "--repair-orphans",
        action="store_true",
        help="Reattach ai_task_routing rows pointing at undecryptable credentials",
    )
    parser.add_argument(
        "--delete-dead",
        action="store_true",
        help="Delete credential rows that cannot be decrypted with any configured key "
        "(requires --repair-orphans to avoid FK violations)",
    )
    args = parser.parse_args(argv)

    if args.delete_dead and not args.repair_orphans:
        parser.error("--delete-dead requires --repair-orphans (routings must be reattached first)")

    settings = get_settings()
    pool = await asyncpg.create_pool(settings.postgres_dsn, min_size=1, max_size=2)
    try:
        resolver = CredentialResolver(pool)
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, api_key_encrypted FROM ai_credentials"
            )
            print(f"[rotate_credentials] found {len(rows)} credential(s)")
            updated = 0
            failed = 0
            failed_ids: list[int] = []
            for row in rows:
                try:
                    new_ct = resolver.reencrypt_api_key(row["api_key_encrypted"])
                except Exception as exc:  # noqa: BLE001
                    failed += 1
                    failed_ids.append(row["id"])
                    msg = str(exc) or type(exc).__name__
                    print(f"  ❌ id={row['id']}: {msg}")
                    continue
                await conn.execute(
                    "UPDATE ai_credentials SET api_key_encrypted = $1 WHERE id = $2",
                    new_ct,
                    row["id"],
                )
                updated += 1
                print(f"  ✅ id={row['id']} re-encrypted")
            print(
                f"[rotate_credentials] done — updated={updated} failed={failed}"
            )

            if failed and args.repair_orphans:
                print(f"[rotate_credentials] scanning routings referencing dead credentials {failed_ids}...")
                async with conn.transaction():
                    repaired, cleared = await _repair_orphan_routings(conn, failed_ids)
                print(
                    f"[rotate_credentials] routing repair — repaired={repaired} cleared_to_null={cleared}"
                )
                if args.delete_dead:
                    async with conn.transaction():
                        deleted = await conn.execute(
                            "DELETE FROM ai_credentials WHERE id = ANY($1::int[])",
                            failed_ids,
                        )
                    print(f"[rotate_credentials] purged dead credentials: {deleted}")
            elif failed:
                print(
                    "[rotate_credentials] ⚠️  dead credentials still referenced by "
                    "ai_task_routing — routing probes will log 'InvalidToken' and the "
                    "admin UI will show 'no credential available'. Re-run with "
                    "--repair-orphans to auto-fix."
                )
                raise SystemExit(1)
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
