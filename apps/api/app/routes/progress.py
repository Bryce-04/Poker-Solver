"""Train-tab lesson progress, per signed-in user (GET /progress, PUT
/progress/{lesson_id}). The server stores what the web app tells it and never
interprets a lesson; each user only ever sees and changes their own rows.

Merging across devices is "newest attempt wins": a PUT carries the time of the
attempt (`at`, client milliseconds) and is applied only if it is not older than
what is stored, so a late-arriving upload from an offline device can't undo a
newer attempt, and repeating a PUT is harmless. See docs/decisions.md.
"""

import time
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import current_user_id
from ..db import LessonProgressRow, get_db

router = APIRouter(prefix="/progress", tags=["progress"])

LessonId = Annotated[str, Path(pattern=r"^[a-z0-9][a-z0-9-]{0,63}$")]
# More rows than any course will have; stops one account filling the table.
MAX_LESSONS_PER_USER = 100
# A clock this far ahead of the server is wrong; accepting it would pin the row.
MAX_CLOCK_SKEW_MS = 24 * 3600 * 1000


class ProgressIn(BaseModel):
    done: bool
    correct: int = Field(ge=0, le=200)
    total: int = Field(ge=0, le=200)
    at: int = Field(ge=0, description="When the attempt finished, client ms since the epoch.")

    @model_validator(mode="after")
    def _score_is_possible(self) -> "ProgressIn":
        if self.correct > self.total:
            raise ValueError("correct cannot exceed total")
        return self


class ProgressOut(ProgressIn):
    pass


class ProgressList(BaseModel):
    lessons: dict[str, ProgressOut]


def _out(row: LessonProgressRow) -> ProgressOut:
    return ProgressOut(done=row.done, correct=row.correct, total=row.total, at=row.updated_at)


@router.get("")
def list_progress(user: UUID = Depends(current_user_id), db: Session = Depends(get_db)) -> ProgressList:
    rows = db.scalars(select(LessonProgressRow).where(LessonProgressRow.user_id == user)).all()
    return ProgressList(lessons={r.lesson_id: _out(r) for r in rows})


@router.put("/{lesson_id}")
def put_progress(
    lesson_id: LessonId,
    body: ProgressIn,
    user: UUID = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ProgressOut:
    """Stores the attempt if it is the newest one, and returns what is stored
    afterwards (the caller's own attempt, or the newer one that was already
    there)."""
    if body.at > time.time() * 1000 + MAX_CLOCK_SKEW_MS:
        raise HTTPException(status_code=422, detail="That attempt time is in the future.")

    for attempt in (1, 2):
        row = db.get(LessonProgressRow, (user, lesson_id))
        if row is None:
            count = len(db.scalars(select(LessonProgressRow.lesson_id).where(LessonProgressRow.user_id == user)).all())
            if count >= MAX_LESSONS_PER_USER:
                raise HTTPException(status_code=422, detail="Too many lessons saved for this account.")
            row = LessonProgressRow(user_id=user, lesson_id=lesson_id)
            db.add(row)
        elif body.at < row.updated_at:
            return _out(row)  # an older attempt: keep the newer one
        row.done, row.correct, row.total, row.updated_at = body.done, body.correct, body.total, body.at
        try:
            db.commit()
            return _out(row)
        except IntegrityError:
            # Two first writes for the same lesson raced; the other one won the
            # insert, so go round again and update its row.
            db.rollback()
            if attempt == 2:
                raise
    raise AssertionError("unreachable")
