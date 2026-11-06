"""A Coach turn with tools (app/ask_coach/runner.py), against local Postgres,
with a scripted fake in place of Gemini."""

import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sql

from app import coach as train_coach
from app.ask_coach import gemini, runner, tools
from app.db import engine
from app.main import app
from ask_coach_fakes import FakeModel, call, text

client = TestClient(app)

BTN_AQ = dict(
    hero_position="BTN",
    villain_position="BB",
    hero_hand="AhQd",
    board=["Qs", "5c", "2c"],
    preflop={"line": "open_call", "aggressor": "hero"},
    postflop_actions=[{"street": "flop", "actor": "villain", "action": "check"}],
    assumptions=["standard ranges"],
)


@pytest.fixture(autouse=True)
def clean_tables():
    with engine.begin() as conn:
        conn.execute(sql("TRUNCATE coach_conversations CASCADE"))


@pytest.fixture(autouse=True)
def inline_runner(monkeypatch):
    monkeypatch.setattr(runner, "submit", runner.run_turn)


@pytest.fixture(autouse=True)
def fresh_limiter(monkeypatch):
    monkeypatch.setattr(train_coach, "limiter", train_coach.RateLimiter(per_hour=20, per_day_total=1000))


@pytest.fixture
def model(monkeypatch):
    fake = FakeModel()
    monkeypatch.setattr(gemini, "get_model", lambda: fake)
    return fake


def ask(headers, message="BTN with AhQd, BB calls, flop Qs5c2c, he checks. What now?", cid=None, **extra):
    cid = cid or client.post("/coach/conversations", headers=headers).json()["id"]
    res = client.post(f"/coach/conversations/{cid}/messages", json={"text": message, **extra}, headers=headers)
    assert res.status_code == 202, res.text
    return cid, client.get(f"/coach/conversations/{cid}", headers=headers).json()


def kinds(body):
    return [m["kind"] for m in body["messages"]]


def responses(request):
    """The functionResponse parts in a request's last content."""
    return {p["functionResponse"]["name"]: p["functionResponse"]["response"] for p in request["contents"][-1]["parts"]}


def test_a_full_turn_stores_cards_in_order(auth_headers, model):
    model.turns += [
        [text("I'm assuming 100bb stacks and a 2.5bb open."), call("describe_spot", **BTN_AQ)],
        [call("solve_current_spot")],
        [text("Once the solver is connected I'll have its play."), call("suggest_followups", items=["What if he bets?", "Turn ideas"])],
        [],
    ]
    cid, body = ask(auth_headers)

    assert body["status"] == "idle"
    assert kinds(body) == ["user_text", "coach_text", "spot_card", "coach_text", "suggestions"]
    card = body["messages"][2]["payload"]
    assert card["hero_hand"] == "AhQd" and card["hero_position"] == "BTN"
    assert card["spot"]["pot_bb"] == 5.5
    assert {"k": "Pot", "v": "5.5bb"} in card["facts"]
    assert body["messages"][4]["payload"] == {"items": ["What if he bets?", "Turn ideas"]}
    assert body["title"] == "AQ on the button, Q-5-2 flop"

    # What the model was told after each tool.
    assert responses(model.requests[1])["describe_spot"]["ok"] is True
    assert responses(model.requests[1])["describe_spot"]["to_act"] == "hero"
    assert responses(model.requests[2])["solve_current_spot"] == {"ok": False, "reason": tools.SOLVER_NOT_CONNECTED}
    # From the second request on, the system prompt carries the spot.
    assert "CURRENT SPOT: none" in model.requests[0]["system"]
    assert "pot 5.5bb" in model.requests[1]["system"]
    # Tool rounds send back the model's own parts unchanged (thought signatures included).
    assert model.requests[1]["contents"][-2] == {"role": "model", "parts": model.requests[1]["contents"][-2]["parts"]}
    assert model.requests[1]["contents"][-2]["parts"][1]["functionCall"]["name"] == "describe_spot"


def test_invented_suits_become_the_hand_type(auth_headers, model):
    model.turns += [[call("describe_spot", **{**BTN_AQ, "hero_hand": "As2s"})], []]
    _, body = ask(auth_headers, "BTN with A2s, BB calls, flop Qs5c2c, he checks.")
    card = next(m for m in body["messages"] if m["kind"] == "spot_card")["payload"]
    assert card["hero_hand"] == "A2s"
    result = responses(model.requests[1])["describe_spot"]
    assert "didn't write those suits" in result["note"]


def test_suits_the_user_wrote_are_kept(auth_headers, model):
    model.turns += [[call("describe_spot", **BTN_AQ)], []]
    _, body = ask(auth_headers, "BTN with A♥ Q♦, BB calls, flop Qs5c2c, he checks.")
    card = next(m for m in body["messages"] if m["kind"] == "spot_card")["payload"]
    assert card["hero_hand"] == "AhQd"
    assert "note" not in responses(model.requests[1])["describe_spot"]


