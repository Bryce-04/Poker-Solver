"""The coach's streamed chat (coach.chat_events, POST /coach/chat) on top of the grounded coach:
no network, no database. A fake provider stands in for the model; Gemini's streaming transport
is exercised through httpx.MockTransport."""

import json
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app import coach
from app.auth import current_user_id
from app.main import app

USER = uuid4()
CONTEXT = {
    "lesson_title": "Poker Drill",
    "prompt": "You are BB, out of position, and act first on the flop. Pot 5.5bb, stacks 97.5bb.",
    "board": ["Ks", "7h", "2d"],
    "hand": ["Ah", "Kh"],
    "picked": "Check",
    "correct": "Bet 1.8bb (33%)",
    "explanation": "The solver bets this hand 70% of the time and checks it 20%.",
}


class FakeStream:
    def __init__(self, deltas=("Bet because ", "you have top pair."), fail_first=None, fail_after=None):
        self.deltas, self.fail_first, self.fail_after, self.calls = list(deltas), fail_first, fail_after, []

    def stream(self, system, messages):
        self.calls.append((system, messages))
        if self.fail_first:
            raise self.fail_first
        yield from self.deltas
        if self.fail_after:
            raise self.fail_after


@pytest.fixture(autouse=True)
def signed_in_and_fresh_limiter(monkeypatch):
    app.dependency_overrides[current_user_id] = lambda: USER
    monkeypatch.setattr(coach, "limiter", coach.RateLimiter(per_hour=3, per_day_total=100))
    yield
    app.dependency_overrides.pop(current_user_id, None)


def use(monkeypatch, provider):
    monkeypatch.setattr(coach, "get_provider", lambda: provider)
    return provider


client = TestClient(app)


def chat(messages=None, context=CONTEXT):
    return client.post("/coach/chat", json={"context": context, "messages": messages or []})


def events(res):
    return [json.loads(line[6:]) for line in res.text.split("\n\n") if line.startswith("data: ")]


# --- the route and the conversation it builds ------------------------------------------------


def test_it_streams_the_answer_then_says_done(monkeypatch):
    use(monkeypatch, FakeStream())
    res = chat()
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
    assert events(res) == [{"delta": "Bet because "}, {"delta": "you have top pair."}, {"done": True}]


def test_the_first_message_is_the_grounded_facts_and_uses_the_lessons_system_prompt(monkeypatch):
    fake = use(monkeypatch, FakeStream())
    chat()
    system, messages = fake.calls[0]
    assert system == coach.SYSTEM_PROMPT
    assert len(messages) == 1 and messages[0]["role"] == "user"
    text = messages[0]["content"]
    assert "Learner chose: Check" in text and "Correct answer: Bet 1.8bb (33%)" in text
    assert CONTEXT["explanation"] in text and "Flop: Ks 7h 2d" in text
    assert coach.FIRST_QUESTION in text


def test_a_follow_up_keeps_the_facts_first_and_appends_the_conversation(monkeypatch):
    fake = use(monkeypatch, FakeStream())
    history = [
        {"role": "assistant", "content": "You hold top pair."},
        {"role": "user", "content": "Why not bet bigger?"},
    ]
    assert chat(history).status_code == 200
    messages = fake.calls[0][1]
    assert [m["role"] for m in messages] == ["user", "assistant", "user"]
    assert "FACTS:" in messages[0]["content"] and messages[2]["content"] == "Why not bet bigger?"


@pytest.mark.parametrize(
    "messages",
    [
        [{"role": "user", "content": "hi"}],  # must open with the coach's answer
        [{"role": "assistant", "content": "a"}],  # must end with the learner's question
        [{"role": "assistant", "content": "a"}, {"role": "user", "content": "q"}, {"role": "user", "content": "q2"}],
        [{"role": "assistant" if i % 2 == 0 else "user", "content": "x"} for i in range(13)],
        [{"role": "assistant", "content": "a"}, {"role": "user", "content": "q" * 1501}],
    ],
)
def test_a_malformed_or_oversized_conversation_is_rejected(monkeypatch, messages):
    use(monkeypatch, FakeStream())
    assert chat(messages).status_code == 422


def test_oversized_context_is_rejected(monkeypatch):
    use(monkeypatch, FakeStream())
    assert chat(context={**CONTEXT, "explanation": "x" * 1501}).status_code == 422


def test_sign_in_is_required():
    app.dependency_overrides.pop(current_user_id, None)
    assert chat().status_code == 401


# --- it never dead-ends: the app's own explanation when the model can't answer -----------------


def test_no_key_gives_the_apps_own_explanation(monkeypatch):
    use(monkeypatch, None)
    assert events(chat()) == [
        {"fallback": "not_configured"},
        {"delta": CONTEXT["explanation"]},
        {"done": True},
    ]


def test_a_model_down_before_its_first_word_falls_back_and_logs_why(monkeypatch, caplog):
    use(monkeypatch, FakeStream(fail_first=coach.CoachUnavailable("HTTP 503: high demand")))
    got = events(chat())
    assert got[0] == {"fallback": "unavailable"} and got[1] == {"delta": CONTEXT["explanation"]}
    assert "high demand" in caplog.text


def test_a_model_that_says_nothing_falls_back(monkeypatch):
    use(monkeypatch, FakeStream(deltas=()))
    assert events(chat())[0] == {"fallback": "unavailable"}


