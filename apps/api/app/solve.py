"""Stage 5 endpoint's business logic: turn a submitted Spot into a real
MCCFR solve (services/solver) and shape the response. Kept separate from
routes/spots.py's wiring, same split as reference_charts.py.

Spot.positions_in_hand/ranges are only ever populated with ONE entry by
every entry path shipped so far (apps/web/src/lib/spot.ts) -- a solve
needs two. This introduces that convention explicitly (no schema change,
Spot already allows it): positions_in_hand must have exactly two entries,
index 0 is out-of-position / first-to-act this street, index 1 is in
position, and ranges must have an entry for both.

A solve can now start from any point on the current street, not just an
untouched one: current_street's actions are replayed in order through
betting_round.py's BettingRoundState (already a pure state machine), and
accepted as long as the replayed sequence isn't already terminal (fold,
or the street's action closed -- nothing left to solve there). check/
call/fold map onto the engine's own labels directly; a bet/raise/all_in
is bucketed onto BET_SIZE_MENU's fixed sizes by nearest distance (as a
fraction of the pot right before that action), or forced to "all_in" if
it's within float tolerance of the acting player's remaining stack --
lossy, and disclosed in the response's "bucketed" list rather than
silently approximated. An action out of turn, or one that isn't legal at
that point, is rejected (422) rather than guessed at.
"""

from __future__ import annotations

import logging
import time

from poker_solver.betting_round import BET_SIZE_MENU, BettingRoundState
from poker_solver.cards import parse_card
from poker_solver.range_cfr import RangeCfrTrainer, RangeSpotConfig

from poker_solver_schema import ActionType, BettingAction, Spot

_EPS = 1e-9

logger = logging.getLogger(__name__)

# A solve runs until it's provably close to equilibrium, not for a fixed
# iteration count: exploitability (how much a perfect opponent could gain
# against the result) is checked every 25 iterations, and training stops
# once it's under TARGET_EXPLOITABILITY_PCT of the pot -- a standard
# precision target for postflop solvers. Measured locally with BB's
# defend range vs BTN's open range: a deep 4bb-pot flop needed 175
# iterations (~12s), a two-tone flop 100 (~8s), a turn 125 (~4s), a river
# 100 (~2s). MAX_ITERATIONS leaves headroom over the worst of those while
# keeping a worst-case solve on the slow deployed host under the app's
# 150s client timeout (apps/web/src/lib/api.ts). Iteration-based, not
# wall-clock-based, so the same request reproduces the same answer on any
# machine. The exploitability actually reached is returned to the client
# -- an honest precision number instead of an implied one.
TARGET_EXPLOITABILITY_PCT = 0.5
MAX_ITERATIONS = 250


class InvalidSolveRequest(ValueError):
    """A well-formed Spot that this route still can't solve -- the route
    turns this into a 422 with the message as the detail."""


def _bucket_bet_action(action: BettingAction, pot_before_bb: float, remaining_bb: float) -> str:
    """Maps a recorded bet/raise/all_in to the nearest of
    BET_SIZE_MENU's fixed sizes, given the pot and the acting player's
    remaining stack right before this action. This is the lossy part: a
    real $47-into-$100 bet becomes whichever of bet_small/bet_medium/
    bet_large/all_in is numerically closest, not reproduced exactly --
    callers should surface which actions got bucketed and to what,
    rather than hiding the approximation."""
    if action.action == ActionType.ALL_IN:
        return "all_in"
    if action.size_bb is not None:
        amount = action.size_bb
    elif action.size_pct_pot is not None:
        amount = action.size_pct_pot * pot_before_bb
    else:
        raise InvalidSolveRequest(
            f"{action.position.value}'s {action.action.value} on {action.street.value} needs "
            "size_bb or size_pct_pot to seed a solve."
        )
    if amount >= remaining_bb - _EPS:
        return "all_in"
    frac = amount / pot_before_bb if pot_before_bb > _EPS else float("inf")
    return min(BET_SIZE_MENU, key=lambda item: abs(item[0] - frac))[1]


_DIRECT_LABELS = {
    ActionType.CHECK: "check",
    ActionType.CALL: "call",
    ActionType.FOLD: "fold",
}

_MENU_PCT_BY_LABEL = {label: f"{int(frac * 100)}%" for frac, label in BET_SIZE_MENU} | {
    "all_in": "all-in"
}


