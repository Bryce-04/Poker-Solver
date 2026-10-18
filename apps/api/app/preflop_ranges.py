"""3-bet and 4-bet preflop ranges, and the logic that turns a preflop line
(open / call, open / 3-bet / call, open / 3-bet / 4-bet / call) into the two
players' ranges for a postflop solve.

Sourcing is the same as reference_charts.py: hand-constructed from widely
taught 6-max principles (value 3-bets from the top of the range, bluffs from
suited aces that block AA/AK and suited connectors, tighter against earlier
positions, wider in position and against the blinds), NOT copied from or
meant to match any solver. Approximate placeholders, labeled as such in the
API response; replace against a real preflop solve when one exists. One
weight per hand (1.0), same as the other charts -- no mixed frequencies yet.

What exists, per (opener, defender) pair already covered by the defend
charts in reference_charts.py, 100bb only:

  open        the opener's open range (reference_charts.py)
  flat        the defender's CALL range vs the open: the defend chart (which
              is the whole continuing range, call + 3-bet) minus the 3-bet
  three_bet   the defender's 3-bet range
  call_vs_3   the opener's call range vs that 3-bet
  four_bet    the opener's 4-bet range vs that 3-bet
  call_vs_4   the defender's call range vs that 4-bet

Invariants the tests enforce, because breaking them means a player is
holding hands they could not have reached this node with: three_bet is a
subset of the defend chart; call_vs_3 and four_bet are subsets of the open
range and don't overlap; call_vs_4 is a subset of three_bet. Hands that 5-bet
jam are simply absent from call_vs_4 (a 5-bet pot isn't covered).
"""

from __future__ import annotations

from dataclasses import dataclass

from poker_solver_schema import ActionType, BettingAction, Position, Spot, Street

from .range_notation import expand_range
from .reference_charts import _DEFEND_CHARTS, REFERENCE_CHARTS, _resolve_stack_bucket

P = Position

_METHODOLOGY = (
    "Approximate 3-bet / 4-bet ranges constructed from general, widely-taught "
    "6-max principles (not from any solver). See preflop_ranges.py."
)


@dataclass(frozen=True)
class PairRanges:
    """One (opener, defender) pair's response ranges, as range notation."""

    three_bet: list[str]
    call_vs_3: list[str]
    four_bet: list[str]
    call_vs_4: list[str]


# The opener's 4-bet range is mostly a function of the opener's seat (it is
# value plus a blocker bluff or two), and its call range of whether the
# 3-bettor is in or out of position, so those are shared below rather than
# retyped nine times.
_FOUR_BET_EARLY = ["KK+", "AKs", "AKo"]  # UTG: no suited-ace bluff in its open range
_FOUR_BET_HJ = ["KK+", "AKs", "AKo", "A5s"]
_FOUR_BET_CO = ["QQ+", "AKs", "AKo", "A5s", "A4s"]
_FOUR_BET_LATE = ["QQ+", "AKs", "AKo", "A5s", "A4s"]  # BTN / SB

