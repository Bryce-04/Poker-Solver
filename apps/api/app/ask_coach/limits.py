"""The Coach page's usage limit, which is the Train coach's: one limit for every
Gemini question in the app (app/coach.py's `limiter`). That's COACH_PER_HOUR
questions per user in any hour, and COACH_PER_DAY_TOTAL across all users per
day, a guard for the free tier's shared quota. A Coach page message counts once,
however many tool rounds it takes. See docs/decisions.md.

The limiter is in memory, so a server restart resets it, which is fine for a
free-tier guard rather than a billing control.

`coach.limiter` is read on every call (never imported by name), so tests can
swap it.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from .. import coach as train_coach


@dataclass(frozen=True)
class Usage:
    used: int
    limit: int
    # When the user's oldest counted message stops counting; now if none count.
    resets_at: datetime
    # The all-users daily total is used up: nobody can ask until it frees up.
    all_users_exhausted: bool


def take(user_id: UUID) -> bool:
    """Counts one message if the limit allows it."""
    return train_coach.limiter.allow(user_id)


def give_back(user_id: UUID) -> None:
    """Un-counts the user's latest message (Gemini was busy or isn't set up)."""
    train_coach.limiter.refund(user_id)


def usage(user_id: UUID) -> Usage:
    limiter = train_coach.limiter
    used, oldest_expires, all_exhausted = limiter.usage(user_id)
    now = datetime.now(UTC)
    resets_at = datetime.fromtimestamp(oldest_expires, UTC) if oldest_expires else now
    return Usage(used=used, limit=limiter.per_hour, resets_at=resets_at, all_users_exhausted=all_exhausted)
