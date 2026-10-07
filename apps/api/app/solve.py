"""Stage 5 endpoint's business logic: turn a submitted Spot into a real
MCCFR solve (services/solver) and shape the response. Kept separate from
routes/spots.py's wiring, same split as reference_charts.py.

Spot.positions_in_hand/ranges are only ever populated with ONE entry by
every entry path shipped so far (apps/web/src/lib/spot.ts) -- a solve
needs two. This introduces that convention explicitly (no schema change,
Spot already allows it): positions_in_hand must have exactly two entries,
index 0 is out-of-position / first-to-act this street, index 1 is in
position, and ranges must have an entry for both.

Mid-street solving isn't supported yet: the only history this street may
already carry is empty, or exactly one check from positions_in_hand[0].
Anything else -- a bet/raise/call/fold already recorded, or more than one
action -- is rejected rather than guessed at, partly because reverse-
mapping an arbitrary recorded BettingAction (a bb/pot-% size) onto this
engine's fixed 33/66/100%-pot menu isn't always a clean mapping.
"""

from __future__ import annotations

import logging
import time

from poker_solver.cards import parse_card
from poker_solver.postflop_mccfr import (
    PostflopMccfrTrainer,
    PostflopSpotConfig,
    aggregate_label_strategies,
)

from poker_solver_schema import ActionType, Spot

logger = logging.getLogger(__name__)

# Measured, not guessed: 8,000 iterations on a realistic wide range pair
# (BTN's 82-hand opening chart vs BB's 85-hand defend chart, 100bb) took
# 10.3s on ordinary dev hardware and produced ~42,000 distinct info sets --
# chance-sampling keeps per-iteration *tree-walk* cost constant regardless
# of range width (exactly one combo per player is sampled either way), but
# a wider range does mean more distinct (combo, history) dictionary
# entries to allocate and update, which is real CPython overhead at this
# scale. 4,000 trades some of that precision (fewer visits per hand) for
# roughly half the wall-clock time; if a production deploy is still slow
# well beyond what that implies, suspect the host's CPU allocation before
# the algorithm -- see the elapsed-time log below for real numbers.
DEFAULT_ITERATIONS = 4_000

# Fixed rather than random so identical requests reproduce identical
# output -- there's no reason for a solve to be nondeterministic from the
# caller's point of view.
_SEED = 0


class InvalidSolveRequest(ValueError):
    """A well-formed Spot that this route still can't solve -- the route
    turns this into a 422 with the message as the detail."""


def build_solve_config(spot: Spot) -> tuple[PostflopSpotConfig, int]:
    """Validates and maps a Spot into a PostflopSpotConfig, returning it
    alongside the index (0 or 1) of whichever player actually has the
    decision once prior_history is accounted for."""
    if len(spot.positions_in_hand) != 2:
        raise InvalidSolveRequest(
            "positions_in_hand must have exactly 2 entries for a solve "
            f"(got {len(spot.positions_in_hand)}) -- index 0 is "
            "out-of-position/first-to-act, index 1 is in position."
        )
    if len(spot.board) not in (3, 4, 5):
        raise InvalidSolveRequest(
            f"board must have 3 (flop), 4 (turn), or 5 (river) cards, got {len(spot.board)}."
        )
    if spot.pot_bb is None:
        raise InvalidSolveRequest("pot_bb is required to solve a spot.")

    try:
        board = tuple(parse_card(c) for c in spot.board)
    except ValueError as e:
        raise InvalidSolveRequest(f"board contains an invalid card: {e}") from e

    oop, ip = spot.positions_in_hand
    missing = [p for p in (oop, ip) if p not in spot.ranges]
    if missing:
        raise InvalidSolveRequest(
            f"ranges is missing an entry for: {', '.join(missing)} -- a solve needs both "
            "players' ranges, not just hero's."
        )

    street_actions = [a for a in spot.actions if a.street == spot.current_street]
    if not street_actions:
        first_to_act, prior_history = 0, ()
    elif (
        len(street_actions) == 1
        and street_actions[0].action == ActionType.CHECK
        and street_actions[0].position == oop
    ):
        first_to_act, prior_history = 1, ("check",)
    else:
        raise InvalidSolveRequest(
            "solving mid-street action isn't supported yet -- actions on current_street "
            "must be empty, or exactly one check from positions_in_hand[0]."
        )

    config = PostflopSpotConfig(
        board=board,
        pot_bb=spot.pot_bb,
        effective_stack_bb=spot.effective_stack_bb,
        range0=spot.ranges[oop].root,
        range1=spot.ranges[ip].root,
        first_to_act=first_to_act,
        prior_history=prior_history,
    )
    return config, first_to_act


def solve_spot(spot: Spot, iterations: int = DEFAULT_ITERATIONS) -> dict:
    config, deciding_player = build_solve_config(spot)

    try:
        trainer = PostflopMccfrTrainer(config, seed=_SEED)
        start = time.perf_counter()
        trainer.train(iterations)
        elapsed = time.perf_counter() - start
    except (ValueError, RuntimeError) as e:
        # e.g. WeightedRangeSampler's "no combos left after removing
        # blocked cards", or sample_deal's near-total-overlap RuntimeError
        # -- a request-shape problem, not a server error, so 422 not 500.
        raise InvalidSolveRequest(str(e)) from e

    # Logged, not returned to the client -- this is for diagnosing slow
    # solves from Render's logs (is it the algorithm or the host?), not
    # something the UI needs. node_map size is the real driver of wall
    # time, not range width directly -- see DEFAULT_ITERATIONS's comment.
    logger.info(
        "solved in %.2fs: %d iterations, %d info sets, board=%s",
        elapsed,
        iterations,
        len(trainer.node_map),
        spot.board,
    )

    deciding_range = config.range0 if deciding_player == 0 else config.range1
    strategy = aggregate_label_strategies(
        trainer, config.board, deciding_player, deciding_range, config.prior_history
    )
    return {
        "source": "live_solve",
        "iterations": iterations,
        "position": spot.positions_in_hand[deciding_player],
        "strategy": strategy,
    }
