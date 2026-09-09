"""Stage 2 reference-chart data: a small, hand-curated table of canonical
single-raised-pot spots. This is a stand-in for real solving -- Stage 5
replaces it with a live MCCFR solve -- and every response using it must
say so explicitly (see routes/spots.py).

Sourcing (see docs/plan.md, "What has to change" #3): these ranges are
constructed from general, widely-taught opening-range principles for
6-max cash -- progressively tighter first-in ranges from earlier position,
progressively wider from later position, standard suited-ace and broadway
inclusion logic. Shallower-stack (40bb) ranges are trimmed from the 100bb
ranges by removing the most implied-odds-dependent hands (small suited
connectors, low pocket pairs kept mainly for set-mining) -- shallow stacks
reward raw high-card strength over speculative hands that need deep
stacks to pay off, another widely-taught principle. None of this is
copied from, or intended to match, any single commercial solver's output.
Treat it as a reasonable approximate placeholder, not ground truth --
validate/replace against Stage 5's live solve once it exists.

Known limitation: HandRange only has room for one weight per hand, so
every "defend" chart below represents the whole *continuing* range (call
or 3bet combined), not a split between the two -- distinguishing them
needs either a schema change or Stage 5's real solve.
"""

from poker_solver_schema import ActionType, BettingAction, Position, Spot, Street

from .range_notation import expand_range

_METHODOLOGY = (
    "Approximate range built from general, widely-taught 6-max "
    "opening-range principles (not from any single commercial solver). "
    "See reference_charts.py module docstring."
)


class ChartEntry:
    def __init__(
        self,
        key: str,
        description: str,
        ranges: dict[Position, dict[str, float]],
        source: str = _METHODOLOGY,
    ) -> None:
        self.key = key
        self.description = description
        self.source = source
        self.ranges = ranges


def _open_entry(position: Position, key: str, bucket: str, tokens: list[str]) -> ChartEntry:
    return ChartEntry(
        key=key,
        description=f"{position.value} opening range, ~{bucket} effective, "
        "6-max, unopened pot",
        ranges={position: expand_range(tokens)},
    )


def _defend_entry(
    defender: Position, opener: Position, key: str, bucket: str, tokens: list[str]
) -> ChartEntry:
    return ChartEntry(
        key=key,
        description=f"{defender.value} continuing range (call or 3bet) facing "
        f"a {opener.value} open, ~{bucket} effective",
        ranges={defender: expand_range(tokens)},
    )