def test_problems_go_back_to_the_model_and_no_card_is_stored(auth_headers, model):
    model.turns += [[call("describe_spot", **{**BTN_AQ, "villain_position": "BTN"})], [text("Which seat was your opponent in?")]]
    _, body = ask(auth_headers)
    assert kinds(body) == ["user_text", "coach_text"]
    result = responses(model.requests[1])["describe_spot"]
    assert result["ok"] is False and result["problems"]


def test_general_advice_is_its_own_card(auth_headers, model):
    model.turns += [
        [text("I can't solve three-way pots."), call("give_general_advice", paras=["One.", "Two.", "Three.", "Four."])],
        [],
    ]
    _, body = ask(auth_headers, "Three-way pot with KK on A73")
    assert kinds(body) == ["user_text", "coach_text", "general_advice"]
    assert body["messages"][2]["payload"] == {"paras": ["One.", "Two.", "Three."]}


def test_advice_the_model_repeats_as_its_own_text_is_dropped(auth_headers, model):
    advice = "Top pair with the best kicker usually wants to bet for value on this board."
    model.turns += [
        [call("give_general_advice", paras=[advice])],
        [text("The solver isn't available for this spot."), text(advice)],
    ]
    _, body = ask(auth_headers)
    coach_texts = [p for m in body["messages"] if m["kind"] == "coach_text" for p in m["payload"]["paras"]]
    assert coach_texts == ["The solver isn't available for this spot."]
    assert [m["kind"] for m in body["messages"]] == ["user_text", "general_advice", "coach_text"]


def test_advice_echoed_in_the_same_reply_as_the_call_is_dropped(auth_headers, model):
    advice = "Most players prefer a small continuation bet here with top pair."
    model.turns += [[text("I can't solve this."), text(advice), call("give_general_advice", paras=[advice])], []]
    _, body = ask(auth_headers)
    assert body["messages"][1]["payload"] == {"paras": ["I can't solve this."]}


def test_the_model_restating_itself_at_the_end_is_dropped(auth_headers, model):
    model.turns += [
        [text("I'm assuming 100bb stacks."), call("describe_spot", **BTN_AQ)],
        [text("OK. I'm assuming 100bb stacks."), text("Something new.")],
    ]
    _, body = ask(auth_headers)
    coach_texts = [p for m in body["messages"] if m["kind"] == "coach_text" for p in m["payload"]["paras"]]
    assert coach_texts == ["I'm assuming 100bb stacks.", "Something new."]


def test_html_and_markdown_become_plain_text_and_a_copied_box_is_dropped(auth_headers, model):
    advice = "On a queen-high board you want to bet often to get value from weaker queens and draws."
    model.turns += [
        [call("give_general_advice", paras=[advice])],
        [
            text("**Bet** is the main idea."),
            text(f'<div style="border: 1px solid"><strong>Not from the solver</strong><p>{advice}</p></div>'),
        ],
    ]
    _, body = ask(auth_headers)
    coach_texts = [p for m in body["messages"] if m["kind"] == "coach_text" for p in m["payload"]["paras"]]
    assert coach_texts == ["Bet is the main idea."]


def test_advice_written_as_a_fake_box_becomes_the_real_labeled_box(auth_headers, model):
    model.turns += [
        [
            text("I can't solve three-way pots."),
            text("[General advice box: Be careful with one pair in multi-way pots.]"),
            text("(App note: showed the spot card: whatever)"),
            text("Want a heads-up version?"),
        ],
    ]
    _, body = ask(auth_headers, "Three-way pot with KK on A73")
    assert [m["kind"] for m in body["messages"]] == ["user_text", "coach_text", "general_advice"]
    assert body["messages"][1]["payload"] == {"paras": ["I can't solve three-way pots.", "Want a heads-up version?"]}
    assert body["messages"][2]["payload"] == {"paras": ["Be careful with one pair in multi-way pots."]}


def test_a_bullet_list_of_follow_ups_becomes_the_suggestions(auth_headers, model):
    model.turns += [[text("Want to go on?"), text("* What if he bets? * Turn ideas - Bet sizes")]]
    _, body = ask(auth_headers)
    assert [m["kind"] for m in body["messages"]] == ["user_text", "coach_text", "suggestions"]
    assert body["messages"][2]["payload"] == {"items": ["What if he bets?", "Turn ideas", "Bet sizes"]}


def test_a_bullet_list_of_long_points_stays_text(auth_headers, model):
    long_point = "* " + "This is a long explanation that is clearly not a tappable question at all."
    model.turns += [[text(long_point)]]
    _, body = ask(auth_headers)
    assert [m["kind"] for m in body["messages"]] == ["user_text", "coach_text"]


def test_long_suggestions_are_dropped(auth_headers, model):
    model.turns += [[call("suggest_followups", items=["Short one", "x" * 41])], []]
    _, body = ask(auth_headers)
    assert body["messages"][-1]["payload"] == {"items": ["Short one"]}


