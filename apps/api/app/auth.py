"""Supabase Auth verification: a FastAPI dependency that turns an
`Authorization: Bearer <Supabase access token>` header into the signed-in
user's id, or a 401.

The Supabase project signs access tokens with an asymmetric key (ES256) and
publishes the public half at a JWKS endpoint, so nothing secret lives here --
only SUPABASE_URL is needed. PyJWKClient fetches and caches that key set.

This is the backend half of the contract apps/web's lib/api.ts was built
against ahead of time -- see docs/decisions.md's 2026-09-30 entry.
"""

import os
from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# auto_error=False so a missing header gets the same 401 (and
# WWW-Authenticate header) as a bad token, instead of FastAPI's default 403.
_bearer = HTTPBearer(auto_error=False)

# Supabase gives every signed-in user's access token this audience;
# anon-key-only requests don't carry a user token at all.
_AUDIENCE = "authenticated"


def _supabase_url() -> str:
    url = os.environ.get("SUPABASE_URL")
    if not url:
        raise RuntimeError("SUPABASE_URL is not set -- apps/api can't verify sign-ins without it.")
    return url.rstrip("/")


@lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{_supabase_url()}/auth/v1/.well-known/jwks.json")


def signing_key_for(token: str):
    """Public key the token claims to be signed with. Its own function so
    tests can swap in a locally generated key instead of hitting Supabase."""
    return _jwks_client().get_signing_key_from_jwt(token).key


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UUID:
    if credentials is None:
        raise _unauthorized("Sign in required.")

    token = credentials.credentials
    try:
        claims = jwt.decode(
            token,
            signing_key_for(token),
            algorithms=["ES256", "RS256"],
            audience=_AUDIENCE,
            issuer=f"{_supabase_url()}/auth/v1",
            options={"require": ["exp", "sub"]},
        )
        return UUID(claims["sub"])
    except jwt.PyJWKClientConnectionError:
        # Supabase's JWKS endpoint unreachable -- our problem, not a bad
        # token, so don't tell the user to sign in again.
        raise HTTPException(status_code=503, detail="Couldn't reach the sign-in service.") from None
    except (jwt.PyJWTError, ValueError):
        # Covers bad signature, expiry, wrong audience/issuer, unknown key id,
        # and a non-UUID sub. Deliberately vague -- don't tell a caller which
        # check failed.
        raise _unauthorized("Invalid or expired sign-in.") from None
