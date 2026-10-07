"""Shared test setup: the database schema (via Alembic, same as a deploy)
and locally signed Supabase-shaped access tokens.

Tokens are signed with a throwaway EC key generated per test session, and
app.auth.signing_key_for is patched to return its public half -- so the real
current_user_id dependency (signature, expiry, audience, issuer checks) runs
on every request, with no network call to Supabase.
"""

import os
import time
from pathlib import Path
from uuid import UUID, uuid4

# Before anything imports app.auth: the issuer check needs a project URL.
os.environ.setdefault("SUPABASE_URL", "https://test-project.supabase.co")

import jwt
import pytest
from alembic import command
from alembic.config import Config
from cryptography.hazmat.primitives.asymmetric import ec

from app import auth

_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())
_ISSUER = f"{os.environ['SUPABASE_URL'].rstrip('/')}/auth/v1"


@pytest.fixture(scope="session", autouse=True)
def migrated_database():
    command.upgrade(Config(str(Path(__file__).parents[1] / "alembic.ini")), "head")


@pytest.fixture(autouse=True)
def local_signing_key(monkeypatch):
    monkeypatch.setattr(auth, "signing_key_for", lambda token: _PRIVATE_KEY.public_key())


def make_token(user_id: UUID, *, key=_PRIVATE_KEY, **claim_overrides) -> str:
    now = int(time.time())
    claims = {
        "sub": str(user_id),
        "aud": "authenticated",
        "iss": _ISSUER,
        "iat": now,
        "exp": now + 3600,
        **claim_overrides,
    }
    return jwt.encode(claims, key, algorithm="ES256")


@pytest.fixture
def user_id() -> UUID:
    return uuid4()


@pytest.fixture
def auth_headers(user_id) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user_id)}"}
