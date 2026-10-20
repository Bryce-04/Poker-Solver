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


# --- Names, rename (PATCH) and delete (DELETE) -------------------------------


def _insert_ownerless_spot() -> str:
    spot_id = str(uuid4())
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO spots (id, created_at, data) VALUES (:id, now(), CAST(:data AS jsonb))"),
            {"id": spot_id, "data": f'{{"id": "{spot_id}", "positions_in_hand": ["UTG"], "effective_stack_bb": 100}}'},
        )
    return spot_id


def test_save_spot_keeps_its_name_and_old_spots_have_none(auth_headers):
    named = client.post("/spots", json={**UTG_100, "name": "UTG open"}, headers=auth_headers).json()
    unnamed = client.post("/spots", json=UTG_100, headers=auth_headers).json()
    assert named["name"] == "UTG open"
    assert unnamed["name"] is None


def test_rename_own_spot_persists_the_new_name(auth_headers):
    spot = client.post("/spots", json=UTG_100, headers=auth_headers).json()
    res = client.patch(f"/spots/{spot['id']}", json={"name": "  My UTG open  "}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["name"] == "My UTG open"
    assert res.json()["positions_in_hand"] == ["UTG"]
    assert client.get("/spots", headers=auth_headers).json()[0]["name"] == "My UTG open"


@pytest.mark.parametrize("name", ["", "   ", "x" * 121])
def test_rename_rejects_an_empty_or_too_long_name(auth_headers, name):
    spot = client.post("/spots", json=UTG_100, headers=auth_headers).json()
    res = client.patch(f"/spots/{spot['id']}", json={"name": name}, headers=auth_headers)
    assert res.status_code == 422


def test_rename_someone_elses_spot_is_404_and_leaves_it_alone(auth_headers):
    other_headers = {"Authorization": f"Bearer {make_token(uuid4())}"}
    theirs = client.post("/spots", json=UTG_100, headers=other_headers).json()
    res = client.patch(f"/spots/{theirs['id']}", json={"name": "mine now"}, headers=auth_headers)
    assert res.status_code == 404
    assert client.get("/spots", headers=other_headers).json()[0]["name"] is None


def test_rename_an_ownerless_or_missing_spot_is_404(auth_headers):
    for spot_id in (_insert_ownerless_spot(), str(uuid4())):
        res = client.patch(f"/spots/{spot_id}", json={"name": "x"}, headers=auth_headers)
        assert res.status_code == 404


def test_delete_own_spot(auth_headers):
    spot = client.post("/spots", json=UTG_100, headers=auth_headers).json()
    res = client.delete(f"/spots/{spot['id']}", headers=auth_headers)
    assert res.status_code == 204
    assert client.get("/spots", headers=auth_headers).json() == []
    # Gone: a second delete is a 404, not a 204.
    assert client.delete(f"/spots/{spot['id']}", headers=auth_headers).status_code == 404


def test_delete_someone_elses_spot_is_404_and_keeps_it(auth_headers):
    other_headers = {"Authorization": f"Bearer {make_token(uuid4())}"}
    theirs = client.post("/spots", json=UTG_100, headers=other_headers).json()
    assert client.delete(f"/spots/{theirs['id']}", headers=auth_headers).status_code == 404
    assert len(client.get("/spots", headers=other_headers).json()) == 1


def test_delete_an_ownerless_or_missing_spot_is_404(auth_headers):
    ownerless = _insert_ownerless_spot()
    for spot_id in (ownerless, str(uuid4())):
        assert client.delete(f"/spots/{spot_id}", headers=auth_headers).status_code == 404
    with engine.begin() as conn:
        assert conn.execute(text("SELECT count(*) FROM spots WHERE id = :id"), {"id": ownerless}).scalar() == 1


def test_rename_and_delete_require_sign_in():
    spot_id = str(uuid4())
    assert client.patch(f"/spots/{spot_id}", json={"name": "x"}).status_code == 401
    assert client.delete(f"/spots/{spot_id}").status_code == 401