_CALL_UTG = ["88", "99", "TT", "JJ", "QQ", "AQs", "AJs", "ATs", "KQs", "JTs", "AQo"]
_CALL_HJ_OOP = [
    "66", "77", "88", "99", "TT", "JJ", "QQ", "AQs", "AJs", "ATs", "A9s",
    "KQs", "KJs", "QJs", "QTs", "JTs", "T9s", "AQo", "ATo", "KQo",
]
_CALL_HJ_IP_3BET = [  # opener is out of position here, so it continues less
    "66", "77", "88", "99", "TT", "JJ", "QQ", "AQs", "AJs", "ATs", "KQs", "KJs", "QJs",
    "JTs", "AQo",
]
_CALL_CO_VS_BB = [
    "44", "55", "66", "77", "88", "99", "TT", "JJ", "AQs", "AJs", "ATs", "A9s",
    "A8s", "KQs", "KJs", "K9s", "QJs", "QTs", "JTs", "J9s", "T9s",
    "98s", "87s", "76s", "AQo", "ATo", "KQo",
]
_CALL_CO_VS_IP = [
    "22", "33", "44", "55", "66", "77", "88", "99", "TT", "JJ", "AQs", "AJs", "ATs", "A9s",
    "KQs", "KJs", "KTs", "QJs", "QTs", "JTs", "T9s", "98s", "AQo", "ATo", "KQo",
]
_CALL_CO_VS_SB = [
    "55", "66", "77", "88", "99", "TT", "JJ", "AQs", "AJs", "ATs", "KQs", "KJs", "QJs",
    "JTs", "AQo", "ATo", "KQo",
]
# In position (or close to it) against a 3-bet the opener continues widely:
# every pair, the suited aces that aren't 4-bet bluffs, suited broadways and
# connectors, and the stronger offsuit broadways.
_BTN_CALL_EXTRA = [
    "22", "33", "44", "A6s", "A3s", "A2s", "K8s", "K7s", "Q9s", "T8s", "97s",
    "86s", "75s", "65s", "54s", "ATo", "KJo", "KTo",
]
_CALL_BTN = [
    "55", "66", "77", "88", "99", "TT", "JJ", "AQs", "AJs", "ATs", "A9s", "A8s", "A7s",
    "KQs", "KJs", "KTs", "K9s", "QJs", "QTs", "JTs", "J9s", "T9s", "98s", "87s", "76s",
    "AQo", "AJo", "KQo", *_BTN_CALL_EXTRA,
]
_CALL_BTN_VS_SB = [
    "44", "55", "66", "77", "88", "99", "TT", "JJ", "AQs", "AJs", "ATs", "A9s", "A8s",
    "KQs", "KJs", "KTs", "QJs", "QTs", "JTs", "T9s", "98s", "87s", "76s", "AQo", "AJo", "KQo",
    *_BTN_CALL_EXTRA,
]
_CALL_SB_VS_BB = [
    "55", "66", "77", "88", "99", "TT", "JJ", "AQs", "AJs", "ATs", "A9s", "KQs", "KJs",
    "KTs", "QJs", "JTs", "T9s", "98s", "AQo", "AJo",
    "22", "33", "44", "A8s", "A7s", "A6s", "A3s", "A2s", "K9s", "Q9s", "J9s", "87s",
    "76s", "65s", "ATo", "KQo", "KJo",
]

