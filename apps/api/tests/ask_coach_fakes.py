"""A scripted stand-in for Gemini, for the Coach's tests. No real API calls in CI."""

from __future__ import annotations


def text(t: str) -> dict:
    return {"text": t}


def call(name: str, **args) -> dict:
    return {"functionCall": {"name": name, "args": args}}


class FakeModel:
    """Returns `turns` in order, one per generate_turn call: a list of parts, or
    an exception to raise. When the script runs out it answers "Fake answer.".
    Records every request so tests can check what was sent."""

    def __init__(self, *turns) -> None:
        self.turns = list(turns)
        self.requests: list[dict] = []

    def generate_turn(self, system, contents, tools=None, *, allow_tools=True):
        self.requests.append(
            {
                "system": system,
                "contents": [dict(c, parts=list(c["parts"])) for c in contents],
                "tools": tools,
                "allow_tools": allow_tools,
            }
        )
        if not self.turns:
            return [text("Fake answer.")]
        turn = self.turns.pop(0)
        if isinstance(turn, Exception):
            raise turn
        return turn
