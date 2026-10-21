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
is bucketed onto the menu's sizes (BET_SIZE_MENU by default, or the
spot's own bet_menu) by nearest distance (as a
fraction of the pot right before that action), or forced to "all_in" if
it's within float tolerance of the acting player's remaining stack --
lossy, and disclosed in the response's "bucketed" list rather than
silently approximated. An action out of turn, or one that isn't legal at
that point, is rejected (422) rather than guessed at.
"""

from __future__ import annotations

import logging
import threading
import time

from poker_solver.betting_round import DEFAULT_BET_MENU, BetMenu, BettingRoundState
from poker_solver.cards import card_str, parse_card
from poker_solver.range_cfr import (
    RangeCfrTrainer,
    RangeSpotConfig,
    RiverSpec,
    estimate_joint_size,
)

from poker_solver_schema import ActionType, BettingAction, Spot

from .hand_notes import hand_notes

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

# The deployed host (Render free tier: 0.1 CPU) can be far slower than a
# laptop, and the phone gives up after 150s (apps/web/src/lib/api.ts's
# readTimeout). Rather than run past that and return nothing, training
# stops at this many seconds into the solve and returns what it has --
# with exploitability_pct and converged=False saying honestly that it's
# less precise than usual. Leaves headroom under 150s for setup that runs
# before the deadline is checked (the equity matrix) and the network.
MAX_SOLVE_SECONDS = 100.0

# A joint (turn + river) solve is a far bigger game than one street: every turn line
# that closes, times every river card, times the river's betting. So it is sized
# BEFORE anything is built, and refused if it wouldn't fit -- a clear 422 beats the
# host running out of memory mid-solve. The budget leaves room under Render's
# 512 MB for the equity matrices and Python itself; measured estimates are in
# docs/decisions.md. JOINT_DEFAULT_CARDS is how many river cards stand in for all of
# them when the request doesn't say (12 is within ~2 points of the exact answer on
# the spot it was measured on).
JOINT_MEMORY_BUDGET_BYTES = 350 * 1024 * 1024
JOINT_DEFAULT_CARDS = 12

# One solve at a time. On a 0.1-CPU host, concurrent solves don't run in
# parallel -- they split the CPU and ALL get slower, and a request the
# phone already gave up on keeps computing anyway. A second request while
# one is running gets an immediate "busy" (503) instead of piling on.
_solve_lock = threading.Lock()


class SolverBusy(RuntimeError):
    """Another solve is already running -- the route turns this into a 503."""


class _NotesUnavailable(Exception):
    """Internal: this solve's menu isn't one the hand notes understand."""


class InvalidSolveRequest(ValueError):
    """A well-formed Spot that this route still can't solve -- the route
    turns this into a 422 with the message as the detail."""


def _menu_from_spot(spot: Spot) -> BetMenu:
    """The bet menu a Spot asks for: its own `bet_menu`, else the default.
    The solver's BetMenu does the real validation (sizes ascending and 1%
    apart, within limits); a bad menu is a 422 with that message."""
    if spot.bet_menu is None:
        return DEFAULT_BET_MENU
    try:
        return BetMenu(
            sizes=tuple(spot.bet_menu.sizes),
            max_aggressive_actions=spot.bet_menu.max_aggressive_actions,
        )
    except ValueError as e:
        raise InvalidSolveRequest(f"bet_menu: {e}") from e


def _river_from_spot(spot: Spot) -> RiverSpec | None:
    """The joint-solve request on a Spot, as the solver's RiverSpec, or None for
    an ordinary single-street solve. Needs a turn board."""
    if spot.river is None:
        return None
    if len(spot.board) != 4:
        raise InvalidSolveRequest(
            "a joint turn+river solve needs a turn board (4 cards), "
            f"got {len(spot.board)}."
        )
    menu = spot.river.bet_menu
    if menu is not None:
        try:
            menu = BetMenu(sizes=tuple(menu.sizes), max_aggressive_actions=menu.max_aggressive_actions)
        except ValueError as e:
            raise InvalidSolveRequest(f"river.bet_menu: {e}") from e
    return RiverSpec(bet_menu=menu, cards=spot.river.cards or JOINT_DEFAULT_CARDS)


def _check_joint_fits(config: RangeSpotConfig) -> None:
    """Refuse a joint solve that would not fit in memory, saying what it would
    take and what to shrink."""
    try:
        size = estimate_joint_size(config)
    except ValueError as e:
        raise InvalidSolveRequest(str(e)) from e
    if size.bytes > JOINT_MEMORY_BUDGET_BYTES:
        raise InvalidSolveRequest(
            f"this joint turn+river solve is too big for the server: the turn has "
            f"{size.chance_nodes} lines that close, each dealing {size.cards} river cards with "
            f"their own betting -- {size.decisions:,} decision nodes, about "
            f"{size.bytes / 1024 / 1024:.0f} MB (the limit is "
            f"{JOINT_MEMORY_BUDGET_BYTES / 1024 / 1024:.0f} MB). Use fewer river cards, a smaller "
            f"river bet menu (or null for no river betting), or a smaller turn bet menu "
            f"(fewer sizes or a lower raise cap)."
        )


def _bucket_bet_action(
    action: BettingAction,
    pot_before_bb: float,
    remaining_bb: float,
    menu: BetMenu = DEFAULT_BET_MENU,
) -> str:
    """Maps a recorded bet/raise/all_in to the nearest of the menu's sizes
    (the default 25/75/125% unless the spot has its own bet_menu), given the
    pot and the acting player's remaining stack right before this action.
    This is the lossy part: a real $47-into-$100 bet becomes whichever of
    the menu's sizes (or all_in) is numerically closest, not reproduced
    exactly -- callers should surface which actions got bucketed and to
    what, rather than hiding the approximation."""
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
    return min(menu.labelled_sizes, key=lambda item: abs(item[0] - frac))[1]


_DIRECT_LABELS = {
    ActionType.CHECK: "check",
    ActionType.CALL: "call",
    ActionType.FOLD: "fold",
}

def _pct_by_label(menu: BetMenu) -> dict[str, str]:
    """Action name -> how a note should say its size ("25%", "all-in")."""
    return {label: f"{round(frac * 100)}%" for frac, label in menu.labelled_sizes} | {
        "all_in": "all-in"
    }


def _replay_street_actions(
    street_actions: list[BettingAction],
    oop: str,
    pot_bb: float,
    effective_stack_bb: float,
    allow_terminal: bool = False,
    menu: BetMenu = DEFAULT_BET_MENU,
) -> tuple[int, tuple[str, ...], list[str]]:
    """Replays a street's recorded actions through BettingRoundState in
    order, returning the resulting (first_to_act, prior_history) for the
    solve plus a list of human-readable notes on any size that got
    bucketed. Raises InvalidSolveRequest if an action is out of turn,
    illegal at that point, size-less, or if the sequence is already
    terminal (nothing left to solve) -- unless allow_terminal, which
    range narrowing uses: a street that has closed (bet + call, check +
    check) is exactly what it wants to narrow on. A fold still ends the
    hand, so it's rejected either way."""
    state = BettingRoundState.initial(pot_bb, effective_stack_bb, first_to_act=0, menu=menu)
    pct_by_label = _pct_by_label(menu)
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
            label = _bucket_bet_action(action, pot_before, remaining, menu)
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
                    f"bucketed to {pct_by_label[label]} pot ({label})"
                )
        if label not in state.legal_actions():
            raise InvalidSolveRequest(
                f"{action.position.value}'s {action.action.value} on {action.street.value} "
                f"(bucketed to '{label}') isn't legal at that point."
            )
        state = state.apply(label)
    if state.is_terminal() and not (allow_terminal and state.history[-1] != "fold"):
        raise InvalidSolveRequest(
            "that action sequence already ends the hand -- there's no decision left to solve."
        )
    return state.to_act, state.history, notes


