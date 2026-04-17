"""Re-encrypt every stored AI credential with the FIRST key in
``AI_CREDENTIAL_ENCRYPTION_KEYS``.

Use this during the VULN-056 migration window:

    # 1. Compute the legacy key derived from JWT_SECRET (so MultiFernet can
    #    decrypt existing rows during the transition).
    OLD_KEY=$(python -c "from app.services.credential_resolver import _legacy_jwt_derived_key; \
                          import os; print(_legacy_jwt_derived_key(os.environ['JWT_SECRET']).decode())")

    # 2. Generate a fresh primary key.
    NEW_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

    # 3. Configure both, new key first.
    export AI_CREDENTIAL_ENCRYPTION_KEYS="$NEW_KEY,$OLD_KEY"

    # 4. Restart ai-service so it picks up the new keys, then run this script.
    python -m scripts.rotate_credentials

    # 5. Drop the legacy key from the env after verification.
    export AI_CREDENTIAL_ENCRYPTION_KEYS="$NEW_KEY"
    # restart ai-service one more time

The script is idempotent: rows already encrypted with the first key are
re-wrapped (new ciphertext, same plaintext) without losing data.
"""

from __future__ import annotations

import asyncio
import logging

import asyncpg

from app.core.config import get_settings
from app.services.credential_resolver import CredentialResolver

logger = logging.getLogger(__name__)


async def main() -> None:
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
            for row in rows:
                try:
                    new_ct = resolver.reencrypt_api_key(row["api_key_encrypted"])
                except Exception as exc:  # noqa: BLE001
                    failed += 1
                    print(f"  ❌ id={row['id']}: {exc}")
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
            if failed:
                raise SystemExit(1)
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
