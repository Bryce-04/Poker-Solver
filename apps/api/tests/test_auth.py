"""current_user_id's rejection paths, exercised through a real route.
GET /spots rejects before touching the database, so none of these need rows.
"""

import time
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app import auth
from app.main import app
from conftest import make_token

client = TestClient(app)


def _get_spots(token: str | None):
    headers = {"Authorization": f"Bearer {token}"} if token is not None else {}
    return client.get("/spots", headers=headers)


def test_a_valid_token_is_accepted():
    assert _get_spots(make_token(uuid4())).status_code == 200


def test_a_missing_header_is_a_401_not_fastapis_default_403():
    res = _get_spots(None)
    assert res.status_code == 401
    assert res.headers["www-authenticate"] == "Bearer"


def test_post_spots_requires_sign_in_too():
    res = client.post("/spots", json={"positions_in_hand": ["UTG"], "effective_stack_bb": 100})
    assert res.status_code == 401


def test_reference_strategy_stays_open():
    res = client.post(
        "/spots/reference-strategy",
        json={"positions_in_hand": ["UTG"], "effective_stack_bb": 100},
    )
    assert res.status_code == 200


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(make_token(uuid4(), exp=int(time.time()) - 60), id="expired"),
        pytest.param(make_token(uuid4(), aud="anon"), id="wrong-audience"),
        pytest.param(
            make_token(uuid4(), iss="https://other-project.supabase.co/auth/v1"), id="wrong-issuer"
        ),
        pytest.param(
            make_token(uuid4(), key=ec.generate_private_key(ec.SECP256R1())), id="wrong-key"
        ),
        pytest.param(make_token("not-a-uuid"), id="non-uuid-sub"),  # type: ignore[arg-type]
        pytest.param("not.a.jwt", id="garbage"),
    ],
)
def test_a_bad_token_is_a_401(token):
    assert _get_spots(token).status_code == 401


def test_an_hs256_token_is_rejected():
    # Only the project's asymmetric keys are trusted -- never a token signed
    # with a shared secret (the classic algorithm-confusion hole).
    token = jwt.encode(
        {"sub": str(uuid4()), "aud": "authenticated", "exp": int(time.time()) + 60},
        "a-shared-secret-that-is-at-least-32-bytes-long",
        algorithm="HS256",
    )
    assert _get_spots(token).status_code == 401


def test_an_unreachable_jwks_endpoint_is_a_503_not_a_401(monkeypatch):
    def unreachable(token):
        raise jwt.PyJWKClientConnectionError("connection refused")

    monkeypatch.setattr(auth, "signing_key_for", unreachable)
    assert _get_spots(make_token(uuid4())).status_code == 503
