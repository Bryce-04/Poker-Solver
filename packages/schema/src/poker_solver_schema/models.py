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
    """Maps a hand to a weight in [0, 1] — the fraction of the time that
    hand is played this way. A key is either a 169-type label ('AKs', '72o',
    'TT'), which sets every suit combo of that hand, or one specific combo
    ('AhKh', two cards, rank then suit each), which overrides its label's
    weight for just that combo — so 'AKs: 1, AhKh: 0' is AKs without the
    heart combo. Suits matter for flush draws and blockers. A range grid
    selection (Stage 2) serializes directly into this shape."""

    root: dict[str, float]


class BetMenu(BaseModel):
    """The bet and raise sizes a solve may use on a street, replacing the
    fixed 25% / 75% / 125% menu. All-in is always available on top of
    `sizes`. Omit it from a Spot for the default menu.

    The limits here are the solver's own (poker_solver.betting_round.BetMenu,
    which is what actually validates and enforces them); they're repeated so
    a bad menu is rejected at the edge with a field-level message.
    """

    sizes: list[float] = Field(
        min_length=1,
        max_length=5,
        description=(
            "Bet/raise sizes as fractions of the pot, ascending and at least 1% of "
            "the pot apart (0.33 = a third of the pot, 1.0 = pot-sized). Each between "
            "0.05 and 5.0."
        ),
    )
    max_aggressive_actions: int = Field(
        default=3,
        ge=1,
        le=5,
        description=(
            "How many bets/raises are allowed on the street before only fold, call "
            "and all-in remain. The tree, and the solve time, grow with it."
        ),
    )


class RiverSpec(BaseModel):
    """Ask a TURN solve to include the river: a joint turn + river solve.

    A normal turn solve ends where the turn's betting ends (the river card then
    comes, nobody bets, showdown), so it can't know what the river will be like.
    With a RiverSpec, a turn line that closes without a fold deals a river card
    and plays the river's betting, every river card with its own strategies, and
    the turn strategy is worked out knowing that. The board must have 4 cards.

    The game this builds is large (every closing turn line, times every river
    card, times the river's betting), so it is solved on small menus and, by
    default, with a sample of the river cards instead of all of them; the
    response says exactly what was used.
    """

    bet_menu: BetMenu | None = Field(
        default_factory=lambda: BetMenu(sizes=[0.75], max_aggressive_actions=1),
        description=(
            "The river's bet sizes. Omit for one 75% size and no sized re-raise; null for NO "
            "river betting (the river card is dealt and the hand goes to showdown, "
            "which is the cheapest way to get exact river equity into the turn "
            "strategy)."
        ),
    )
    cards: int | None = Field(
        default=None,
        ge=1,
        le=48,
        description=(
            "How many river cards to enumerate. null means 12, spread across ranks and "
            "suits; 48 is every card that can come (exact, and expensive). Fewer "
            "cards is an approximation."
        ),
    )


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
    name: str | None = Field(
        default=None,
        max_length=120,
        description="The user's name for a saved spot. Null for spots saved before names existed.",
    )

    positions_in_hand: list[Position]
    effective_stack_bb: float = Field(gt=0)
    pot_bb: float | None = Field(default=None, ge=0)

    board: list[str] = Field(default_factory=list, max_length=5)
    current_street: Street = Street.PREFLOP
    actions: list[BettingAction] = Field(default_factory=list)
    ranges: dict[Position, HandRange] = Field(default_factory=dict)
    bet_menu: BetMenu | None = Field(
        default=None,
        description=(
            "Custom bet sizes for a postflop solve of this spot. Null means the "
            "default menu (25% / 75% / 125% of the pot, or all-in)."
        ),
    )

    river: RiverSpec | None = Field(
        default=None,
        description=(
            "Solve the river as well as the turn (turn boards only). Null: a plain "
            "single-street solve."
        ),
    )

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