def build_solve_config(
    spot: Spot, allow_terminal_actions: bool = False
) -> tuple[RangeSpotConfig, int, list[str]]:
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

    menu = _menu_from_spot(spot)
    street_actions = [a for a in spot.actions if a.street == spot.current_street]
    first_to_act, prior_history, bucket_notes = _replay_street_actions(
        street_actions, oop, spot.pot_bb, spot.effective_stack_bb, allow_terminal_actions, menu
    )

    config = RangeSpotConfig(
        board=board,
        pot_bb=spot.pot_bb,
        effective_stack_bb=spot.effective_stack_bb,
        range0=spot.ranges[oop].root,
        range1=spot.ranges[ip].root,
        first_to_act=first_to_act,
        prior_history=prior_history,
        bet_menu=menu,
        river=_river_from_spot(spot),
    )
    if config.river is not None:
        _check_joint_fits(config)
    return config, first_to_act, bucket_notes


def solve_spot(
    spot: Spot,
    target_exploitability_pct: float = TARGET_EXPLOITABILITY_PCT,
    max_iterations: int = MAX_ITERATIONS,
    max_seconds: float = MAX_SOLVE_SECONDS,
) -> dict:
    # Validate before taking the lock -- a malformed request shouldn't make
    # anyone else wait, or be told "busy" when it's really invalid.
    config, deciding_player, bucket_notes = build_solve_config(spot)

    if not _solve_lock.acquire(blocking=False):
        raise SolverBusy("Another solve is already running -- try again in a minute.")
    try:
        start = time.perf_counter()
        trainer = RangeCfrTrainer(config)
        setup_elapsed = time.perf_counter() - start
        exploitability_pct = trainer.train_until(
            target_exploitability_pct, max_iterations, deadline=start + max_seconds
        )
        elapsed = time.perf_counter() - start
    except ValueError as e:
        # e.g. "range has no combos left after removing blocked cards", or
        # every combo pair sharing a card -- a request-shape problem, not
        # a server error, so 422 not 500.
        raise InvalidSolveRequest(str(e)) from e
    finally:
        _solve_lock.release()

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

    strategy = trainer.label_strategies()
    hero = spot.positions_in_hand[deciding_player]
    villain = spot.positions_in_hand[1 - deciding_player]
    try:
        if config.river is not None or not config.bet_menu.is_default:
            # The notes' rules and bet-size arithmetic are written against the
            # default menu's action names (and, for a joint solve, against one
            # street's equity matrix); such a solve gets the strategy without
            # them rather than notes about the wrong game.
            raise _NotesUnavailable
        # .value: the bullets are prose, and str() of a Position is "Position.BTN".
        categories, reasons = hand_notes(
            trainer, config.board, config.pot_bb, deciding_player, hero.value, villain.value, strategy,
            config.prior_history,
        )
    except _NotesUnavailable:
        categories, reasons = {}, {}
    except Exception:  # noqa: BLE001 -- extras; never fail a finished solve over them
        logger.exception("hand notes failed; returning the solve without them")
        categories, reasons = {}, {}

    return {
        "source": "live_solve",
        "iterations": trainer.iterations,
        "exploitability_pct": exploitability_pct,
        # False when MAX_SOLVE_SECONDS or MAX_ITERATIONS cut training off
        # before the precision target -- the UI says so rather than
        # presenting a rougher answer as a fully converged one.
        "converged": exploitability_pct < target_exploitability_pct,
        "position": hero,
        "strategy": strategy,
        # Per-suit strategies for hand types whose combos play differently
        # (flush draws, blockers); every other hand type is in "strategy"
        # alone. Keyed by specific combo ('AhKh').
        "combo_strategy": trainer.combo_strategies(),
        "bucketed_actions": bucket_notes,
        # Flop only (see hand_notes.py), else empty: each hand type's
        # category ("Top pair, strong kicker") and the Drill's rule-of-thumb
        # "why" bullets. Optional for clients -- an older backend omits them.
        "hand_categories": categories,
        "hand_reasons": reasons,
        # The menu this solve used, so a client can name and order the actions
        # in "strategy": each bet action's size as a fraction of the pot.
        "bet_menu": {
            "is_default": config.bet_menu.is_default,
            "sizes": {label: frac for frac, label in config.bet_menu.labelled_sizes},
            "max_aggressive_actions": config.bet_menu.max_aggressive_actions,
        },
        # Present only for a joint solve: exactly what the river was solved with, so
        # the answer can be read for what it is (an approximation when `exact` is
        # false: `river_cards` stand in for all `river_cards_total`).
        "joint": _joint_summary(config, trainer) if config.river is not None else None,
    }


