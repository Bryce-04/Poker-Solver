"""Train-tab lesson progress: per-user storage with "newest attempt wins" merging."""

import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import engine
from app.main import app
from conftest import make_token

client = TestClient(app)

NOW = int(time.time() * 1000)


@pytest.fixture(autouse=True)
def clean_progress_table():
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE lesson_progress"))
    yield


def attempt(correct=3, total=3, at=NOW, done=True):
    return {"done": done, "correct": correct, "total": total, "at": at}


def put(lesson, body, headers):
    return client.put(f"/progress/{lesson}", json=body, headers=headers)


def test_starts_empty_and_round_trips_a_lesson(auth_headers):
    assert client.get("/progress", headers=auth_headers).json() == {"lessons": {}}

    res = put("positions", attempt(2, 3), auth_headers)
    assert res.status_code == 200
    assert res.json() == attempt(2, 3)

    assert client.get("/progress", headers=auth_headers).json() == {"lessons": {"positions": attempt(2, 3)}}


def test_a_newer_attempt_replaces_and_an_older_one_is_ignored(auth_headers):
    put("pot-odds", attempt(1, 3, at=NOW - 2000), auth_headers)
    newer = put("pot-odds", attempt(3, 3, at=NOW - 1000), auth_headers)
    assert newer.json()["correct"] == 3

    # An offline device uploading an older attempt late can't undo the newer one,
    # and is told what is actually stored.
    stale = put("pot-odds", attempt(0, 3, at=NOW - 5000), auth_headers)
    assert stale.status_code == 200
    assert stale.json() == attempt(3, 3, at=NOW - 1000)
    assert client.get("/progress", headers=auth_headers).json()["lessons"]["pot-odds"]["correct"] == 3


def test_the_same_attempt_twice_is_harmless_and_an_equal_time_overwrites(auth_headers):
    put("positions", attempt(2, 3, at=NOW - 10), auth_headers)
    put("positions", attempt(2, 3, at=NOW - 10), auth_headers)
    assert len(client.get("/progress", headers=auth_headers).json()["lessons"]) == 1
    put("positions", attempt(3, 3, at=NOW - 10), auth_headers)
    assert client.get("/progress", headers=auth_headers).json()["lessons"]["positions"]["correct"] == 3


def test_each_user_sees_only_their_own_progress(auth_headers):
    other = {"Authorization": f"Bearer {make_token(uuid4())}"}
    put("positions", attempt(3, 3), auth_headers)
    put("positions", attempt(1, 3), other)
    put("pot-odds", attempt(2, 3), other)

    mine = client.get("/progress", headers=auth_headers).json()["lessons"]
    theirs = client.get("/progress", headers=other).json()["lessons"]
    assert set(mine) == {"positions"} and mine["positions"]["correct"] == 3
    assert set(theirs) == {"positions", "pot-odds"} and theirs["positions"]["correct"] == 1


def test_sign_in_is_required():
    assert client.get("/progress").status_code == 401
    assert client.put("/progress/positions", json=attempt()).status_code == 401


@pytest.mark.parametrize("lesson", ["Positions", "-positions", "has space", "x" * 65])
def test_rejects_a_malformed_lesson_id(auth_headers, lesson):
    assert put(lesson, attempt(), auth_headers).status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        attempt(4, 3),  # more right than there were questions
        attempt(-1, 3),
        attempt(1, 201),
        attempt(at=-1),
        attempt(at=NOW + 3 * 24 * 3600 * 1000),  # a clock days ahead would pin the row
    ],
)
def test_rejects_impossible_scores_and_times(auth_headers, body):
    assert put("positions", body, auth_headers).status_code == 422


def test_caps_how_many_lessons_one_account_can_store(auth_headers):
    for i in range(100):
        assert put(f"lesson-{i}", attempt(), auth_headers).status_code == 200
    assert put("one-too-many", attempt(), auth_headers).status_code == 422
    # Updating a lesson already stored still works at the cap.
    assert put("lesson-0", attempt(1, 3, at=NOW + 1), auth_headers).status_code == 200
