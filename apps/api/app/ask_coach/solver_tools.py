"""The Coach's solver tools (docs/coach.md §4.2-4.3, Phase 3): the app's preflop
charts and the live postflop solver, called on the conversation's current spot.

Everything here returns numbers from the charts or the solver and nothing else:
the cards are built from them, and the model only gets to explain them.

The current spot is a spot card's payload (spot_builder.py): its Spot is
encoded the way Solve saves a clicked-through hand (effective_stack_bb is the
STARTING stack, every street's actions, pot_bb entering the current street).
A pasted hand history's spot has no preflop actions; there's no preflop line to
take ranges from, so it can't be solved here yet.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from poker_solver.betting_round import BettingRoundState
from poker_solver_schema import BettingAction, Position, Spot

from ..preflop_ranges import (
    PAIR_RANGES,
    InvalidPreflopLine,
    UnsupportedPreflopLine,
    call_vs_3bet_range,
    flat_range,
    four_bet_range,
    ranges_for_preflop_line,
    three_bet_range,
)
from ..reference_charts import _resolve_stack_bucket, find_matching_chart
from ..solve import InvalidSolveRequest, SolverBusy, build_solve_config, narrow_ranges, solve_spot
from . import spot_builder as sb

log = logging.getLogger("ask_coach")

# The solver runs one solve at a time (solve.py's SolverBusy). A turn waits for it.
WAIT_FOR_SOLVER_S = 180.0
RETRY_EVERY_S = 5.0
# A line the equilibrium plays this rarely leaves no reliable range to narrow to
# (the same threshold as the Solve page, lib/chaining.ts's MIN_LINE_PROBABILITY).
MIN_LINE_PROBABILITY = 0.1
# Rows under this are left off a card (they'd show as 0%).
MIN_ROW_FREQ = 0.005

CHART_NOTE = "From the app's reference charts (approximate, built from standard principles), not a solver run."
SOLVER_NOTE = "The percentages come from the solver. The explanation is standard strategy reasoning."

# Tests replace these so waiting for the solver takes no real time.
_sleep: Callable[[float], None] = time.sleep
_clock: Callable[[], float] = time.monotonic


class SolverStillBusy(Exception):
    """The solver stayed busy for WAIT_FOR_SOLVER_S: the turn ends with a `solver_busy` error."""


@dataclass
class Outcome:
    """What a tool returns to the model, and the card to store (if any)."""

    result: dict
    card_kind: str | None = None
    card: dict | None = None
    notes: list[str] = field(default_factory=list)


def _fail(reason: str) -> Outcome:
    return Outcome({"ok": False, "reason": reason})


def _pct(freq: float) -> int:
    return round(100 * freq)


def _streets(spot: Spot) -> dict[str, list[sb.Act]]:
    streets: dict[str, list[sb.Act]] = {s: [] for s in sb.STREET_ORDER}
    for a in spot.actions:
        streets[a.street.value].append(sb.Act(a.position.value, a.action.value, a.size_bb))
    return streets


def _actions(street: str, acts: list[sb.Act]) -> list[BettingAction]:
    return [BettingAction(position=a.position, street=street, action=a.action, size_bb=a.to_bb) for a in acts]


# --- get_preflop_strategy --------------------------------------------------------------------


def preflop_strategy(current: dict | None) -> Outcome:
    """The hero hand's preflop play from the reference charts: open/fold
    unopened, 3-bet/call/fold facing an open, 4-bet/call/fold facing a 3-bet."""
    if not current:
        return _fail("No spot yet: call describe_spot first.")
    spot = Spot.model_validate(current["spot"])
    if spot.current_street.value != "preflop":
        return _fail("This spot has a board. Use solve_current_spot.")
    hand = current.get("hero_hand")
    if not hand:
        return _fail("I need the user's hand. Ask which two cards they have.")
    label = sb.hand_type(hand) if len(hand) == 4 else hand
    hero = current["hero_position"]
    villain = next(p.value for p in spot.positions_in_hand if p.value != hero)
    stack = spot.effective_stack_bb
    acts = [a for a in spot.actions if a.street.value == "preflop"]
    deep_100 = _resolve_stack_bucket(stack) == "100bb"

    if not acts:
        chart = find_matching_chart(Spot(positions_in_hand=[hero], effective_stack_bb=stack))
        if chart is None:
            return _fail(f"There's no opening chart for {hero} at {sb.fmt_bb(stack)} yet.")
        w = next(iter(chart.ranges.values())).get(label, 0.0)
        rows = [("raise", "Raise", w), ("fold", "Fold", 1 - w)]
        situation, description = f"Folded to you in the {sb.POSITION_WORDS.get(hero, hero)}", chart.description
    elif len(acts) == 1 and acts[0].position.value == villain and acts[0].action.value == "raise":
        pair = _pair(villain, hero)
        situation = f"Facing a {sb.fmt_bb(acts[0].size_bb or 0)} open from {villain}"
        if pair and deep_100:
            t, c = three_bet_range(*pair).get(label, 0.0), flat_range(*pair).get(label, 0.0)
            rows = [("three_bet", "3-bet", t), ("call", "Call", c), ("fold", "Fold", max(0.0, 1 - t - c))]
            description = f"{hero} facing a {villain} open, ~100bb (3-bet and call ranges)"
        else:
            chart = find_matching_chart(
                Spot(positions_in_hand=[hero], effective_stack_bb=stack, actions=[acts[0]])
            )
            if chart is None:
                return _fail(f"There's no chart for {hero} facing a {villain} open at {sb.fmt_bb(stack)} yet.")
            w = next(iter(chart.ranges.values())).get(label, 0.0)
            rows = [("continue", "Call or 3-bet", w), ("fold", "Fold", 1 - w)]
            description = chart.description
    elif (
        len(acts) == 2
        and acts[0].position.value == hero
        and acts[1].position.value == villain
        and acts[1].action.value == "raise"
    ):
        pair = _pair(hero, villain)
        if not (pair and deep_100):
            return _fail(f"There's no chart for {hero} facing a 3-bet from {villain} at {sb.fmt_bb(stack)} yet.")
        f, c = four_bet_range(*pair).get(label, 0.0), call_vs_3bet_range(*pair).get(label, 0.0)
        rows = [("four_bet", "4-bet", f), ("call", "Call", c), ("fold", "Fold", max(0.0, 1 - f - c))]
        situation = f"Facing a {sb.fmt_bb(acts[1].size_bb or 0)} 3-bet from {villain}"
        description = f"{hero} opened and faces a {villain} 3-bet, ~100bb (4-bet and call ranges)"
    else:
        return _fail("The charts only cover an unopened pot, facing an open, or facing a 3-bet.")

    shown = [{"action": a, "label": lbl, "freq": round(f, 4)} for a, lbl, f in rows if f >= MIN_ROW_FREQ]
    card = {
        "hero_hand": hand,
        "position": hero,
        "situation": situation,
        "rows": shown,
        "source": description,
        "note": CHART_NOTE,
    }
    result = {
        "ok": True,
        "hand_type": label,
        "rows": [{"play": r["label"], "percent": _pct(r["freq"])} for r in shown],
        "chart_description": description,
        "source_note": CHART_NOTE,
    }
    return Outcome(result, "preflop_card", card)


def _pair(opener: str, defender: str):
    key = (Position(opener), Position(defender))
    return key if key in PAIR_RANGES else None


# --- solve_current_spot ----------------------------------------------------------------------


@dataclass
class SolveHooks:
    """How solve_current_spot reports progress: store the solving card, and keep
    the conversation's status (and its updated_at, so a long solve isn't taken
    for a lost turn) current."""

    store_card: Callable[[str, dict], None]
    set_status: Callable[[str], None]


def solve_current(current: dict | None, hooks: SolveHooks) -> Outcome:
    if not current:
        return _fail("No spot yet: call describe_spot first.")
    spot = Spot.model_validate(current["spot"])
    if len(spot.board) < 3:
        return _fail("This spot has no board yet. Use get_preflop_strategy, or ask for the flop.")
    streets = _streets(spot)
    if not streets["preflop"]:
        return _fail(
            "This spot came from a hand history without its preflop betting, so I don't know which "
            "ranges to give each player. Describe how the preflop went and I can solve it."
        )

    hero = current["hero_position"]
    oop, ip = (p.value for p in spot.positions_in_hand)
    start_stack = spot.effective_stack_bb
    target = spot.current_street.value
    target_summary = sb.summarize_hand(oop, ip, start_stack, streets, len(spot.board))
    to_act = target_summary.target_state.to_act
    hooks.store_card(
        "solving", {"street": target, "player": to_act, "started_at": time.time()}
    )

    # 1. Both ranges from the preflop line.
    try:
        preflop = ranges_for_preflop_line(
            Spot(
                positions_in_hand=[oop, ip],
                effective_stack_bb=start_stack,
                actions=_actions("preflop", streets["preflop"]),
            )
        )
    except (UnsupportedPreflopLine, InvalidPreflopLine) as e:
        return _fail(f"I don't have ranges for that preflop line: {e}")
    ranges = {p.value if hasattr(p, "value") else str(p): dict(r) for p, r in preflop["ranges"].items()}

    # 2. Narrow them through each earlier postflop street, as the Solve page does.
    notes: list[str] = []
    narrowed: list[str] = []
    for street in [s for s in ("flop", "turn") if sb.STREET_ORDER.index(s) < sb.STREET_ORDER.index(target)]:
        n = {"flop": 3, "turn": 4}[street]
        summary = sb.summarize_hand(oop, ip, start_stack, streets, n)
        request = Spot(
            positions_in_hand=[oop, ip],
            effective_stack_bb=summary.effective_stack_bb,
            pot_bb=summary.pot_bb,
            board=spot.board[:n],
            current_street=street,
            actions=_actions(street, streets[street]),
            ranges=ranges,
        )
        hooks.set_status("working")
        try:
            out = _with_solver(narrow_ranges, request, hooks)
        except InvalidSolveRequest as e:
            return _fail(f"I couldn't narrow the ranges by the {street} action: {e}")
        ranges = {p.value if hasattr(p, "value") else str(p): r for p, r in out["ranges"].items()}
        narrowed.append(street)
        for seat, prob in out["line_probability"].items():
            seat = seat.value if hasattr(seat, "value") else str(seat)
            if prob < MIN_LINE_PROBABILITY:
                whose_line = "your" if seat == hero else f"{seat}'s"
                notes.append(
                    f"The solver rarely plays {whose_line} {street} action ({_pct(prob)}% of the time), "
                    "so the ranges after it are rough."
                )

    # 3. Solve the current street.
    request = Spot(
        positions_in_hand=[oop, ip],
        effective_stack_bb=target_summary.effective_stack_bb,
        pot_bb=target_summary.pot_bb,
        board=spot.board,
        current_street=target,
        actions=_actions(target, streets[target]),
        ranges=ranges,
    )
    hooks.set_status("working")
    started = time.perf_counter()
    try:
        out = _with_solver(solve_spot, request, hooks)
    except InvalidSolveRequest as e:
        return _fail(f"The solver couldn't take this spot: {e}")
    elapsed = time.perf_counter() - started

    player = out["position"].value if hasattr(out["position"], "value") else str(out["position"])
    whose = "hero" if player == hero else "villain"
    deciding_range = ranges.get(player, {})
    labels = _action_labels(request)
    range_mix = _range_mix(out["strategy"], deciding_range)

    hand = current.get("hero_hand") if whose == "hero" else None
    label = (sb.hand_type(hand) if hand and len(hand) == 4 else hand) if hand else None
    mix, in_range = None, True
    if hand:
        mix = _combo_mix(out, hand, label)
        if mix is None:
            in_range = False
            notes.append(
                f"{label} isn't in the range the solver gives you here, so this shows how your "
                "whole range plays instead."
            )
    shown_mix = mix if mix is not None else range_mix
    rows = _rows(shown_mix, labels)

    card = {
        "hero_hand": hand,
        "player": player,
        "whose": whose,
        "rows": rows,
        "range_rows": None if mix is None else _rows(range_mix, labels),
        "exploitability_pct": round(out["exploitability_pct"], 3),
        "converged": bool(out["converged"]),
        "elapsed_s": round(elapsed, 1),
        "bucketed_actions": list(out.get("bucketed_actions") or []),
        "narrowed": narrowed,
        "notes": notes,
    }
    category = out.get("hand_categories", {}).get(label) if label else None
    reasons = out.get("hand_reasons", {}).get(label, []) if label else []
    result = {
        "ok": True,
        "whose_strategy": whose,
        "player": player,
        "hero_mix": None if mix is None else [{"play": r["label"], "percent": _pct(r["freq"])} for r in rows],
        "range_mix": [{"play": r["label"], "percent": _pct(r["freq"])} for r in _rows(range_mix, labels)],
        "category": category,
        "reasons": reasons,
        "exploitability_pct": card["exploitability_pct"],
        "converged": card["converged"],
        "bucketed_actions": card["bucketed_actions"],
        "notes": notes,
    }
    if whose == "villain":
        result["notes"] = notes + [f"It's {player}'s turn, so this is {player}'s strategy, not the user's."]
    if not in_range:
        result["hand_in_range"] = False
    return Outcome(result, "result_card", card, notes)


def _with_solver(fn, request: Spot, hooks: SolveHooks) -> dict:
    """Runs fn(request), waiting for the solver while another solve holds it."""
    deadline = _clock() + WAIT_FOR_SOLVER_S
    waiting = False
    try:
        while True:
            try:
                return fn(request)
            except SolverBusy:
                if _clock() >= deadline:
                    raise SolverStillBusy() from None
                if not waiting:
                    hooks.set_status("waiting_for_solver")
                    waiting = True
                _sleep(RETRY_EVERY_S)
    finally:
        if waiting:
            hooks.set_status("working")


def _combo_mix(out: dict, hand: str, label: str) -> dict[str, float] | None:
    """The user's exact combo's strategy when the solve split it out by suit, else
    its hand type's; None if the hand isn't in the range at all."""
    if len(hand) == 4:
        combos = out.get("combo_strategy") or {}
        for key in (hand, hand[2:] + hand[:2]):
            if key in combos:
                return combos[key]
    return (out.get("strategy") or {}).get(label)


def _combo_count(key: str) -> int:
    if len(key) == 4:
        return 1  # one specific combo
    return 6 if key[0] == key[1] else 4 if key.endswith("s") else 12


def _range_mix(strategy: dict[str, dict[str, float]], deciding_range: dict[str, float]) -> dict[str, float]:
    """How often the whole range takes each action, weighted by each hand's
    weight and number of combos (board blockers ignored: an approximation)."""
    totals: dict[str, float] = {}
    mass = 0.0
    for key, weight in deciding_range.items():
        label = sb.hand_type(key) if len(key) == 4 else key
        mix = strategy.get(label)
        if not mix or weight <= 0:
            continue
        w = weight * _combo_count(key)
        mass += w
        for action, p in mix.items():
            totals[action] = totals.get(action, 0.0) + w * p
    return {a: v / mass for a, v in totals.items()} if mass else {}


def _action_labels(request: Spot) -> dict[str, tuple[str, float | None]]:
    """Each solver action's name with its size in bb ("Bet small (1.38bb)",
    "Raise to 12bb", "Call 3bb").

    The solver's game rounds the hand's real bets onto its menu (a 3bb bet into
    5.5bb plays as its 75% size, 4.12bb; disclosed in `bucketed_actions`). The
    labels use the REAL amounts instead, so the user calls the 3bb they face:
    the state machine's sizing rules are applied to the real contributions,
    with the solver's history only deciding what's legal."""
    config, _, _ = build_solve_config(request)
    solver_state = BettingRoundState.initial(
        config.pot_bb, config.effective_stack_bb, config.first_to_act, config.prior_history, config.bet_menu
    )
    oop, ip = (p.value for p in request.positions_in_hand)
    street = request.current_street.value
    real = sb.compute_street_state(
        sb.StreetContext(oop=oop, ip=ip, pot_before_bb=request.pot_bb or 0.0,
                         stack_before_bb=request.effective_stack_bb, first_to_act=oop),
        [sb.Act(x.position.value, x.action.value, x.size_bb) for x in request.actions if x.street.value == street],
    )
    contributed = tuple(request.effective_stack_bb - real.remaining_bb[seat] for seat in (oop, ip))
    state = BettingRoundState(
        pot_bb=solver_state.pot_bb,
        stack_bb=solver_state.stack_bb,
        contributed=contributed,
        to_act=solver_state.to_act,
        history=solver_state.history,
        num_aggressive_actions=solver_state.num_aggressive_actions,
        menu=solver_state.menu,
    )
    me, other = state.to_act, 1 - state.to_act
    to_call = state.contributed[other] - state.contributed[me]
    out: dict[str, tuple[str, float | None]] = {}
    for action in state.legal_actions():
        if action == "check":
            out[action] = ("Check", None)
        elif action == "fold":
            out[action] = ("Fold", None)
        elif action == "call":
            out[action] = (f"Call {sb.fmt_bb(to_call)}", round(to_call, 2))
        else:
            amount = state.apply(action).contributed[me]
            if action == "all_in":
                out[action] = (f"All-in ({sb.fmt_bb(amount)})", round(amount, 2))
            elif to_call > 0:
                out[action] = (f"Raise to {sb.fmt_bb(amount)}", round(amount, 2))
            else:
                size = action.removeprefix("bet_")
                word = f"{size}%" if size.isdigit() else size
                out[action] = (f"Bet {word} ({sb.fmt_bb(amount)})", round(amount, 2))
    return out


def _rows(mix: dict[str, float], labels: dict[str, tuple[str, float | None]]) -> list[dict]:
    rows = []
    for action, freq in sorted(mix.items(), key=lambda kv: -kv[1]):
        if freq < MIN_ROW_FREQ:
            continue
        label, amount = labels.get(action, (action.replace("_", " ").capitalize(), None))
        row = {"action": action, "label": label, "freq": round(freq, 4)}
        if amount is not None:
            row["amount_bb"] = amount
        rows.append(row)
    return rows
