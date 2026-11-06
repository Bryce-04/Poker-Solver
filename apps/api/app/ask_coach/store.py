"""Database helpers for Coach conversations, shared by the routes and the runner.

Every message gets the next `seq` in its conversation. Callers append while
holding the conversation row's lock (`own_conversation(..., lock=True)` or
`locked_conversation`), so two writers can't take the same number.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import CoachConversationRow, CoachMessageRow

IDLE = "idle"
WORKING = "working"
WAITING_FOR_SOLVER = "waiting_for_solver"
ERROR = "error"
# A turn is running: a new message is refused (409) until it finishes.
BUSY_STATUSES = (WORKING, WAITING_FOR_SOLVER)

# A turn that hasn't touched its conversation in this long was lost (the server
# restarted mid-turn); the next read resets it to `error`.
STALE_AFTER = timedelta(minutes=5)
STALE_TEXT = "The Coach stopped before it finished answering. Try again."


def now() -> datetime:
    return datetime.now(UTC)


TITLE_FROM_TEXT_CHARS = 40


def title_from_text(text: str) -> str:
    """A conversation's title before it has a spot: the start of its first message."""
    return " ".join(text.split())[:TITLE_FROM_TEXT_CHARS].rstrip()


def first_text_title(db: Session, conversation_id: UUID) -> str | None:
    """The automatic title the first message gave the conversation. A title
    still equal to it hasn't been renamed, so a spot card may replace it."""
    first = db.scalar(
        select(CoachMessageRow.payload)
        .where(CoachMessageRow.conversation_id == conversation_id, CoachMessageRow.kind == "user_text")
        .order_by(CoachMessageRow.seq)
        .limit(1)
    )
    return title_from_text(first.get("text", "")) if first else None


def own_conversation(
    db: Session, conversation_id: UUID, user_id: UUID, *, lock: bool = False
) -> CoachConversationRow:
    """The caller's own conversation, or 404 -- the same 404 whether it doesn't
    exist or belongs to someone else, so ids can't be probed."""
    stmt = select(CoachConversationRow).where(CoachConversationRow.id == conversation_id)
    if lock:
        stmt = stmt.with_for_update()
    row = db.scalars(stmt).first()
    if row is None or row.created_by != user_id:
        raise HTTPException(status_code=404, detail="No such conversation.")
    return row


def locked_conversation(db: Session, conversation_id: UUID) -> CoachConversationRow | None:
    """The conversation, row-locked, for the runner (which has no user to check)."""
    return db.scalars(
        select(CoachConversationRow)
        .where(CoachConversationRow.id == conversation_id)
        .with_for_update()
    ).first()


def append_message(
    db: Session, conversation: CoachConversationRow, kind: str, payload: dict
) -> CoachMessageRow:
    """Adds a message with the next seq and bumps the conversation's
    updated_at. The caller holds the conversation's lock and commits."""
    last = db.scalar(
        select(func.max(CoachMessageRow.seq)).where(
            CoachMessageRow.conversation_id == conversation.id
        )
    )
    stamp = now()
    message = CoachMessageRow(
        id=uuid4(),
        conversation_id=conversation.id,
        seq=(last or 0) + 1,
        kind=kind,
        payload=payload,
        created_at=stamp,
    )
    db.add(message)
    conversation.updated_at = stamp
    db.flush()
    return message


def last_seq(db: Session, conversation_id: UUID) -> int:
    return (
        db.scalar(
            select(func.max(CoachMessageRow.seq)).where(
                CoachMessageRow.conversation_id == conversation_id
            )
        )
        or 0
    )


def reset_if_stale(db: Session, conversation: CoachConversationRow) -> bool:
    """A busy conversation untouched for STALE_AFTER gets an `error` message
    and status `error`. Returns whether it was reset. The caller commits."""
    if conversation.status not in BUSY_STATUSES:
        return False
    if now() - conversation.updated_at < STALE_AFTER:
        return False
    append_message(db, conversation, "error", {"kind": "internal", "text": STALE_TEXT})
    conversation.status = ERROR
    return True
