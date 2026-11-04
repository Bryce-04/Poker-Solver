"""The shared Gemini client's function-calling turn (app/coach.py's
GeminiProvider.generate_turn), the limiter's refund/usage, and how stored
messages become Gemini contents. No network, no database."""

import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from app import coach
from app.ask_coach import gemini

OK_PARTS = [{"text": "Hi."}, {"functionCall": {"name": "describe_spot", "args": {}}, "thoughtSignature": "abc"}]


def provider(handler, models="m1,m2"):
    return coach.GeminiProvider(
        "test-key", models, client=httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda s: None
    )


def reply(parts):
    return httpx.Response(200, json={"candidates": [{"content": {"role": "model", "parts": parts}}]})


def test_a_turn_returns_the_parts_unchanged_and_sends_tools():
    seen = []

    def handler(req):
        seen.append(req)
        return reply(OK_PARTS)

    tools = [{"name": "describe_spot", "description": "d"}]
    parts = provider(handler).generate_turn("sys", [{"role": "user", "parts": [{"text": "q"}]}], tools)
    assert parts == OK_PARTS
    body = json.loads(seen[0].content)
    assert "m1:generateContent" in str(seen[0].url)
    assert seen[0].headers["x-goog-api-key"] == "test-key"
    assert body["tools"] == [{"functionDeclarations": tools}]
    assert body["toolConfig"] == {"functionCallingConfig": {"mode": "AUTO"}}
    assert body["systemInstruction"] == {"parts": [{"text": "sys"}]}
    assert "thinkingConfig" not in body["generationConfig"]


def test_text_only_turns_turn_tools_off():
    seen = []

    def handler(req):
        seen.append(json.loads(req.content))
        return reply([{"text": "ok"}])

    provider(handler).generate_turn("s", [], [{"name": "t"}], allow_tools=False)
    assert seen[0]["toolConfig"] == {"functionCallingConfig": {"mode": "NONE"}}


def test_a_missing_model_falls_through_to_the_next():
    def handler(req):
        return httpx.Response(404) if "m1:" in str(req.url) else reply([{"text": "from m2"}])

    assert provider(handler).generate_turn("s", []) == [{"text": "from m2"}]


def test_rate_limited_everywhere_is_busy_after_two_rounds():
    calls = []

    def handler(req):
        calls.append(str(req.url))
        return httpx.Response(429)

    with pytest.raises(coach.CoachBusy):
        provider(handler).generate_turn("s", [])
    assert len(calls) == 4  # two models, two rounds


def test_network_errors_count_as_busy():
    def handler(req):
        raise httpx.ConnectTimeout("slow")

    with pytest.raises(coach.CoachBusy):
        provider(handler).generate_turn("s", [])


def test_a_bad_key_is_unavailable_not_busy():
    with pytest.raises(coach.CoachUnavailable) as info:
        provider(lambda req: httpx.Response(403)).generate_turn("s", [])
    assert not isinstance(info.value, coach.CoachBusy)


@pytest.mark.parametrize(
    "body",
    [{"candidates": []}, {"promptFeedback": {"blockReason": "SAFETY"}}, {"candidates": [{"content": {"parts": [{"text": "x", "thought": True}]}}]}],
)
def test_nothing_usable_is_unavailable(body):
    with pytest.raises(coach.CoachUnavailable) as info:
        provider(lambda req: httpx.Response(200, json=body)).generate_turn("s", [])
    assert not isinstance(info.value, coach.CoachBusy)


# --- the shared limiter ---------------------------------------------------------------------


def test_refund_gives_back_the_latest_question():
    limiter = coach.RateLimiter(per_hour=2, per_day_total=10)
    user = uuid4()
    assert limiter.allow(user, now=100) and limiter.allow(user, now=200)
    assert not limiter.allow(user, now=300)
    limiter.refund(user)
    assert limiter.usage(user, now=300) == (1, 3700, False)
    assert limiter.allow(user, now=300)


def test_refund_with_nothing_counted_is_harmless():
    coach.RateLimiter(per_hour=2, per_day_total=10).refund(uuid4())


def test_usage_reports_the_hour_and_the_all_users_total():
    limiter = coach.RateLimiter(per_hour=5, per_day_total=2)
    a, b = uuid4(), uuid4()
    limiter.allow(a, now=0)
    limiter.allow(b, now=10)
    assert limiter.usage(a, now=20) == (1, 3600, True)
    assert limiter.usage(a, now=4000) == (0, None, True)  # out of the hour, still in the day
    assert limiter.usage(a, now=90000) == (0, None, False)


# --- stored messages to contents -------------------------------------------------------------


def msg(kind_, **payload):
    return SimpleNamespace(kind=kind_, payload=payload)


def test_contents_summarize_cards_merge_roles_and_start_with_the_user():
    messages = [
        msg("coach_text", paras=["orphan model text first"]),
        msg("user_text", text="AQ on the button"),
        msg("coach_text", paras=["I'm assuming 100bb."]),
        msg("spot_card", summary="You (BTN, AhQd) vs BB"),
        msg("error", kind="internal", text="x"),
        msg("general_advice", paras=["Be careful."]),
        msg("suggestions", items=["What if he bets?"]),
        msg("user_text", text="and then?"),
    ]
    contents = gemini.build_contents(messages)
    assert [c["role"] for c in contents] == ["user", "model", "user"]
    assert [p["text"] for p in contents[1]["parts"]] == [
        "I'm assuming 100bb.",
        "[Spot card shown: You (BTN, AhQd) vs BB]",
        "[General advice box shown: Be careful.]",
        "[Follow-ups offered: What if he bets?]",
    ]


def test_contents_keep_only_the_last_messages():
    messages = [msg("user_text", text=f"q{i}") for i in range(30)]
    texts = [p["text"] for c in gemini.build_contents(messages) for p in c["parts"]]
    assert texts == [f"q{i}" for i in range(30 - gemini.MAX_HISTORY, 30)]
