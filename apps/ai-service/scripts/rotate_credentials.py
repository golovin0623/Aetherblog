"""Re-encrypt every stored AI credential with the FIRST key in
``AI_CREDENTIAL_ENCRYPTION_KEYS``, and optionally repair any routing rows
that end up pointing at credentials that no longer decrypt.

Use this during the VULN-056 migration window:

    # 1. Compute the legacy key derived from JWT_SECRET (so MultiFernet can
    #    decrypt existing rows during the transition).
    OLD_KEY=$(python3 -c "from app.services.credential_resolver import _legacy_jwt_derived_key; \
                          import os; print(_legacy_jwt_derived_key(os.environ['JWT_SECRET']).decode())")

    # 2. Generate a fresh primary key.
    NEW_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

    # 3. Configure both, new key first.
    export AI_CREDENTIAL_ENCRYPTION_KEYS="$NEW_KEY,$OLD_KEY"

    # 4. Restart ai-service so it picks up the new keys, then run this script.
    python3 -m scripts.rotate_credentials

    # 5. Drop the legacy key from the env after verification.
    export AI_CREDENTIAL_ENCRYPTION_KEYS="$NEW_KEY"
    # restart ai-service one more time

The script is idempotent: rows already encrypted with the first key are
re-wrapped (new ciphertext, same plaintext) without losing data.

Orphaned routing repair (``--repair-orphans``):
    If any credential row fails to decrypt (because the key that originally
    encrypted it is no longer present in ``AI_CREDENTIAL_ENCRYPTION_KEYS``),
    ``ai_task_routing.credential_id`` may still point at it — the routing
    probe will then log ``"credential probe failed for ...: "`` (empty
    InvalidToken message), admin UI reports "no credential available", and
    reindex silently falls back to env defaults.

    Pass ``--repair-orphans`` to have the script re-attach such routings to
    the working default/enabled credential for the same provider (or set
    ``credential_id = NULL`` if no replacement exists — the FK is
    ``ON DELETE SET NULL`` and the resolver falls back to provider default).
    Pass ``--delete-dead`` to additionally purge credential rows that can
    never be decrypted. Both flags are opt-in and destructive; run without
    them first to preview the impact.
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
    """Reattach ai_task_routing rows pointing at dead credentials to a live
    replacement on the same provider. Returns ``(repaired, set_null)``."""
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
