from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import jwt
from jwt import PyJWKClient

from app.core.config import get_settings


# ref: §4.4, §8.3.1
@dataclass(frozen=True)
class UserClaims:
    user_id: str
    role: str | None
    scopes: list[str] | None


def _decode_with_hmac(token: str, options: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=["HS256"],
        issuer=settings.jwt_issuer,
        audience=settings.jwt_audience,
        options=options,
    )


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