# (opener, defender) -> that pair's response ranges. Same nine pairs as
# reference_charts.py's _DEFEND_CHARTS["100bb"].
PAIR_RANGES: dict[tuple[Position, Position], PairRanges] = {
    (P.UTG, P.BB): PairRanges(
        three_bet=["QQ+", "AKs", "AKo", "A5s", "A4s"],
        call_vs_3=_CALL_UTG,
        four_bet=_FOUR_BET_EARLY,
        call_vs_4=["QQ", "AKs", "AKo"],
    ),
    (P.HJ, P.BB): PairRanges(
        three_bet=["JJ+", "AQs+", "AKo", "A5s", "A4s", "A3s"],
        call_vs_3=_CALL_HJ_OOP,
        four_bet=_FOUR_BET_HJ,
        call_vs_4=["JJ", "QQ", "AQs", "AKs", "AKo"],
    ),
    (P.HJ, P.BTN): PairRanges(
        three_bet=["JJ+", "AQs+", "AKo", "A5s", "A4s", "A3s"],
        call_vs_3=_CALL_HJ_IP_3BET,
        four_bet=_FOUR_BET_HJ,
        call_vs_4=["JJ", "QQ", "AQs", "AKs", "AKo"],
    ),
    (P.CO, P.BB): PairRanges(
        three_bet=["TT+", "AJs+", "KQs", "AQo+", "A5s", "A4s", "A3s"],
        call_vs_3=_CALL_CO_VS_BB,
        four_bet=_FOUR_BET_CO,
        call_vs_4=["TT", "JJ", "QQ", "AJs", "AQs", "AKs", "AKo"],
    ),
    (P.CO, P.BTN): PairRanges(
        three_bet=["TT+", "AJs+", "KQs", "AQo+", "A5s", "A4s", "A3s"],
        call_vs_3=_CALL_CO_VS_IP,
        four_bet=_FOUR_BET_CO,
        call_vs_4=["TT", "JJ", "QQ", "AQs", "AKs", "AKo"],
    ),
    (P.CO, P.SB): PairRanges(
        # The SB's chart only reaches A7s+, so its 3-bet is linear, not
        # bluff-heavy: no A5s in the continuing range to take from.
        three_bet=["TT+", "AJs+", "KQs", "AQo+"],
        call_vs_3=_CALL_CO_VS_SB,
        four_bet=["QQ+", "AKs", "AKo", "A5s"],
        call_vs_4=["TT", "JJ", "QQ", "AQs", "AKs", "AKo"],
    ),
    (P.BTN, P.SB): PairRanges(
        three_bet=["99+", "ATs+", "KJs+", "AQo+", "A5s", "98s"],
        call_vs_3=_CALL_BTN_VS_SB,
        four_bet=_FOUR_BET_LATE,
        call_vs_4=["TT", "JJ", "QQ", "AQs", "AKs", "AKo"],
    ),
    (P.BTN, P.BB): PairRanges(
        three_bet=["TT+", "ATs+", "KTs+", "QJs", "AJo+", "KQo", "A5s", "A4s", "A3s", "A2s", "76s", "65s"],
        call_vs_3=_CALL_BTN,
        four_bet=_FOUR_BET_LATE,
        call_vs_4=["TT", "JJ", "QQ", "AJs", "AQs", "AKs", "AKo", "KQs"],
    ),
    (P.SB, P.BB): PairRanges(
        three_bet=["88+", "A9s+", "KTs+", "QJs", "ATo+", "KQo", "A5s", "A4s", "A3s", "A2s", "76s", "65s", "54s"],
        call_vs_3=_CALL_SB_VS_BB,
        four_bet=_FOUR_BET_LATE,
        call_vs_4=["88", "99", "TT", "JJ", "QQ", "ATs", "AJs", "AQs", "AKs", "AQo", "AKo", "KQs"],
    ),
}


class UnsupportedPreflopLine(ValueError):
    """A well-formed preflop line these charts don't cover (limped pot, a
    5-bet, a seat pair with no chart, a stack outside 80-120bb) -- the
    route turns it into a 404, same as reference-strategy's "no match"."""


class InvalidPreflopLine(ValueError):
    """A line that doesn't make sense (wrong seats, not closed by a call)
    -- the route turns it into a 422."""


def _tokens(chart_key: str, position: Position) -> dict[str, float]:
    return REFERENCE_CHARTS[chart_key].ranges[position]


def open_range(opener: Position) -> dict[str, float]:
    return _tokens(f"{opener.value.lower()}_open_100bb", opener)


def defend_range(opener: Position, defender: Position) -> dict[str, float]:
    """The defender's whole continuing range vs the open (call + 3-bet)."""
    return _tokens(_DEFEND_CHARTS["100bb"][(opener, defender)], defender)


def three_bet_range(opener: Position, defender: Position) -> dict[str, float]:
    return expand_range(PAIR_RANGES[(opener, defender)].three_bet)


def flat_range(opener: Position, defender: Position) -> dict[str, float]:
    """The defender's call-only range vs the open: continuing minus 3-bet."""
    three_bet = three_bet_range(opener, defender)
    return {h: w for h, w in defend_range(opener, defender).items() if h not in three_bet}


def call_vs_3bet_range(opener: Position, defender: Position) -> dict[str, float]:
    return expand_range(PAIR_RANGES[(opener, defender)].call_vs_3)


def four_bet_range(opener: Position, defender: Position) -> dict[str, float]:
    return expand_range(PAIR_RANGES[(opener, defender)].four_bet)


def call_vs_4bet_range(opener: Position, defender: Position) -> dict[str, float]:
    return expand_range(PAIR_RANGES[(opener, defender)].call_vs_4)


