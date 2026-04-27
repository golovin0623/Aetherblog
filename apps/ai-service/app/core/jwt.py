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
    """用所有处于活跃轮换中的 key 验证 HS256 token (VULN-152 后续工作)。

    依次尝试 ``jwt_keys.get_cached_keys()`` 缓存中的每个 key —— 通常是
    ``[current, previous]``。``current`` 先试 (热路径)。
    ``previous`` 验签仅在轮换之后的宽限窗口内有意义;若没有它,Go 后端一换 key
    用户就会被立即踢下线。

    非签名类错误 (过期、issuer/audience 不匹配、alg 错误) 会短路退出 ——
    再换 key 重试也没用,因为这类失败是 token 本身固有的,而不是签名素材的问题。
    """
    settings = get_settings()
    keys = get_cached_keys()
    if not keys:
        # 不应发生: get_cached_keys 会回退到 settings.jwt_secret。
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
    # 所有 key 都试完 —— 把签名错误抛出,便于记录日志/调试。
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
