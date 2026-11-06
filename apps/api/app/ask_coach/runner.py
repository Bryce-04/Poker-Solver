"""Runs one Coach turn in the background (docs/coach.md §3.2).

POST .../messages stores the user's text, sets the conversation `working`, and
hands the turn to a single-worker pool here; the frontend polls
GET .../{id}?after= for what the turn stores.

A turn: build the request (system prompt with the current spot, the last
messages), then loop. Call Gemini; run each tool it asks for, storing cards as
they go; send the results back. Stop when Gemini answers in plain text, and
store that. At most MAX_TOOL_ROUNDS rounds of tools; after that Gemini is asked
for text only. Each card is stored in its own short transaction, so polling
sees it straight away and nothing holds the conversation's lock while Gemini
thinks.

Failures:
- Gemini busy (rate limited or overloaded everywhere): an `error` message
  (`gemini_busy`), and the message doesn't count against the user's limit.
- No GEMINI_API_KEY: an `error` saying so, also not counted.
- Anything else: an `internal` error.
Each sets the status `error`. Logs carry ids, tool names and error types,
never message text (§6).
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import Future, ThreadPoolExecutor
from uuid import UUID

from poker_solver_schema import Spot
from sqlalchemy import select

from .. import coach as train_coach
from ..db import CoachConversationRow, CoachMessageRow, SessionLocal
from . import gemini, limits, store, tools
from .prompt import system_instruction

log = logging.getLogger("ask_coach")

# One worker: the solver runs one solve at a time anyway (solve.py's SolverBusy),
# and a queue keeps turns from piling onto it.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ask-coach")

MAX_TOOL_ROUNDS = 4
# Enough history for the model, without reading a long conversation whole.
LOAD_MESSAGES = 40
MAX_REPLY_CHARS = 2000

INTERNAL_ERROR_TEXT = "Something went wrong on our side. Try again."
BUSY_TEXT = "The Coach is busy right now. Try again in a minute."
NOT_CONFIGURED_TEXT = "The Coach isn't switched on for this server yet."
NO_ANSWER_TEXT = "Sorry, I couldn't put an answer together for that. Could you say it another way?"


class _Refunded(Exception):
    """A failure that doesn't count against the user's limit."""

    def __init__(self, kind: str, text: str, owner: UUID) -> None:
        super().__init__(kind)
        self.kind, self.text, self.owner = kind, text, owner


def submit(conversation_id: UUID) -> Future:
    """Queues the turn. Tests replace this with an inline call to run_turn."""
    return _executor.submit(run_turn, conversation_id)


def run_turn(conversation_id: UUID) -> None:
    """Answers the conversation's latest message, then sets it back to `idle`.
    Never raises: any failure is stored as an `error` message, status `error`."""
    owner: UUID | None = None
    try:
        owner = _run(conversation_id)
    except _Refunded as e:
        log.warning("ask_coach: turn not answered conversation=%s (%s)", conversation_id, e.kind)
        limits.give_back(e.owner)
        _finish_with_error(conversation_id, e.kind, e.text)
    except Exception as e:
        log.exception("ask_coach: turn failed conversation=%s (%s)", conversation_id, type(e).__name__)
        _finish_with_error(conversation_id, "internal", INTERNAL_ERROR_TEXT)
    else:
        if owner is not None:
            log.info("ask_coach: turn finished conversation=%s", conversation_id)


def _run(conversation_id: UUID) -> UUID | None:
    with SessionLocal() as db:
        conversation = db.get(CoachConversationRow, conversation_id)
        if conversation is None:  # deleted while queued
            return None
        owner = conversation.created_by
        messages = list(
            reversed(
                db.scalars(
                    select(CoachMessageRow)
                    .where(CoachMessageRow.conversation_id == conversation_id)
                    .order_by(CoachMessageRow.seq.desc())
                    .limit(LOAD_MESSAGES)
                ).all()
            )
        )
        db.expunge_all()

    model = gemini.get_model()
    if model is None:
        raise _Refunded("not_configured", NOT_CONFIGURED_TEXT, owner)

    latest_user = next((m for m in reversed(messages) if m.kind == "user_text"), None)
    attached = (latest_user.payload or {}).get("attached_spot") if latest_user else None
    current = next((m.payload for m in reversed(messages) if m.kind == "spot_card"), None)
    ctx = tools.ToolContext(
        conversation_id=conversation_id,
        store=lambda kind, payload, title: _store(conversation_id, kind, payload, title),
        attached_spot=Spot.model_validate(attached) if attached else None,
        current_spot=current,
        user_texts=[(m.payload or {}).get("text", "") for m in messages if m.kind == "user_text"],
    )
    contents = gemini.build_contents(messages)
    stored_text = False
    said: list[str] = []  # this turn's coach text so far: the model often repeats it at the end

    for round_ in range(MAX_TOOL_ROUNDS + 1):
        allow_tools = round_ < MAX_TOOL_ROUNDS
        try:
            parts = model.generate_turn(
                system_instruction(ctx.current_spot), contents, tools.DECLARATIONS, allow_tools=allow_tools
            )
        except train_coach.CoachBusy as e:
            raise _Refunded("gemini_busy", BUSY_TEXT, owner) from e
        text = "\n\n".join(p["text"] for p in parts if "text" in p and not p.get("thought")).strip()
        calls = [p["functionCall"] for p in parts if "functionCall" in p] if allow_tools else []
        paras, imitated_advice, bulleted = _split_imitations(_paras(text))
        paras = _without_repeats(
            paras,
            said
            + ctx.advice_paras
            + [str(a) for c in calls if c.get("name") == "give_general_advice" for a in (c.get("args") or {}).get("paras") or []],
        )
        said += paras
        if paras:
            # Text that comes with tool calls ("I'm assuming...") goes before their cards.
            _store(conversation_id, "coach_text", {"paras": paras}, None)
            stored_text = True
        if imitated_advice:
            # Advice the model wrote as text dressed up as the box becomes the real,
            # labeled box: the label comes from the backend, never from the model.
            tools.execute("give_general_advice", {"paras": imitated_advice}, ctx)
        if bulleted and "suggest_followups" not in ctx.called:
            # Follow-ups written as a bullet list become the tappable suggestions.
            tools.execute("suggest_followups", {"items": bulleted}, ctx)
        if not calls:
            break
        contents.append({"role": "model", "parts": parts})
        contents.append(
            {
                "role": "user",
                "parts": [
                    {"functionResponse": {"name": c.get("name", ""), "response": tools.execute(c.get("name", ""), c.get("args"), ctx)}}
                    for c in calls
                ],
            }
        )

    if not stored_text and not ctx.called:
        _store(conversation_id, "coach_text", {"paras": [NO_ANSWER_TEXT]}, None)
    _set_status(conversation_id, store.IDLE)
    return owner


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9']+", text.lower()))


_IMITATED_ADVICE = re.compile(r"^[\[(]\s*general advice[^:\])]*:\s*(.+?)[\])]?$", re.IGNORECASE | re.DOTALL)
_IMITATED_NOTE = re.compile(
    r"^[\[(]\s*(app note|spot card|follow-ups|suggested follow-ups|solver result|general advice)", re.IGNORECASE
)


_BULLET = re.compile(r"(?:^|\s)[*\-•]\s+")


def _split_imitations(paras: list[str]) -> tuple[list[str], list[str], list[str]]:
    """(paragraphs to keep, advice to show as a real box, follow-ups). The model
    sometimes writes in its text what belongs in a card: "[General advice box:
    ...]" becomes a real general_advice card, a bullet list of short questions
    becomes the suggestions, and any other imitated app note is dropped."""
    kept, advice, bullets = [], [], []
    for para in paras:
        m = _IMITATED_ADVICE.match(para)
        if m:
            advice.append(m.group(1).strip())
            continue
        if _IMITATED_NOTE.match(para):
            continue
        if _BULLET.match(para):
            items = [i.strip() for i in _BULLET.split(para) if i.strip()]
            if items and all(len(i) <= 40 for i in items):
                bullets += items
                continue
        kept.append(para)
    return kept, advice, bullets


_LABEL_WORDS = {"general", "advice", "not", "from", "the", "solver"}


def _without_repeats(paras: list[str], earlier: list[str]) -> list[str]:
    """Drops paragraphs that repeat something already shown this turn: the
    general advice (the model echoes the labeled box as its own, unlabeled
    text, against spec rule 4) or its own earlier text (it often restates
    "I'm assuming..." at the end)."""
    shown = [_words(a) for a in earlier if a.strip()]
    kept = []
    for para in paras:
        words = _words(para)
        if words and any(len(words & a) >= 0.6 * len(words) for a in shown):
            continue
        if words and words <= _LABEL_WORDS:  # a copy of the advice box's label, on its own
            continue
        kept.append(para)
    return kept


_TAG = re.compile(r"<[^>]{0,300}>")
_BLOCK_TAG = re.compile(r"</?(p|div|br|li|ul|ol|h[1-6])\b[^>]{0,300}>", re.IGNORECASE)


def _paras(text: str) -> list[str]:
    """The model's text as plain paragraphs. The Coach shows plain text, and the
    model sometimes writes HTML or Markdown (once, its own "Not from the solver"
    box): tags and emphasis marks are removed, block tags become paragraph
    breaks."""
    text = _BLOCK_TAG.sub("\n\n", text)
    text = _TAG.sub("", text)
    text = re.sub(r"(\*\*|__|^#+\s*)", "", text, flags=re.MULTILINE)
    text = text[:MAX_REPLY_CHARS]
    return [" ".join(p.split()) for p in text.split("\n\n") if p.strip()]


def _store(conversation_id: UUID, kind: str, payload: dict, title: str | None) -> None:
    """Appends one message in its own transaction. A spot card's title replaces
    the conversation's title while that is still the automatic one."""
    with SessionLocal() as db:
        conversation = store.locked_conversation(db, conversation_id)
        if conversation is None:
            return
        if title and conversation.title == store.first_text_title(db, conversation_id):
            conversation.title = title
        store.append_message(db, conversation, kind, payload)
        db.commit()


def _set_status(conversation_id: UUID, status: str) -> None:
    with SessionLocal() as db:
        conversation = store.locked_conversation(db, conversation_id)
        if conversation is not None:
            conversation.status = status
            db.commit()


def _finish_with_error(conversation_id: UUID, kind: str, text: str) -> None:
    try:
        with SessionLocal() as db:
            conversation = store.locked_conversation(db, conversation_id)
            if conversation is None:
                return
            store.append_message(db, conversation, "error", {"kind": kind, "text": text})
            conversation.status = store.ERROR
            db.commit()
    except Exception:
        # The database itself is failing. The stale-turn reset will clear the
        # `working` status once it's reachable again.
        log.exception("ask_coach: could not store the error conversation=%s", conversation_id)