REFERENCE_CHARTS: dict[str, ChartEntry] = {
    # ---- 100bb (standard depth) ----
    "utg_open_100bb": _open_entry(
        Position.UTG, "utg_open_100bb", "100bb",
        ["77+", "A9s+", "K9s+", "Q9s+", "JTs", "T9s", "98s", "AJo+", "KQo"],
    ),
    "co_open_100bb": _open_entry(
        Position.CO, "co_open_100bb", "100bb",
        ["22+", "A2s+", "K7s+", "Q9s+", "J9s+", "T9s", "98s", "87s", "76s",
         "A8o+", "K9o+", "QTo+", "JTo"],
    ),
    "btn_open_100bb": _open_entry(
        Position.BTN, "btn_open_100bb", "100bb",
        ["22+", "A2s+", "K2s+", "Q5s+", "J7s+", "T6s+", "96s+", "86s+", "75s+",
         "65s", "54s", "A2o+", "K7o+", "Q9o+", "JTo"],
    ),
    "sb_open_100bb": _open_entry(
        Position.SB, "sb_open_100bb", "100bb (open-raise, not limp)",
        ["22+", "A2s+", "K5s+", "Q8s+", "J8s+", "T8s+", "97s+", "87s", "76s",
         "65s", "A5o+", "K9o+", "QTo+", "JTo"],
    ),
    "bb_defend_vs_btn_open_100bb": _defend_entry(
        Position.BB, Position.BTN, "bb_defend_vs_btn_open_100bb", "100bb",
        ["22+", "A2s+", "K2s+", "Q4s+", "J6s+", "T6s+", "96s+", "86s+", "75s+",
         "65s", "54s", "A2o+", "K8o+", "Q9o+", "J9o+", "T9o"],
    ),
    "btn_defend_vs_co_open_100bb": _defend_entry(
        Position.BTN, Position.CO, "btn_defend_vs_co_open_100bb", "100bb",
        ["22+", "A2s+", "K7s+", "Q9s+", "J9s+", "T9s", "98s", "87s", "76s",
         "A9o+", "KTo+", "QJo"],
    ),
    "sb_defend_vs_btn_open_100bb": _defend_entry(
        Position.SB, Position.BTN, "sb_defend_vs_btn_open_100bb", "100bb",
        ["55+", "A5s+", "K9s+", "Q9s+", "JTs", "T9s", "98s", "AJo+", "KQo"],
    ),
    "bb_defend_vs_co_open_100bb": _defend_entry(
        Position.BB, Position.CO, "bb_defend_vs_co_open_100bb", "100bb",
        ["22+", "A2s+", "K5s+", "Q8s+", "J8s+", "T8s+", "97s+", "87s", "76s",
         "65s", "A7o+", "K9o+", "QTo+", "JTo"],
    ),
    # ---- 40bb (short stack -- trimmed toward raw high-card strength,
    # away from implied-odds-dependent hands; see module docstring) ----
    "utg_open_40bb": _open_entry(
        Position.UTG, "utg_open_40bb", "40bb",
        ["88+", "ATs+", "KTs+", "QTs+", "JTs", "AJo+", "KQo"],
    ),
    "co_open_40bb": _open_entry(
        Position.CO, "co_open_40bb", "40bb",
        ["33+", "A2s+", "K8s+", "QTs+", "JTs", "T9s", "A9o+", "KTo+", "QJo"],
    ),
    "btn_open_40bb": _open_entry(
        Position.BTN, "btn_open_40bb", "40bb",
        ["22+", "A2s+", "K4s+", "Q8s+", "J8s+", "T7s+", "97s+", "87s", "76s",
         "A5o+", "K9o+", "QTo+", "JTo"],
    ),
    "sb_open_40bb": _open_entry(
        Position.SB, "sb_open_40bb", "40bb (open-raise, not limp)",
        ["22+", "A2s+", "K7s+", "Q9s+", "JTs", "T9s", "98s", "A8o+", "KTo+", "QJo"],
    ),
    "bb_defend_vs_btn_open_40bb": _defend_entry(
        Position.BB, Position.BTN, "bb_defend_vs_btn_open_40bb", "40bb",
        ["22+", "A2s+", "K6s+", "Q8s+", "J8s+", "T8s+", "98s", "87s",
         "A6o+", "K9o+", "QTo+", "JTo"],
    ),
    "btn_defend_vs_co_open_40bb": _defend_entry(
        Position.BTN, Position.CO, "btn_defend_vs_co_open_40bb", "40bb",
        ["22+", "A2s+", "K8s+", "QTs+", "JTs", "T9s", "ATo+", "KJo+"],
    ),
    "sb_defend_vs_btn_open_40bb": _defend_entry(
        Position.SB, Position.BTN, "sb_defend_vs_btn_open_40bb", "40bb",
        ["66+", "A7s+", "K9s+", "QTs+", "JTs", "AJo+", "KQo"],
    ),
    "bb_defend_vs_co_open_40bb": _defend_entry(
        Position.BB, Position.CO, "bb_defend_vs_co_open_40bb", "40bb",
        ["22+", "A2s+", "K8s+", "Q9s+", "J9s+", "T9s", "98s", "A8o+", "K9o+", "QJo"],
    ),
}

_STACK_BUCKETS: dict[str, tuple[float, float]] = {
    "100bb": (80.0, 120.0),
    "40bb": (30.0, 50.0),
}

