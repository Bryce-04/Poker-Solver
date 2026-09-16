import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import engine
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_spots_table():
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE spots"))
    yield


def test_save_spot_echoes_it_back_with_server_assigned_id_and_created_at():
    res = client.post(
        "/spots",
        json={"positions_in_hand": ["UTG"], "effective_stack_bb": 100},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["id"]
    assert body["created_at"]
    assert body["positions_in_hand"] == ["UTG"]
    assert body["effective_stack_bb"] == 100


def test_save_spot_ignores_a_client_supplied_id():
    res = client.post(
        "/spots",
        json={
            "id": "00000000-0000-0000-0000-000000000000",
            "positions_in_hand": ["UTG"],
            "effective_stack_bb": 100,
        },
    )
    assert res.status_code == 200
    assert res.json()["id"] != "00000000-0000-0000-0000-000000000000"


def test_save_spot_rejects_an_invalid_spot():
    # Missing the required effective_stack_bb -- should fail schema
    # validation (422), matching /spots/reference-strategy's behavior.
    res = client.post("/spots", json={"positions_in_hand": ["UTG"]})
    assert res.status_code == 422


def test_list_spots_returns_saved_spots_newest_first():
    client.post("/spots", json={"positions_in_hand": ["UTG"], "effective_stack_bb": 100})
    client.post("/spots", json={"positions_in_hand": ["BTN"], "effective_stack_bb": 40})

    res = client.get("/spots")
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 2
    assert body[0]["positions_in_hand"] == ["BTN"]
    assert body[1]["positions_in_hand"] == ["UTG"]


def test_list_spots_is_a_bare_array_when_empty():
    res = client.get("/spots")
    assert res.status_code == 200
    assert res.json() == []
