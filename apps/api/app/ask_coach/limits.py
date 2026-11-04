"""The Coach's daily per-user message limit (docs/coach.md §3.3).

COACH_DAILY_LIMIT (default 25) user messages per user per UTC day, counted from
the `user_text` messages stored in the user's conversations, so the count
survives restarts and needs no table of its own. Separate from the Train
coach's COACH_PER_HOUR / COACH_PER_DAY_TOTAL (app/coach.py).

Deleting a conversation deletes its messages, so it also gives back that day's
messages. Accepted for now; noted in docs/decisions.md.
"""

import os
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import CoachConversationRow, CoachMessageRow
from .store import now

DEFAULT_DAILY_LIMIT = 25


def daily_limit() -> int:
    """Read on every call, so a changed environment needs no restart in tests."""
    raw = os.environ.get("COACH_DAILY_LIMIT", "").strip()
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_DAILY_LIMIT
    return value if value >= 0 else DEFAULT_DAILY_LIMIT


@dataclass(frozen=True)
class Usage:
    used: int
    limit: int
    resets_at: datetime

    @property
    def exhausted(self) -> bool:
        return self.used >= self.limit


def usage(db: Session, user_id: UUID) -> Usage:
    current = now()
    day_start = datetime.combine(current.date(), time(0), tzinfo=current.tzinfo)
    used = db.scalar(
        select(func.count())
        .select_from(CoachMessageRow)
        .join(CoachConversationRow, CoachConversationRow.id == CoachMessageRow.conversation_id)
        .where(
            CoachConversationRow.created_by == user_id,
            CoachMessageRow.kind == "user_text",
            CoachMessageRow.created_at >= day_start,
        )
    )
    return Usage(used=used or 0, limit=daily_limit(), resets_at=day_start + timedelta(days=1))
