"""The Coach's conversation endpoints (app/ask_coach), against local Postgres.

The background worker is replaced by an inline call, so a turn has finished by
the time POST .../messages returns. Phase 1's turn stores a fixed reply.
"""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.ask_coach import runner, store
from app.db import engine
from app.main import app
from conftest import make_token

client = TestClient(app)
# Before inline_runner replaces it, for the one test that uses the real pool.
_real_submit = runner.submit


@pytest.fixture(autouse=True)
def clean_tables():
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE coach_conversations CASCADE"))
    yield


@pytest.fixture(autouse=True)
def inline_runner(monkeypatch):
    monkeypatch.setattr(runner, "submit", runner.run_turn)


@pytest.fixture(autouse=True)
def default_limit(monkeypatch):
    monkeypatch.delenv("COACH_DAILY_LIMIT", raising=False)


def other_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(uuid4())}"}


def new_conversation(headers) -> str:
    res = client.post("/coach/conversations", headers=headers)
    assert res.status_code == 201
    return res.json()["id"]


def send(conversation_id, headers, text="I have AQ on the button. What do I do?", **extra):
    return client.post(
        f"/coach/conversations/{conversation_id}/messages",
        json={"text": text, **extra},
        headers=headers,
    )


def set_status(conversation_id, status, *, minutes_ago=0):
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE coach_conversations SET status = :s, "
                "updated_at = now() - make_interval(mins => :m) WHERE id = :id"
            ),
            {"s": status, "m": minutes_ago, "id": conversation_id},
        )


# --- every route needs sign-in -------------------------------------------------

@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/coach/conversations"),
        ("get", "/coach/conversations"),
        ("get", f"/coach/conversations/{uuid4()}"),
        ("post", f"/coach/conversations/{uuid4()}/messages"),
        ("patch", f"/coach/conversations/{uuid4()}"),
        ("delete", f"/coach/conversations/{uuid4()}"),
        ("get", "/coach/usage"),
    ],
)
def test_every_route_requires_sign_in(method, path):
    assert getattr(client, method)(path).status_code == 401


# --- create, send, read ---------------------------------------------------------

def test_a_new_conversation_is_empty_and_idle(auth_headers):
    cid = new_conversation(auth_headers)
    res = client.get(f"/coach/conversations/{cid}", headers=auth_headers)
    assert res.status_code == 200
    assert res.json() == {"id": cid, "title": None, "status": "idle", "messages": []}


def test_sending_stores_the_text_and_the_turn_stores_a_reply(auth_headers):
    cid = new_conversation(auth_headers)
    res = send(cid, auth_headers)
    assert res.status_code == 202
    assert res.json() == {"last_seq": 1}

    body = client.get(f"/coach/conversations/{cid}", headers=auth_headers).json()
    assert body["status"] == "idle"
    assert [(m["seq"], m["kind"]) for m in body["messages"]] == [(1, "user_text"), (2, "coach_text")]
    assert body["messages"][0]["payload"] == {"text": "I have AQ on the button. What do I do?"}
    assert body["messages"][1]["payload"] == {"paras": runner.PLACEHOLDER_REPLY}


def test_after_returns_only_newer_messages(auth_headers):
    cid = new_conversation(auth_headers)
    send(cid, auth_headers, "first")
    send(cid, auth_headers, "second")
    body = client.get(f"/coach/conversations/{cid}?after=2", headers=auth_headers).json()
    assert [m["seq"] for m in body["messages"]] == [3, 4]
    assert body["messages"][0]["payload"]["text"] == "second"
    assert client.get(f"/coach/conversations/{cid}?after=4", headers=auth_headers).json()["messages"] == []


def test_the_title_is_the_start_of_the_first_message(auth_headers):
    cid = new_conversation(auth_headers)
    send(cid, auth_headers, "  Button   vs big blind, AQ offsuit, flop Q 5 2 two clubs, he checks  ")
    send(cid, auth_headers, "a later message doesn't change it")
    title = client.get(f"/coach/conversations/{cid}", headers=auth_headers).json()["title"]
    assert title == "Button vs big blind, AQ offsuit, flop Q"