def _joint_summary(config: RangeSpotConfig, trainer: RangeCfrTrainer) -> dict:
    menu = config.river.bet_menu
    cards = trainer.river_cards
    return {
        "river_cards": [card_str(c) for c in cards],
        "river_cards_total": 52 - len(config.board),
        "exact": len(cards) == 52 - len(config.board),
        "river_bet_menu": (
            None
            if menu is None
            else {
                "sizes": {label: frac for frac, label in menu.labelled_sizes},
                "max_aggressive_actions": menu.max_aggressive_actions,
            }
        ),
        "closing_turn_lines": len(trainer._chances),
    }


# A narrowed range has a long tail of hands the line almost never involved
# (a combo at 0.3% of the heaviest one's weight). They barely move anyone's
# strategy but make the range look far wider than it is, clutter the result
# with hands that are effectively not there, and cost solve time -- the tail
# multiplies when streets are chained. So a narrowed range drops every hand
# under this share of its own heaviest hand's weight. Relative, not absolute:
# narrowed weights aren't normalized (a rare line scales a whole range down).
TRIM_BELOW_FRACTION_OF_MAX = 0.02


def _combo_count(key: str) -> int:
    """How many concrete combos a range key stands for (board blocking
    ignored -- close enough for a share-of-weight report)."""
    if len(key) == 4:
        return 1
    if len(key) == 2:
        return 6
    return 4 if key.endswith("s") else 12


