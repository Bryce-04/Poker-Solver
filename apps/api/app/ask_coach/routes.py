"""The Coach's endpoints (docs/coach.md §3.3). All require sign-in, and each
only ever touches the caller's own conversations; anyone else's is a 404.

    POST   /coach/conversations                  create one -> 201 {id}
    GET    /coach/conversations                  the caller's, newest first
    GET    /coach/conversations/{id}?after=N     {id, title, status, messages with seq > N}
    POST   /coach/conversations/{id}/messages    {text, attached_spot?} -> 202 {last_seq}
                                                 409 while a turn runs, 429 {used, limit, all_users_exhausted}
    PATCH  /coach/conversations/{id}             {title}
    DELETE /coach/conversations/{id}             204, messages too
    GET    /coach/usage                          {used, limit, resets_at, all_users_exhausted}

These share the /coach prefix with the Train coach (POST /coach, /coach/chat
in ../routes/coach.py); the paths don't overlap.
"""

import logging
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from poker_solver_schema import Spot

from ..auth import current_user_id
from ..db import CoachConversationRow, CoachMessageRow, get_db
from . import limits, runner, store

log = logging.getLogger("ask_coach")

router = APIRouter(prefix="/coach", tags=["coach"])

PREVIEW_CHARS = 80

Status = Literal["idle", "working", "waiting_for_solver", "error"]


class CreatedConversation(BaseModel):
    id: UUID


class ConversationSummary(BaseModel):
    id: UUID
    title: str | None
    preview: str | None
    updated_at: datetime
    status: Status


class MessageOut(BaseModel):
    seq: int
    kind: str
    payload: dict
    created_at: datetime


class ConversationOut(BaseModel):
    id: UUID
    title: str | None
    status: Status
    messages: list[MessageOut]


class SendMessage(BaseModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    attached_spot: Spot | None = None


class Sent(BaseModel):
    last_seq: int


class RenameConversation(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class UsageOut(BaseModel):
    """The shared Gemini limit (limits.py): `used` of `limit` this hour, the
    oldest of them stops counting at `resets_at`."""

    used: int
    limit: int
    resets_at: datetime
    all_users_exhausted: bool


def _previews(db: Session, ids: list[UUID]) -> dict[UUID, str]:
    """The start of each conversation's latest Coach text."""
    if not ids:
        return {}
    rows = db.execute(
        select(CoachMessageRow.conversation_id, CoachMessageRow.payload)
        .where(CoachMessageRow.conversation_id.in_(ids), CoachMessageRow.kind == "coach_text")
        .order_by(CoachMessageRow.conversation_id, CoachMessageRow.seq.desc())
        .distinct(CoachMessageRow.conversation_id)
    ).all()
    out = {}
    for conversation_id, payload in rows:
        paras = payload.get("paras") or []
        if paras:
            out[conversation_id] = " ".join(str(paras[0]).split())[:PREVIEW_CHARS]
    return out


def _summary(row: CoachConversationRow, preview: str | None) -> ConversationSummary:
    return ConversationSummary(
        id=row.id, title=row.title, preview=preview, updated_at=row.updated_at, status=row.status
    )


@router.post("/conversations", status_code=201)
def create_conversation(
    db: Session = Depends(get_db), user_id: UUID = Depends(current_user_id)
) -> CreatedConversation:
    stamp = store.now()
    row = CoachConversationRow(
        id=uuid4(),
        created_by=user_id,
        title=None,
        status=store.IDLE,
        created_at=stamp,
        updated_at=stamp,
    )
    db.add(row)
    db.commit()
    return CreatedConversation(id=row.id)


@router.get("/conversations")
def list_conversations(
    db: Session = Depends(get_db), user_id: UUID = Depends(current_user_id)
) -> list[ConversationSummary]:
    busy = db.scalars(
        select(CoachConversationRow)
        .where(
            CoachConversationRow.created_by == user_id,
            CoachConversationRow.status.in_(store.BUSY_STATUSES),
        )
        .with_for_update()
    ).all()
    if any([store.reset_if_stale(db, row) for row in busy]):
        db.commit()
    else:
        db.rollback()  # releases the locks
    rows = db.scalars(
        select(CoachConversationRow)
        .where(CoachConversationRow.created_by == user_id)
        .order_by(CoachConversationRow.updated_at.desc())
    ).all()
    previews = _previews(db, [r.id for r in rows])
    return [_summary(r, previews.get(r.id)) for r in rows]


@router.get("/conversations/{conversation_id}")
def get_conversation(
    conversation_id: UUID,
    after: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> ConversationOut:
    row = store.own_conversation(db, conversation_id, user_id, lock=True)
    if store.reset_if_stale(db, row):
        db.commit()
    else:
        db.rollback()  # releases the lock
    messages = db.scalars(
        select(CoachMessageRow)
        .where(CoachMessageRow.conversation_id == conversation_id, CoachMessageRow.seq > after)
        .order_by(CoachMessageRow.seq)
    ).all()
    return ConversationOut(
        id=row.id,
        title=row.title,
        status=row.status,
        messages=[
            MessageOut(seq=m.seq, kind=m.kind, payload=m.payload, created_at=m.created_at)
            for m in messages
        ],
    )


@router.post(
    "/conversations/{conversation_id}/messages",
    status_code=202,
    responses={409: {"description": "A turn is already running"}, 429: {"description": "Over the daily limit: {used, limit}"}},
)
def send_message(
    conversation_id: UUID,
    body: SendMessage,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
):
    row = store.own_conversation(db, conversation_id, user_id, lock=True)
    store.reset_if_stale(db, row)
    if row.status in store.BUSY_STATUSES:
        db.commit()
        raise HTTPException(status_code=409, detail="The Coach is still answering. Wait for it to finish.")
    if not limits.take(user_id):
        db.commit()
        u = limits.usage(user_id)
        return JSONResponse(
            status_code=429,
            content={"used": u.used, "limit": u.limit, "all_users_exhausted": u.all_users_exhausted},
        )

    payload: dict = {"text": body.text}
    if body.attached_spot is not None:
        # Kept for Phase 2, which uses an attached (parsed hand history) spot
        # directly instead of the model's reading of the text (§4.1).
        payload["attached_spot"] = body.attached_spot.model_dump(mode="json")
    message = store.append_message(db, row, "user_text", payload)
    if row.title is None:
        row.title = store.title_from_text(body.text)
    row.status = store.WORKING
    db.commit()

    runner.submit(conversation_id)
    log.info("ask_coach: turn queued conversation=%s seq=%s", conversation_id, message.seq)
    return Sent(last_seq=message.seq)


@router.patch("/conversations/{conversation_id}")
def rename_conversation(
    conversation_id: UUID,
    body: RenameConversation,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> ConversationSummary:
    row = store.own_conversation(db, conversation_id, user_id)
    row.title = body.title
    db.commit()
    return _summary(row, _previews(db, [row.id]).get(row.id))


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: UUID,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> Response:
    db.delete(store.own_conversation(db, conversation_id, user_id))
    db.commit()
    return Response(status_code=204)


@router.get("/usage")
def get_usage(user_id: UUID = Depends(current_user_id)) -> UsageOut:
    u = limits.usage(user_id)
    return UsageOut(
        used=u.used, limit=u.limit, resets_at=u.resets_at, all_users_exhausted=u.all_users_exhausted
    )
