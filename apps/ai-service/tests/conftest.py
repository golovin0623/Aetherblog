"""Pytest fixtures and global setup for AI service tests.

Establishes the minimum env-var floor that ``app.core.config.Settings``
requires at construction time. Without this, importing any ``app.*`` module
during test collection would raise ``ValidationError`` because the secrets
(JWT_SECRET, AI_INTERNAL_SERVICE_TOKEN, AI_CREDENTIAL_ENCRYPTION_KEYS,
POSTGRES_DSN) are marked ``Field(...)`` (required).

This fixture runs *before* test collection (autouse + session scope).
"""

from __future__ import annotations

import os

# Set defaults only — never override values supplied by CI / developer shell.
_DEFAULTS = {
    # Existing tests sign tokens with the literal ``"test-secret"`` (e.g.
    # tests/test_deps.py); keep that to avoid signature mismatches.
    "JWT_SECRET": "test-secret",
    "AI_INTERNAL_SERVICE_TOKEN": "pytest-internal-service-token-minimum-32-chars",
    # VULN-056: a real Fernet key (validated at startup); generated with
    # python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    "AI_CREDENTIAL_ENCRYPTION_KEYS": "j2V7X9f8TMZLMTipxOmI1oDV4MherQCh_MN2gXszJyg=",
    "POSTGRES_DSN": "postgresql://test:test@localhost:5432/test_db",
}

for _key, _value in _DEFAULTS.items():
    os.environ.setdefault(_key, _value)
