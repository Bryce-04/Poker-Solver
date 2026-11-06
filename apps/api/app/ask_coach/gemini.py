"""The Coach's only route to Gemini: the Train coach's client (app/coach.py's
GeminiProvider), so one key, one model list and one set of retries serve the
whole app. The spec's separate google-genai client was dropped for that; see
docs/decisions.md.

This file also turns stored messages into Gemini's `contents`: the last
MAX_HISTORY messages, with cards summarized as short text. Only the
conversation's text and tool results go to Gemini, never the user's email, id
or token (§6).
"""

from __future__ import annotations

from typing import Protocol

from .. import coach as train_coach
from ..db import CoachMessageRow

MAX_HISTORY = 12


class CoachModel(Protocol):
    def generate_turn(
        self, system: str, contents: list[dict], tools: list[dict] | None = None, *, allow_tools: bool = True
    ) -> list[dict]: ...


def get_model() -> CoachModel | None:
    """The configured client, or None when GEMINI_API_KEY isn't set. Read from
    app.coach on every call, so tests can swap it there or here."""
    return train_coach.get_provider()


def _as_text(m: CoachMessageRow) -> tuple[str, str] | None:
    """(role, text) for one stored message, or None to leave it out."""
    p = m.payload or {}
    if m.kind == "user_text":
        text = p.get("text", "")
        if p.get("attached_spot"):
            text += "\n(App note: the user attached a hand history; the app parsed it into the spot.)"
        return "user", text
    if m.kind == "coach_text":
        return "model", "\n\n".join(p.get("paras", []))
    # Cards are described as app notes, not in a form the model could copy into
    # its own text (it once wrote "[General advice box: ...]" as plain text). The
    # advice's content is left out for the same reason. runner.py drops any
    # reply paragraph that imitates a note anyway.
    if m.kind == "spot_card":
        return "model", f"(App note: showed the spot card: {p.get('summary', '')})"
    if m.kind == "general_advice":
        return "model", "(App note: showed a general advice box, labeled not from the solver.)"
    if m.kind == "suggestions":
        return "model", "(App note: offered follow-ups: " + " | ".join(p.get("items", [])) + ")"
    if m.kind in ("result_card", "preflop_card"):
        rows = ", ".join(f"{r.get('label') or r.get('action')} {round(100 * r.get('freq', 0))}%" for r in p.get("rows", []))
        return "model", f"(App note: showed the solver's result for {p.get('hero_hand') or 'the hand'}: {rows})"
    return None  # solving, error: nothing the model needs


def build_contents(messages: list[CoachMessageRow]) -> list[dict]:
    """Gemini contents from stored messages, oldest first. Same-role neighbors
    are merged, and the list starts with the user, as Gemini expects."""
    rows = [t for t in (_as_text(m) for m in messages) if t and t[1].strip()][-MAX_HISTORY:]
    contents: list[dict] = []
    for role, text in rows:
        if contents and contents[-1]["role"] == role:
            contents[-1]["parts"].append({"text": text})
        else:
            contents.append({"role": role, "parts": [{"text": text}]})
    while contents and contents[0]["role"] != "user":
        contents.pop(0)
    return contents