def test_an_attached_spot_is_validated_and_kept(auth_headers):
    cid = new_conversation(auth_headers)
    spot = {"positions_in_hand": ["BTN", "BB"], "effective_stack_bb": 100, "board": ["Qs", "5c", "2c"]}
    assert send(cid, auth_headers, "pasted hand", attached_spot=spot).status_code == 202
    payload = client.get(f"/coach/conversations/{cid}", headers=auth_headers).json()["messages"][0]["payload"]
    assert payload["attached_spot"]["positions_in_hand"] == ["BTN", "BB"]

    bad = send(cid, auth_headers, "pasted hand", attached_spot={"positions_in_hand": ["BTN"]})
    assert bad.status_code == 422


@pytest.mark.parametrize("text_", ["", "   ", "x" * 4001])
def test_empty_or_huge_text_is_refused(auth_headers, text_):
    cid = new_conversation(auth_headers)
    assert send(cid, auth_headers, text_).status_code == 422


# --- one turn at a time ---------------------------------------------------------

@pytest.mark.parametrize("status", ["working", "waiting_for_solver"])
def test_a_message_while_a_turn_runs_is_409(auth_headers, status):
    cid = new_conversation(auth_headers)
    set_status(cid, status)
    assert send(cid, auth_headers).status_code == 409
    assert client.get(f"/coach/conversations/{cid}", headers=auth_headers).json()["messages"] == []


def test_a_message_after_an_error_is_accepted(auth_headers):
    cid = new_conversation(auth_headers)
    set_status(cid, "error")
    assert send(cid, auth_headers).status_code == 202


def test_a_turn_that_fails_stores_an_error_and_status_error(auth_headers, monkeypatch):
    def broken(db, conversation):
        raise RuntimeError("boom")

    monkeypatch.setattr(runner, "_reply", broken)
    cid = new_conversation(auth_headers)
    assert send(cid, auth_headers).status_code == 202
    body = client.get(f"/coach/conversations/{cid}", headers=auth_headers).json()
    assert body["status"] == "error"
    assert body["messages"][-1]["kind"] == "error"
    assert body["messages"][-1]["payload"] == {"kind": "internal", "text": runner.INTERNAL_ERROR_TEXT}


def test_the_real_background_worker_runs_the_turn(auth_headers, monkeypatch):
    futures = []
    monkeypatch.setattr(runner, "submit", lambda cid: futures.append(_real_submit(cid)))
    cid = new_conversation(auth_headers)
    assert send(cid, auth_headers).status_code == 202
    futures[0].result(timeout=10)
    body = client.get(f"/coach/conversations/{cid}", headers=auth_headers).json()
    assert body["status"] == "idle"
    assert [m["kind"] for m in body["messages"]] == ["user_text", "coach_text"]


def test_a_turn_for_a_deleted_conversation_does_nothing():
    runner.run_turn(uuid4())  # no exception, nothing stored


# --- a turn lost to a restart ---------------------------------------------------

def test_a_stuck_turn_is_reset_to_error_when_fetched(auth_headers):
    cid = new_conversation(auth_headers)
    set_status(cid, "working", minutes_ago=6)
    body = client.get(f"/coach/conversations/{cid}", headers=auth_headers).json()
    assert body["status"] == "error"
    assert body["messages"][-1]["payload"] == {"kind": "internal", "text": store.STALE_TEXT}
    # ...and only once.
    again = client.get(f"/coach/conversations/{cid}", headers=auth_headers).json()
    assert len(again["messages"]) == 1


def test_a_stuck_turn_is_reset_in_the_list_and_on_send(auth_headers):
    listed, sent = new_conversation(auth_headers), new_conversation(auth_headers)
    set_status(listed, "waiting_for_solver", minutes_ago=6)
    set_status(sent, "working", minutes_ago=6)

    statuses = {c["id"]: c["status"] for c in client.get("/coach/conversations", headers=auth_headers).json()}
    assert statuses[listed] == "error"
    set_status(sent, "working", minutes_ago=6)  # the list reset it too; make it stuck again
    assert send(sent, auth_headers).status_code == 202


def test_a_recent_turn_is_not_reset(auth_headers):
    cid = new_conversation(auth_headers)
    set_status(cid, "working", minutes_ago=4)
    assert client.get(f"/coach/conversations/{cid}", headers=auth_headers).json()["status"] == "working"


# --- list, rename, delete -------------------------------------------------------