def _trim_tail(weights: dict[str, float]) -> tuple[dict[str, float], dict]:
    """Drops entries under TRIM_BELOW_FRACTION_OF_MAX of the heaviest one.
    Returns (kept, {"dropped_entries": n, "dropped_weight_pct": share of the
    range's total combo-weighted mass removed})."""
    if not weights:
        return {}, {"dropped_entries": 0, "dropped_weight_pct": 0.0}
    cutoff = TRIM_BELOW_FRACTION_OF_MAX * max(weights.values())
    kept = {k: w for k, w in weights.items() if w >= max(cutoff, 1e-12)}
    mass = lambda ws: sum(w * _combo_count(k) for k, w in ws.items())  # noqa: E731
    total = mass(weights)
    dropped = {k: w for k, w in weights.items() if k not in kept}
    return kept, {
        "dropped_entries": len(dropped),
        "dropped_weight_pct": 100 * mass(dropped) / total if total > 0 else 0.0,
    }


def narrow_ranges(
    spot: Spot,
    target_exploitability_pct: float = TARGET_EXPLOITABILITY_PCT,
    max_iterations: int = MAX_ITERATIONS,
    max_seconds: float = MAX_SOLVE_SECONDS,
) -> dict:
    """Range chaining: solves the current street from its START, then
    returns each player's range conditional on the street's recorded
    actions (Spot.actions on current_street, which should be a CLOSED
    street -- e.g. bet + call, or check + check) having been played. The
    caller feeds those ranges into the next street's solve instead of
    asking the user to guess them -- see docs/plan.md.

    Same request contract as solve_spot (two positions, both ranges, a
    3-5 card board, pot_bb); the difference is that the street's actions
    are the line to narrow on, not a prefix to start a solve from.
    Lossy the same way too: sizes are bucketed onto the menu and
    disclosed in "bucketed_actions". The ranges are weights in [0, 1],
    keyed by 169-type label where a hand's suit combos agree and by
    specific combo ('AhKh') where they differ (HandRange's key formats);
    the long tail under 2% of the heaviest hand is trimmed
    (_trim_tail) and reported in "trimmed".
    Costs one full solve of the street."""
    # Narrowing works out who would take this street's line; the river is none
    # of its business, so a joint request is ignored here (not built, not sized).
    config, _, bucket_notes = build_solve_config(
        spot.model_copy(update={"river": None}), allow_terminal_actions=True
    )
    # Solve the whole street, then walk the recorded line through it:
    # build_solve_config seeded the line as prior_history, which a
    # trainer never learns a strategy for, so undo that.
    line = config.prior_history
    config.prior_history = ()
    config.first_to_act = 0

    if not _solve_lock.acquire(blocking=False):
        raise SolverBusy("Another solve is already running -- try again in a minute.")
    try:
        start = time.perf_counter()
        trainer = RangeCfrTrainer(config)
        exploitability_pct = trainer.train_until(
            target_exploitability_pct, max_iterations, deadline=start + max_seconds
        )
        oop_range, ip_range = trainer.posterior_ranges(line)
        oop_probability, ip_probability = trainer.line_probability(line)
    except ValueError as e:
        raise InvalidSolveRequest(str(e)) from e
    finally:
        _solve_lock.release()

    oop, ip = spot.positions_in_hand

    oop_kept, oop_trim = _trim_tail(oop_range)
    ip_kept, ip_trim = _trim_tail(ip_range)

    return {
        "source": "live_solve",
        "iterations": trainer.iterations,
        "exploitability_pct": exploitability_pct,
        "converged": exploitability_pct < target_exploitability_pct,
        "ranges": {oop: oop_kept, ip: ip_kept},
        # What the tail trim removed (see _trim_tail), so it's measured, not
        # hidden: hands dropped and the share of the range's total weight.
        "trimmed": {oop: oop_trim, ip: ip_trim},
        # How likely each player was to take their side of the line at all
        # (posterior mass / prior mass). Near 0 = the equilibrium almost
        # never plays it and the ranges above are numerical noise.
        "line_probability": {oop: oop_probability, ip: ip_probability},
        "bucketed_actions": bucket_notes,
    }