_AGGRESSIVE = (ActionType.RAISE, ActionType.BET, ActionType.ALL_IN)


def ranges_for_preflop_line(spot: Spot) -> dict:
    """The two players' ranges for a postflop spot reached by `spot`'s
    preflop actions.

    `spot.positions_in_hand` is the two seats, `spot.actions` the preflop
    betting in order. The line must be closed by a call and have 1, 2 or 3
    raises (single-raised, 3-bet and 4-bet pots); the first raiser is the
    opener, the other seat the defender.

      1 raise  : opener = open range,        defender = flat (call) range
      2 raises : defender = 3-bet range,     opener = call-vs-3-bet range
      3 raises : opener = 4-bet range,       defender = call-vs-4-bet range

    Returns {"line": ..., "ranges": {position: HandRange}, "description": ...,
    "source": ...}. Raises InvalidPreflopLine (-> 422) for a malformed line
    and UnsupportedPreflopLine (-> 404) for one outside what's charted.
    """
    if len(spot.positions_in_hand) != 2 or spot.positions_in_hand[0] == spot.positions_in_hand[1]:
        raise InvalidPreflopLine("positions_in_hand needs the two different seats in the hand.")
    seats = set(spot.positions_in_hand)
    actions: list[BettingAction] = list(spot.actions)
    if any(a.street != Street.PREFLOP for a in actions):
        raise InvalidPreflopLine("only preflop actions describe a preflop line.")
    if any(a.position not in seats for a in actions):
        raise InvalidPreflopLine("an action is by a seat that isn't in the hand.")
    if any(a.action == ActionType.FOLD for a in actions):
        raise InvalidPreflopLine("a fold ends the hand -- there is nothing to solve after it.")

    aggressors = [a.position for a in actions if a.action in _AGGRESSIVE]
    if actions and not aggressors:
        # Limped (call, check) -- a real line, just not one that's charted.
        raise UnsupportedPreflopLine("a limped pot has no chart yet -- set the ranges by hand.")
    if not actions or actions[-1].action != ActionType.CALL:
        raise InvalidPreflopLine("the preflop line must end with a call (a closed street).")
    if len(aggressors) > 3:
        raise UnsupportedPreflopLine("5-bet pots aren't charted -- set the ranges by hand.")
    if any(first == second for first, second in zip(aggressors, aggressors[1:])):
        raise InvalidPreflopLine("a seat can't raise its own raise.")

    opener = aggressors[0]
    defender = next(seat for seat in spot.positions_in_hand if seat != opener)

    bucket = _resolve_stack_bucket(spot.effective_stack_bb)
    if bucket != "100bb":
        raise UnsupportedPreflopLine(
            "3-bet / 4-bet charts only cover about 100bb (80-120bb) so far."
        )
    if opener not in (P.UTG, P.HJ, P.CO, P.BTN, P.SB) or (opener, defender) not in PAIR_RANGES:
        raise UnsupportedPreflopLine(
            f"no chart covers {opener.value} opening against {defender.value} yet."
        )

    count = len(aggressors)
    if count == 1:
        line, who = "single_raised", {
            opener: open_range(opener),
            defender: flat_range(opener, defender),
        }
        description = f"{opener.value} opens, {defender.value} calls"
    elif count == 2:
        line, who = "three_bet", {
            defender: three_bet_range(opener, defender),
            opener: call_vs_3bet_range(opener, defender),
        }
        description = f"{opener.value} opens, {defender.value} 3-bets, {opener.value} calls"
    else:
        line, who = "four_bet", {
            opener: four_bet_range(opener, defender),
            defender: call_vs_4bet_range(opener, defender),
        }
        description = (
            f"{opener.value} opens, {defender.value} 3-bets, {opener.value} 4-bets, "
            f"{defender.value} calls"
        )
    return {
        "source": "reference_chart",
        "line": line,
        "description": description,
        "chart_source": _METHODOLOGY,
        "ranges": who,
    }
