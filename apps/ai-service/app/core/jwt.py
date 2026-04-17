from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import jwt
from jwt import PyJWKClient

from app.core.config import get_settings
from app.core.jwt_keys import get_cached_keys


# ref: §4.4, §8.3.1
@dataclass(frozen=True)
class UserClaims:
    user_id: str
    role: str | None
    scopes: list[str] | None


def _decode_with_hmac(token: str, options: dict[str, Any]) -> dict[str, Any]:
    """Verify HS256 token against all active rotation keys (VULN-152 follow-up).

    Tries each cached key from ``jwt_keys.get_cached_keys()`` — typically
    ``[current, previous]`` — in order. ``current`` is tried first (hot path).
    ``previous`` verification only matters during the grace window after a
    rotation; without it users would get kicked off the moment the Go backend
    swapped keys.

    Non-signature errors (expired, wrong issuer/audience, bad alg) short-circuit
    —— no point retrying with another key since the failure is intrinsic to the
    token, not the signing material.
    """
    settings = get_settings()
    keys = get_cached_keys()
    if not keys:
        # Should not happen: get_cached_keys falls back to settings.jwt_secret.
        raise jwt.InvalidKeyError("no JWT keys available")

    last_sig_err: Exception | None = None
    for key in keys:
        try:
            return jwt.decode(
                token,
                key,
                algorithms=["HS256"],
                issuer=settings.jwt_issuer,
                audience=settings.jwt_audience,
                options=options,
            )
        except jwt.InvalidSignatureError as err:
            last_sig_err = err
            continue
    # Exhausted all keys — surface the signature error for logging/debugging.
    raise last_sig_err if last_sig_err else jwt.InvalidTokenError("no key matched")


def _decode_with_jwks(token: str, options: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    if not settings.jwt_jwks_url:
        raise ValueError("AI_JWT_JWKS_URL is required for JWKS mode")
    jwk_client = PyJWKClient(settings.jwt_jwks_url)
    signing_key = jwk_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        issuer=settings.jwt_issuer,
        audience=settings.jwt_audience,
        options=options,
    )


def decode_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    options = {"verify_aud": bool(settings.jwt_audience)}
    if settings.jwt_mode.upper() == "JWKS":
        return _decode_with_jwks(token, options)
    return _decode_with_hmac(token, options)


def extract_user(claims: dict[str, Any]) -> UserClaims:
    user_id = (
        claims.get("userId")
        or claims.get("user_id")
        or claims.get("uid")
        or claims.get("sub")
    )
    if not user_id:
        raise ValueError("Missing user id in JWT claims")
    role = claims.get("role")
    scopes = claims.get("scopes") or claims.get("scope")
    if isinstance(scopes, str):
        scopes = scopes.split()
    if scopes is not None and not isinstance(scopes, list):
        scopes = [str(scopes)]
    return UserClaims(user_id=str(user_id), role=role, scopes=scopes)
