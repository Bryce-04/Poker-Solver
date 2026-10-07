from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import engine
from app.main import app
from conftest import make_token

client = TestClient(app)

UTG_100 = {"positions_in_hand": ["UTG"], "effective_stack_bb": 100}


@pytest.fixture(autouse=True)
def clean_spots_table():
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE spots"))
    yield


def test_save_spot_echoes_it_back_with_server_assigned_id_created_at_and_owner(
    auth_headers, user_id
):
    res = client.post("/spots", json=UTG_100, headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["id"]
    assert body["created_at"]
    assert body["created_by"] == str(user_id)
    assert body["positions_in_hand"] == ["UTG"]
    assert body["effective_stack_bb"] == 100


def test_save_spot_ignores_a_client_supplied_id(auth_headers):
    res = client.post(
        "/spots",
        json={**UTG_100, "id": "00000000-0000-0000-0000-000000000000"},
        headers=auth_headers,
    )
    assert res.status_code == 200
    assert res.json()["id"] != "00000000-0000-0000-0000-000000000000"


def test_save_spot_ignores_a_client_supplied_owner(auth_headers, user_id):
    # Otherwise any signed-in user could plant spots in someone else's list.
    someone_else = str(uuid4())
    res = client.post(
        "/spots", json={**UTG_100, "created_by": someone_else}, headers=auth_headers
    )
    assert res.status_code == 200
    assert res.json()["created_by"] == str(user_id)

    other_headers = {"Authorization": f"Bearer {make_token(someone_else)}"}
    assert client.get("/spots", headers=other_headers).json() == []


def test_save_spot_rejects_an_invalid_spot(auth_headers):
    # Missing the required effective_stack_bb -- should fail schema
    # validation (422), matching /spots/reference-strategy's behavior.
    res = client.post("/spots", json={"positions_in_hand": ["UTG"]}, headers=auth_headers)
    assert res.status_code == 422


def test_list_spots_returns_saved_spots_newest_first(auth_headers):
    client.post("/spots", json=UTG_100, headers=auth_headers)
    client.post(
        "/spots", json={"positions_in_hand": ["BTN"], "effective_stack_bb": 40}, headers=auth_headers
    )

    res = client.get("/spots", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 2
    assert body[0]["positions_in_hand"] == ["BTN"]
    assert body[1]["positions_in_hand"] == ["UTG"]


def test_list_spots_is_a_bare_array_when_empty(auth_headers):
    res = client.get("/spots", headers=auth_headers)
    assert res.status_code == 200
    assert res.json() == []


def test_list_spots_only_returns_the_callers_own_spots(auth_headers):
    other_headers = {"Authorization": f"Bearer {make_token(uuid4())}"}
    client.post("/spots", json=UTG_100, headers=auth_headers)
    client.post(
        "/spots", json={"positions_in_hand": ["BTN"], "effective_stack_bb": 40}, headers=other_headers
    )

    mine = client.get("/spots", headers=auth_headers).json()
    theirs = client.get("/spots", headers=other_headers).json()
    assert [s["positions_in_hand"] for s in mine] == [["UTG"]]
    assert [s["positions_in_hand"] for s in theirs] == [["BTN"]]


def test_list_spots_never_returns_ownerless_pre_auth_rows(auth_headers):
    # Rows saved before Stage 6 have created_by NULL -- kept, but invisible.
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO spots (id, created_at, data) VALUES "
                "(gen_random_uuid(), now(), CAST(:data AS jsonb))"
            ),
            {"data": '{"positions_in_hand": ["UTG"], "effective_stack_bb": 100}'},
        )
    assert client.get("/spots", headers=auth_headers).json() == []
