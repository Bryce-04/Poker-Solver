"""The Spot model — the one shape every entry path (Stages 2-4) converges on,
and the one shape the solver (Stage 5) and storage (Stage 6) both read.

This is Stage 1 scope: get the shape right before anything is built on top of
it. Two things are deliberately narrow for now and called out inline:

  - `effective_stack_bb` is a single number (symmetric stacks), matching the
    heads-up, fixed-bet-size solver scope locked in for Stage 5. Widening to
    per-seat stacks is a Stage 5+ change, not a Stage 1 one.
  - `board` allows 0-5 cards so the same model covers preflop-only spots
    (Stage 2 reference charts) and postflop spots (Stage 5 solving) without
    two separate types.

TypeScript types are generated from this file (see
packages/schema/scripts/generate_ts_types.py) rather than hand-duplicated on
the frontend.
"""

from __future__ import annotations

from datetime import UTC, datetime


def _utcnow() -> datetime:
    return datetime.now(UTC)
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, EmailStr, Field, RootModel


class Position(str, Enum):
    UTG = "UTG"
    UTG1 = "UTG1"
    LJ = "LJ"
    HJ = "HJ"
    CO = "CO"
    BTN = "BTN"
    SB = "SB"
    BB = "BB"


class Street(str, Enum):
    PREFLOP = "preflop"
    FLOP = "flop"
    TURN = "turn"
    RIVER = "river"


class ActionType(str, Enum):
    FOLD = "fold"
    CHECK = "check"
    CALL = "call"
    BET = "bet"
    RAISE = "raise"
    ALL_IN = "all_in"


CARD_PATTERN = r"^[2-9TJQKA][shdc]$"


class BettingAction(BaseModel):
    """One action in the hand's history, in order."""

    position: Position
    street: Street
    action: ActionType
    size_bb: float | None = Field(
        default=None, description="Bet/raise size in big blinds, if applicable."
    )
    size_pct_pot: float | None = Field(
        default=None, description="Bet/raise size as a fraction of the pot, if known instead."
    )


class HandRange(RootModel[dict[str, float]]):
    """Maps a hand combo notation (e.g. 'AKs', '72o', 'TT') to a weight in
    [0, 1] — the fraction of the time that hand is played this way. A range
    grid selection (Stage 2) serializes directly into this shape."""

    root: dict[str, float]


class Spot(BaseModel):
    """A single poker situation: who's in it, what's happened, and what's
    being asked about it. Produced identically by the button builder
    (Stage 2), the text parser (Stage 3), and hand history import (Stage 4).
    """

    id: UUID = Field(default_factory=uuid4)
    created_by: UUID | None = Field(
        default=None, description="Owning user's id. Null until Stage 6 auth exists."
    )
    created_at: datetime = Field(default_factory=_utcnow)

    positions_in_hand: list[Position]
    effective_stack_bb: float = Field(gt=0)
    pot_bb: float | None = Field(default=None, ge=0)

    board: list[str] = Field(default_factory=list, max_length=5)
    current_street: Street = Street.PREFLOP
    actions: list[BettingAction] = Field(default_factory=list)
    ranges: dict[Position, HandRange] = Field(default_factory=dict)

    opponent_tags: dict[Position, list[str]] = Field(
        default_factory=dict,
        description="Stage 6: preset or free-text tendency tags per opponent seat.",
    )


class User(BaseModel):
    """Minimal account shape, added in Stage 1 so Stage 6 doesn't retrofit
    ownership onto Spot rows that already exist. No auth/login UI ships
    until Stage 6 — this is just the row shape."""

    id: UUID = Field(default_factory=uuid4)
    email: EmailStr
    display_name: str | None = None
    created_at: datetime = Field(default_factory=_utcnow)