def test_the_list_is_newest_first_with_a_preview(auth_headers):
    first = new_conversation(auth_headers)
    second = new_conversation(auth_headers)
    send(first, auth_headers, "older conversation, newer message")

    body = client.get("/coach/conversations", headers=auth_headers).json()
    assert [c["id"] for c in body] == [first, second]
    assert body[0]["title"] == "older conversation, newer message"
    assert body[0]["preview"] == runner.PLACEHOLDER_REPLY[0][:80]
    assert body[0]["status"] == "idle"
    assert body[1]["preview"] is None and body[1]["title"] is None


def test_the_list_is_an_empty_array_when_there_are_none(auth_headers):
    assert client.get("/coach/conversations", headers=auth_headers).json() == []


def test_rename(auth_headers):
    cid = new_conversation(auth_headers)
    res = client.patch(f"/coach/conversations/{cid}", json={"title": "  AQ on the button  "}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["title"] == "AQ on the button"
    assert client.patch(f"/coach/conversations/{cid}", json={"title": " "}, headers=auth_headers).status_code == 422


def test_delete_removes_the_conversation_and_its_messages(auth_headers):
    cid = new_conversation(auth_headers)
    send(cid, auth_headers)
    assert client.delete(f"/coach/conversations/{cid}", headers=auth_headers).status_code == 204
    assert client.get(f"/coach/conversations/{cid}", headers=auth_headers).status_code == 404
    with engine.connect() as conn:
        left = conn.execute(text("SELECT count(*) FROM coach_messages WHERE conversation_id = :id"), {"id": cid})
        assert left.scalar() == 0


# --- ownership ------------------------------------------------------------------

def test_someone_elses_conversation_is_404_everywhere(auth_headers):
    cid = new_conversation(auth_headers)
    send(cid, auth_headers)
    other = other_headers()

    assert client.get(f"/coach/conversations/{cid}", headers=other).status_code == 404
    assert send(cid, other).status_code == 404
    assert client.patch(f"/coach/conversations/{cid}", json={"title": "mine now"}, headers=other).status_code == 404
    assert client.delete(f"/coach/conversations/{cid}", headers=other).status_code == 404
    assert client.get("/coach/conversations", headers=other).json() == []

    # The owner's conversation is untouched.
    body = client.get(f"/coach/conversations/{cid}", headers=auth_headers).json()
    assert body["title"] != "mine now"
    assert len(body["messages"]) == 2


def test_a_missing_conversation_is_the_same_404(auth_headers):
    missing = uuid4()
    other = client.get(f"/coach/conversations/{missing}", headers=auth_headers)
    assert other.status_code == 404
    assert other.json() == {"detail": "No such conversation."}


# --- the daily limit ------------------------------------------------------------

def test_usage_counts_todays_messages(auth_headers):
    cid = new_conversation(auth_headers)
    send(cid, auth_headers)
    send(new_conversation(auth_headers), auth_headers)
    body = client.get("/coach/usage", headers=auth_headers).json()
    assert body["used"] == 2
    assert body["limit"] == 25
    assert body["resets_at"].endswith(("T00:00:00Z", "T00:00:00+00:00"))


def test_usage_ignores_yesterday_and_other_users(auth_headers):
    cid = new_conversation(auth_headers)
    send(cid, auth_headers)
    with engine.begin() as conn:
        conn.execute(text("UPDATE coach_messages SET created_at = created_at - interval '1 day'"))
    send(new_conversation(other_headers()), other_headers())
    assert client.get("/coach/usage", headers=auth_headers).json()["used"] == 0


def test_over_the_limit_is_429_with_used_and_limit(auth_headers, monkeypatch):
    monkeypatch.setenv("COACH_DAILY_LIMIT", "2")
    cid = new_conversation(auth_headers)
    assert send(cid, auth_headers).status_code == 202
    assert send(cid, auth_headers).status_code == 202

    res = send(cid, auth_headers)
    assert res.status_code == 429
    assert res.json() == {"used": 2, "limit": 2}
    # Nothing was stored for the refused message.
    assert len(client.get(f"/coach/conversations/{cid}", headers=auth_headers).json()["messages"]) == 4


@pytest.mark.parametrize("raw,expected", [("", 25), ("nope", 25), ("-1", 25), ("0", 0), ("7", 7)])
def test_the_limit_comes_from_the_environment(auth_headers, monkeypatch, raw, expected):
    monkeypatch.setenv("COACH_DAILY_LIMIT", raw)
    assert client.get("/coach/usage", headers=auth_headers).json()["limit"] == expected