def test_tool_rounds_are_capped_then_text_only(auth_headers, model):
    model.turns += [[call("suggest_followups", items=[f"Q{i}"])] for i in range(6)]
    _, body = ask(auth_headers)
    assert len(model.requests) == runner.MAX_TOOL_ROUNDS + 1
    assert [r["allow_tools"] for r in model.requests] == [True] * runner.MAX_TOOL_ROUNDS + [False]
    assert body["status"] == "idle"


def test_an_unknown_tool_is_an_error_the_model_reads(auth_headers, model):
    model.turns += [[call("delete_everything")], [text("Sorry.")]]
    _, body = ask(auth_headers)
    assert responses(model.requests[1])["delete_everything"]["ok"] is False
    assert body["status"] == "idle"


def test_no_answer_at_all_still_says_something(auth_headers, model):
    model.turns += [[]]
    _, body = ask(auth_headers)
    assert body["messages"][-1]["payload"] == {"paras": [runner.NO_ANSWER_TEXT]}


def test_gemini_busy_is_an_error_and_gives_the_message_back(auth_headers, model):
    model.turns += [train_coach.CoachBusy("all 429")]
    _, body = ask(auth_headers)
    assert body["status"] == "error"
    assert body["messages"][-1]["payload"] == {"kind": "gemini_busy", "text": runner.BUSY_TEXT}
    assert client.get("/coach/usage", headers=auth_headers).json()["used"] == 0


def test_gemini_failing_otherwise_is_internal_and_counts(auth_headers, model):
    model.turns += [train_coach.CoachUnavailable("HTTP 401")]
    _, body = ask(auth_headers)
    assert body["messages"][-1]["payload"]["kind"] == "internal"
    assert client.get("/coach/usage", headers=auth_headers).json()["used"] == 1


def test_no_key_is_an_error_and_gives_the_message_back(auth_headers, monkeypatch):
    monkeypatch.setattr(gemini, "get_model", lambda: None)
    _, body = ask(auth_headers)
    assert body["messages"][-1]["payload"] == {"kind": "not_configured", "text": runner.NOT_CONFIGURED_TEXT}
    assert client.get("/coach/usage", headers=auth_headers).json()["used"] == 0


def test_an_attached_hand_history_wins_over_the_models_reading(auth_headers, model):
    attached = {
        "positions_in_hand": ["BB", "BTN"],
        "effective_stack_bb": 97.5,
        "pot_bb": 5.5,
        "board": ["Kd", "9s", "4h"],
        "current_street": "flop",
        "actions": [{"position": "BB", "street": "flop", "action": "check"}],
    }
    model.turns += [[call("describe_spot", **BTN_AQ)], []]
    _, body = ask(auth_headers, "Here's my hand: ...", attached_spot=attached)
    card = next(m for m in body["messages"] if m["kind"] == "spot_card")["payload"]
    assert card["spot"]["board"] == ["Kd", "9s", "4h"]
    assert "read from your hand history" in card["assumptions"]
    assert "attached a hand history" in model.requests[0]["contents"][-1]["parts"][-1]["text"]


def test_follow_ups_carry_the_history_and_the_spot(auth_headers, model):
    model.turns += [[call("describe_spot", **BTN_AQ)], [text("Bet small.")]]
    cid, _ = ask(auth_headers)
    model.requests.clear()
    _, body = ask(auth_headers, "What if he bets instead?", cid=cid)

    sent = model.requests[0]
    flat = [p["text"] for c in sent["contents"] for p in c["parts"]]
    assert flat[0].startswith("BTN with AhQd")
    assert any(t.startswith("(App note: showed the spot card:") for t in flat)
    assert "Bet small." in flat
    assert flat[-1] == "What if he bets instead?"
    assert [c["role"] for c in sent["contents"]] == ["user", "model", "user"]
    assert "pot 5.5bb" in sent["system"]


def test_only_the_first_spot_titles_the_conversation_and_a_rename_sticks(auth_headers, model):
    model.turns += [[call("describe_spot", **BTN_AQ)], []]
    cid, body = ask(auth_headers)
    assert body["title"] == "AQ on the button, Q-5-2 flop"

    model.turns += [[call("describe_spot", **{**BTN_AQ, "hero_hand": "KhKd"})], []]
    _, body = ask(auth_headers, "Now with KK", cid=cid)
    assert body["title"] == "AQ on the button, Q-5-2 flop"

    client.patch(f"/coach/conversations/{cid}", json={"title": "My AQ hand"}, headers=auth_headers)
    model.turns += [[call("describe_spot", **BTN_AQ)], []]
    _, body = ask(auth_headers, "Back to AQ", cid=cid)
    assert body["title"] == "My AQ hand"


def test_nothing_about_the_user_reaches_gemini(auth_headers, user_id, model):
    model.turns += [[call("describe_spot", **BTN_AQ)], []]
    ask(auth_headers)
    sent = json.dumps(model.requests)
    assert str(user_id) not in sent
    assert auth_headers["Authorization"].split()[1] not in sent


def test_a_turn_for_a_deleted_conversation_never_calls_gemini(model):
    runner.run_turn(uuid4())
    assert model.requests == []
