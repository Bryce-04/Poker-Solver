"""Runs one Coach turn in the background (docs/coach.md §3.2).

A turn will take 10-90s once it calls the solver, so POST .../messages only
stores the user's text, sets the conversation `working`, and hands the turn to
a single-worker pool here; the frontend polls GET .../{id}?after= for what the
turn stores.

Phase 1: there's no Gemini yet, so a turn stores a fixed reply. Phase 2
replaces `_reply` with the Gemini tool loop; the status handling and the error
path around it stay.

Logs carry conversation ids and error types, never message text (§6).
"""

import logging
from concurrent.futures import Future, ThreadPoolExecutor
from uuid import UUID

from ..db import SessionLocal
from . import store

log = logging.getLogger("ask_coach")

# One worker: the solver runs one solve at a time anyway (solve.py's SolverBusy),
# and a queue keeps turns from piling onto it.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ask-coach")

PLACEHOLDER_REPLY = [
    "The Coach isn't connected to the solver yet, so this is a placeholder reply.",
    "Your message is saved. Real answers arrive in a later update.",
]
INTERNAL_ERROR_TEXT = "Something went wrong on our side. Try again."


def submit(conversation_id: UUID) -> Future:
    """Queues the turn. Tests replace this with an inline call to run_turn."""
    return _executor.submit(run_turn, conversation_id)


def _reply(db, conversation) -> None:
    store.append_message(db, conversation, "coach_text", {"paras": list(PLACEHOLDER_REPLY)})


def run_turn(conversation_id: UUID) -> None:
    """Answers the conversation's latest message, then sets it back to `idle`.
    Never raises: any failure is stored as an `error` message, status `error`."""
    try:
        with SessionLocal() as db:
            conversation = store.locked_conversation(db, conversation_id)
            if conversation is None:  # deleted while queued
                return
            _reply(db, conversation)
            conversation.status = store.IDLE
            db.commit()
        log.info("ask_coach: turn finished conversation=%s", conversation_id)
    except Exception as e:
        log.exception("ask_coach: turn failed conversation=%s (%s)", conversation_id, type(e).__name__)
        _store_error(conversation_id)


def _store_error(conversation_id: UUID) -> None:
    try:
        with SessionLocal() as db:
            conversation = store.locked_conversation(db, conversation_id)
            if conversation is None:
                return
            store.append_message(
                db, conversation, "error", {"kind": "internal", "text": INTERNAL_ERROR_TEXT}
            )
            conversation.status = store.ERROR
            db.commit()
    except Exception:
        # The database itself is failing. The stale-turn reset will clear the
        # `working` status once it's reachable again.
        log.exception("ask_coach: could not store the error conversation=%s", conversation_id)
