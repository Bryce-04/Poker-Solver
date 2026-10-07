from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import engine
from app.main import app
from conftest import make_token

client = TestClient(app)

SPOT = {
    "positions_in_hand": ["BB", "BTN"],
    "effective_stack_bb": 99,
    "pot_bb": 2.5,
    "board": ["Ks", "Qh", "9d"],
    "current_street": "flop",
}
RESULT = {
    "source": "live_solve",
    "iterations": 100,
    "position": "BB",
    "strategy": {"AA": {"check": 0.4, "bet_small": 0.6}},
    "bucketed_actions": [],
}


@pytest.fixture(autouse=True)
def clean_table():
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE saved_solves"))
    yield


def save(headers, **extra):
    return client.post("/solves", json={"spot": SPOT, "result": RESULT, **extra}, headers=headers)


def test_every_route_requires_sign_in():
    assert client.post("/solves", json={"spot": SPOT, "result": RESULT}).status_code == 401
    assert client.get("/solves").status_code == 401
    assert client.delete(f"/solves/{uuid4()}").status_code == 401


def test_save_returns_the_record_with_a_server_assigned_id(auth_headers):
    res = save(auth_headers, label="BB defends")
    assert res.status_code == 200
    body = res.json()
    assert body["id"] and body["created_at"]
    assert body["label"] == "BB defends"
    assert body["spot"]["board"] == ["Ks", "Qh", "9d"]
    assert body["result"]["strategy"] == RESULT["strategy"]


def test_save_rejects_an_invalid_spot_or_a_result_without_a_strategy(auth_headers):
    bad_spot = client.post(
        "/solves", json={"spot": {"positions_in_hand": ["BB"]}, "result": RESULT}, headers=auth_headers
    )
    assert bad_spot.status_code == 422
    no_strategy = client.post(
        "/solves", json={"spot": SPOT, "result": {"iterations": 1}}, headers=auth_headers
    )
    assert no_strategy.status_code == 422


def test_list_returns_only_my_solves_newest_first(auth_headers):
    save(auth_headers, label="first")
    save(auth_headers, label="second")
    other = {"Authorization": f"Bearer {make_token(uuid4())}"}
    save(other, label="not mine")

    body = client.get("/solves", headers=auth_headers).json()
    assert [s["label"] for s in body] == ["second", "first"]


def test_delete_removes_my_solve_but_not_someone_elses(auth_headers):
    mine = save(auth_headers).json()["id"]
    other = {"Authorization": f"Bearer {make_token(uuid4())}"}
    theirs = save(other).json()["id"]

    assert client.delete(f"/solves/{theirs}", headers=auth_headers).status_code == 404
    assert client.delete(f"/solves/{mine}", headers=auth_headers).status_code == 204
    assert client.get("/solves", headers=auth_headers).json() == []
    assert len(client.get("/solves", headers=other).json()) == 1
    assert client.delete(f"/solves/{mine}", headers=auth_headers).status_code == 404