def test_the_hourly_limit_counts_messages_and_falls_back_without_calling_the_model(monkeypatch):
    fake = use(monkeypatch, FakeStream())
    for _ in range(3):
        assert events(chat())[-1] == {"done": True}
    assert len(fake.calls) == 3
    assert events(chat())[0] == {"fallback": "rate_limited"}
    assert len(fake.calls) == 3


def test_a_failure_after_words_started_ends_with_an_error_event_not_a_restart(monkeypatch):
    use(monkeypatch, FakeStream(fail_after=coach.CoachUnavailable("connection dropped")))
    got = events(chat())
    assert got[:2] == [{"delta": "Bet because "}, {"delta": "you have top pair."}]
    assert got[-1] == {"error": True} and not any("fallback" in e for e in got)


def test_a_runaway_answer_is_cut_at_the_cap(monkeypatch):
    use(monkeypatch, FakeStream(deltas=["x" * 1000] * 5))
    got = events(chat())
    assert sum(len(e.get("delta", "")) for e in got) <= 2 * 1000 and got[-1] == {"done": True}


# --- Gemini's streaming transport ---------------------------------------------------------------


def sse(*texts, extra=()):
    chunks = [{"candidates": [{"content": {"parts": [{"text": t}]}}]} for t in texts]
    return "".join(f"data: {json.dumps(c)}\r\n\r\n" for c in [*chunks, *extra]).encode()


def provider(handler, model="big,small", thinking_budget=0):
    return coach.GeminiProvider(
        "key", model, client=httpx.Client(transport=httpx.MockTransport(handler)),
        thinking_budget=thinking_budget, sleep=lambda s: None,
    )


def test_gemini_streams_text_with_the_right_request():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, content=sse("Hel", "lo", extra=[{"usageMetadata": {}}]))

    p = provider(handler)
    out = list(p.stream("SYS", [{"role": "user", "content": "U"}, {"role": "assistant", "content": "A"}]))
    assert out == ["Hel", "lo"]
    req = seen[0]
    assert req.url.path.endswith("/models/big:streamGenerateContent") and req.url.params["alt"] == "sse"
    assert req.headers["x-goog-api-key"] == "key"
    body = json.loads(req.content)
    assert body["systemInstruction"]["parts"][0]["text"] == "SYS"
    assert [c["role"] for c in body["contents"]] == ["user", "model"]  # Gemini's word for the coach
    assert body["generationConfig"]["thinkingConfig"] == {"thinkingBudget": 0}


def test_a_model_that_rejects_the_thinking_setting_is_retried_without_it():
    seen = []

    def handler(request):
        body = json.loads(request.content)
        seen.append("thinkingConfig" in body["generationConfig"])
        return httpx.Response(400, text="unknown field") if seen[-1] else httpx.Response(200, content=sse("ok"))

    assert "".join(provider(handler).stream("s", [{"role": "user", "content": "u"}])) == "ok"
    assert seen == [True, False]


def test_a_busy_first_model_falls_through_to_the_next():
    tried = []

    def handler(request):
        model = request.url.path.split("/models/")[1].split(":")[0]
        tried.append(model)
        return httpx.Response(503, text="high demand") if model == "big" else httpx.Response(200, content=sse("from small"))

    assert "".join(provider(handler).stream("s", [{"role": "user", "content": "u"}])) == "from small"
    assert tried == ["big", "small"]


def test_every_model_busy_means_a_second_round_then_unavailable_with_the_reason():
    calls = []
    p = provider(lambda r: calls.append(1) or httpx.Response(503, text="high demand"))
    with pytest.raises(coach.CoachUnavailable, match="high demand"):
        list(p.stream("s", [{"role": "user", "content": "u"}]))
    assert len(calls) == 4  # two models, two rounds


def test_a_bad_key_is_not_retried():
    calls = []
    p = provider(lambda r: calls.append(1) or httpx.Response(403, text="API key not valid"))
    with pytest.raises(coach.CoachUnavailable, match="not valid"):
        list(p.stream("s", [{"role": "user", "content": "u"}]))
    assert len(calls) == 2  # one pass over the list, no second round


def test_an_empty_stream_is_unavailable():
    with pytest.raises(coach.CoachUnavailable, match="empty"):
        list(provider(lambda r: httpx.Response(200, content=sse()), model="m").stream("s", []))


def test_a_stream_that_breaks_after_text_is_not_restarted():
    class Broken(httpx.SyncByteStream):
        def __iter__(self):
            yield sse("half")
            raise httpx.ReadError("dropped")

    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(200, stream=Broken())

    got = []
    with pytest.raises(coach.CoachUnavailable):
        for t in provider(handler).stream("s", []):
            got.append(t)
    assert got == ["half"] and len(calls) == 1


def test_the_lessons_one_shot_uses_the_first_model_of_a_list():
    seen = []

    def handler(request):
        seen.append(request.url.path)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "hi"}]}}]})

    assert provider(handler).generate("s", "u") == "hi"
    assert seen[0].endswith("/models/big:generateContent")


def test_thinking_is_off_by_default_and_the_environment_can_change_it(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.delenv("GEMINI_THINKING_BUDGET", raising=False)
    assert coach.get_provider()._thinking_budget == 0
    monkeypatch.setenv("GEMINI_THINKING_BUDGET", "default")
    assert coach.get_provider()._thinking_budget is None
    monkeypatch.setenv("GEMINI_THINKING_BUDGET", "256")
    assert coach.get_provider()._thinking_budget == 256
    monkeypatch.setenv("GEMINI_THINKING_BUDGET", "garbage")
    assert coach.get_provider()._thinking_budget == 0