def _replay_street_actions(
    street_actions: list[BettingAction], oop: str, pot_bb: float, effective_stack_bb: float
) -> tuple[int, tuple[str, ...], list[str]]:
    """Replays a street's recorded actions through BettingRoundState in
    order, returning the resulting (first_to_act, prior_history) for the
    solve plus a list of human-readable notes on any size that got
    bucketed. Raises InvalidSolveRequest if an action is out of turn,
    illegal at that point, size-less, or if the sequence is already
    terminal (nothing left to solve)."""
    state = BettingRoundState.initial(pot_bb, effective_stack_bb, first_to_act=0)
    notes: list[str] = []
    for action in street_actions:
        acting_player = 0 if action.position == oop else 1
        if acting_player != state.to_act:
            raise InvalidSolveRequest(
                f"{action.position.value}'s {action.action.value} on {action.street.value} is "
                "out of turn for that street's action so far."
            )
        if action.action in _DIRECT_LABELS:
            label = _DIRECT_LABELS[action.action]
        else:
            pot_before = state.pot_bb + state.contributed[0] + state.contributed[1]
            remaining = state.stack_bb - state.contributed[state.to_act]
            label = _bucket_bet_action(action, pot_before, remaining)
            # Only bet/raise genuinely gets *approximated* onto the fixed
            # menu -- an explicit all_in action maps onto the engine's
            # "all_in" exactly, nothing to disclose.
            if action.action != ActionType.ALL_IN:
                readable_size = (
                    f"{action.size_bb}bb"
                    if action.size_bb is not None
                    else f"{action.size_pct_pot * 100:.0f}% pot"
                )
                notes.append(
                    f"{action.position.value}'s {readable_size} {action.action.value} -> "
                    f"bucketed to {_MENU_PCT_BY_LABEL[label]} pot ({label})"
                )
        if label not in state.legal_actions():
            raise InvalidSolveRequest(
                f"{action.position.value}'s {action.action.value} on {action.street.value} "
                f"(bucketed to '{label}') isn't legal at that point."
            )
        state = state.apply(label)
    if state.is_terminal():
        raise InvalidSolveRequest(
            "that action sequence already ends the hand -- there's no decision left to solve."
        )
    return state.to_act, state.history, notes


def build_solve_config(spot: Spot) -> tuple[RangeSpotConfig, int, list[str]]:
    """Validates and maps a Spot into a RangeSpotConfig, returning it
    alongside the index (0 or 1) of whichever player actually has the
    decision once prior_history is accounted for, and any bucketing
    notes from seeding a bet/raise (see _replay_street_actions)."""
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
    first_to_act, prior_history, bucket_notes = _replay_street_actions(
        street_actions, oop, spot.pot_bb, spot.effective_stack_bb
    )

    config = RangeSpotConfig(
        board=board,
        pot_bb=spot.pot_bb,
        effective_stack_bb=spot.effective_stack_bb,
        range0=spot.ranges[oop].root,
        range1=spot.ranges[ip].root,
        first_to_act=first_to_act,
        prior_history=prior_history,
    )
    return config, first_to_act, bucket_notes


def solve_spot(
    spot: Spot,
    target_exploitability_pct: float = TARGET_EXPLOITABILITY_PCT,
    max_iterations: int = MAX_ITERATIONS,
) -> dict:
    config, deciding_player, bucket_notes = build_solve_config(spot)

    try:
        start = time.perf_counter()
        trainer = RangeCfrTrainer(config)
        setup_elapsed = time.perf_counter() - start
        exploitability_pct = trainer.train_until(target_exploitability_pct, max_iterations)
        elapsed = time.perf_counter() - start
    except ValueError as e:
        # e.g. "range has no combos left after removing blocked cards", or
        # every combo pair sharing a card -- a request-shape problem, not
        # a server error, so 422 not 500.
        raise InvalidSolveRequest(str(e)) from e

    # Logged for diagnosing slow solves from Render's logs (is it the
    # algorithm or the host?) -- setup is the equity matrix, the rest is
    # training.
    logger.info(
        "solved in %.2fs (setup %.2fs): %d iterations, exploitability %.2f%% of pot, "
        "%dx%d combos, board=%s",
        elapsed,
        setup_elapsed,
        trainer.iterations,
        exploitability_pct,
        len(trainer.combos[0]),
        len(trainer.combos[1]),
        spot.board,
    )

    return {
        "source": "live_solve",
        "iterations": trainer.iterations,
        "exploitability_pct": exploitability_pct,
        "position": spot.positions_in_hand[deciding_player],
        "strategy": trainer.label_strategies(),
        "bucketed_actions": bucket_notes,
    }