_OPENER_CHARTS: dict[str, dict[Position, str]] = {
    "100bb": {
        Position.UTG: "utg_open_100bb",
        Position.CO: "co_open_100bb",
        Position.BTN: "btn_open_100bb",
        Position.SB: "sb_open_100bb",
    },
    "40bb": {
        Position.UTG: "utg_open_40bb",
        Position.CO: "co_open_40bb",
        Position.BTN: "btn_open_40bb",
        Position.SB: "sb_open_40bb",
    },
}

# bucket -> (opener's position, defender's position) -> chart key. Each
# entry needs the opener to have raised uncontested (no one else has acted)
# and the defender to be the one deciding what to do about it -- see
# _is_single_open_raise below.
_DEFEND_CHARTS: dict[str, dict[tuple[Position, Position], str]] = {
    "100bb": {
        (Position.BTN, Position.BB): "bb_defend_vs_btn_open_100bb",
        (Position.CO, Position.BTN): "btn_defend_vs_co_open_100bb",
        (Position.BTN, Position.SB): "sb_defend_vs_btn_open_100bb",
        (Position.CO, Position.BB): "bb_defend_vs_co_open_100bb",
    },
    "40bb": {
        (Position.BTN, Position.BB): "bb_defend_vs_btn_open_40bb",
        (Position.CO, Position.BTN): "btn_defend_vs_co_open_40bb",
        (Position.BTN, Position.SB): "sb_defend_vs_btn_open_40bb",
        (Position.CO, Position.BB): "bb_defend_vs_co_open_40bb",
    },
}


def _resolve_stack_bucket(effective_stack_bb: float) -> str | None:
    for label, (low, high) in _STACK_BUCKETS.items():
        if low <= effective_stack_bb <= high:
            return label
    return None


def _is_single_open_raise(actions: list[BettingAction]) -> BettingAction | None:
    """If `actions` is exactly one preflop raise (an uncontested open --
    nobody's called or 3bet yet), returns that action. Otherwise None."""
    if len(actions) != 1:
        return None
    action = actions[0]
    if action.street == Street.PREFLOP and action.action == ActionType.RAISE:
        return action
    return None


def find_matching_chart(spot: Spot) -> ChartEntry | None:
    """Decide which (if any) REFERENCE_CHARTS entry applies to `spot`.

    Two categories, each keyed by stack-depth bucket (_resolve_stack_bucket)
    on top of position:
      - Unopened pot: positions_in_hand is a single position with an entry
        in _OPENER_CHARTS[bucket] and no action yet.
      - A single position facing an uncontested open from another position,
        with an entry in _DEFEND_CHARTS[bucket] for that (opener, defender)
        pair -- see the module docstring's known limitation (this
        represents a combined call-or-3bet continuing range, not a split).

    A stack depth that falls between buckets (e.g. 65bb, between 40bb and
    100bb) matches nothing, rather than snapping to the nearest bucket --
    see the module docstring; these are approximate placeholders and
    shouldn't be stretched past what they were actually built for.

    Returns None (no match) for anything else rather than guessing.

    TODO(reference-charts): widen this as more chart entries are added --
    e.g. more (opener, defender) pairs per bucket, 3bet-pot charts
    (defender's raise gets 4bet/folded/called), more stack-depth buckets
    (e.g. 200bb deep, or sub-25bb push/fold).
    """
    if spot.current_street != Street.PREFLOP:
        return None
    bucket = _resolve_stack_bucket(spot.effective_stack_bb)
    if bucket is None:
        return None
    if len(spot.positions_in_hand) != 1:
        return None

    if not spot.actions:
        chart_key = _OPENER_CHARTS.get(bucket, {}).get(spot.positions_in_hand[0])
        return REFERENCE_CHARTS[chart_key] if chart_key else None

    opener_action = _is_single_open_raise(spot.actions)
    if opener_action is None:
        return None
    chart_key = _DEFEND_CHARTS.get(bucket, {}).get(
        (opener_action.position, spot.positions_in_hand[0])
    )
    return REFERENCE_CHARTS[chart_key] if chart_key else None
