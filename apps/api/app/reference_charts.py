"""Stage 2 reference-chart data: a small, hand-curated table of canonical
single-raised-pot spots. This is a stand-in for real solving -- Stage 5
replaces it with a live MCCFR solve -- and every response using it must
say so explicitly (see routes/spots.py).

Sourcing (see docs/plan.md, "What has to change" #3): these ranges are
constructed from general, widely-taught opening-range principles for
100bb 6-max cash -- progressively tighter first-in ranges from earlier
position, progressively wider from later position, standard suited-ace
and broadway inclusion logic. They are NOT copied from, or intended to
match, any single commercial solver's output. Treat them as a reasonable
approximate placeholder, not ground truth -- validate/replace against
Stage 5's live solve once it exists.

Known limitation: HandRange only has room for one weight per hand, so the
BB-defend chart below represents BB's whole *continuing* range (call or
3bet combined), not a split between the two -- distinguishing them needs
either a schema change or Stage 5's real solve.
"""

from poker_solver_schema import ActionType, BettingAction, Position, Spot, Street

from .range_notation import expand_range

_METHODOLOGY = (
    "Approximate range built from general, widely-taught 100bb 6-max "
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


REFERENCE_CHARTS: dict[str, ChartEntry] = {
    "utg_open_100bb": ChartEntry(
        key="utg_open_100bb",
        description="UTG opening range, ~100bb effective, 6-max, unopened pot",
        ranges={
            Position.UTG: expand_range(
                [
                    "77+",
                    "A9s+",
                    "K9s+",
                    "Q9s+",
                    "JTs",
                    "T9s",
                    "98s",
                    "AJo+",
                    "KQo",
                ]
            ),
        },
    ),
    "co_open_100bb": ChartEntry(
        key="co_open_100bb",
        description="CO opening range, ~100bb effective, 6-max, unopened pot",
        ranges={
            Position.CO: expand_range(
                [
                    "22+",
                    "A2s+",
                    "K7s+",
                    "Q9s+",
                    "J9s+",
                    "T9s",
                    "98s",
                    "87s",
                    "76s",
                    "A8o+",
                    "K9o+",
                    "QTo+",
                    "JTo",
                ]
            ),
        },
    ),
    "btn_open_100bb": ChartEntry(
        key="btn_open_100bb",
        description="BTN opening range, ~100bb effective, 6-max, unopened pot",
        ranges={
            Position.BTN: expand_range(
                [
                    "22+",
                    "A2s+",
                    "K2s+",
                    "Q5s+",
                    "J7s+",
                    "T6s+",
                    "96s+",
                    "86s+",
                    "75s+",
                    "65s",
                    "54s",
                    "A2o+",
                    "K7o+",
                    "Q9o+",
                    "JTo",
                ]
            ),
        },
    ),
    "sb_open_100bb": ChartEntry(
        key="sb_open_100bb",
        description="SB opening range, ~100bb effective, 6-max, unopened pot "
        "(open-raise, not limp)",
        ranges={
            Position.SB: expand_range(
                [
                    "22+",
                    "A2s+",
                    "K5s+",
                    "Q8s+",
                    "J8s+",
                    "T8s+",
                    "97s+",
                    "87s",
                    "76s",
                    "65s",
                    "A5o+",
                    "K9o+",
                    "QTo+",
                    "JTo",
                ]
            ),
        },
    ),
    "bb_defend_vs_btn_open_100bb": ChartEntry(
        key="bb_defend_vs_btn_open_100bb",
        description="BB continuing range (call or 3bet) facing a BTN open, "
        "~100bb effective",
        ranges={
            Position.BB: expand_range(
                [
                    "22+",
                    "A2s+",
                    "K2s+",
                    "Q4s+",
                    "J6s+",
                    "T6s+",
                    "96s+",
                    "86s+",
                    "75s+",
                    "65s",
                    "54s",
                    "A2o+",
                    "K8o+",
                    "Q9o+",
                    "J9o+",
                    "T9o",
                ]
            ),
        },
    ),
}

_OPENER_CHARTS = {
    Position.UTG: "utg_open_100bb",
    Position.CO: "co_open_100bb",
    Position.BTN: "btn_open_100bb",
    Position.SB: "sb_open_100bb",
}


def _is_single_btn_open(actions: list[BettingAction]) -> bool:
    if len(actions) != 1:
        return False
    action = actions[0]
    return (
        action.position == Position.BTN
        and action.street == Street.PREFLOP
        and action.action == ActionType.RAISE
    )


def find_matching_chart(spot: Spot) -> ChartEntry | None:
    """Decide which (if any) REFERENCE_CHARTS entry applies to `spot`.

    Two categories so far:
      - Unopened pot: positions_in_hand is a single position with an entry
        in _OPENER_CHARTS and no action yet.
      - BB facing a single BTN open (the one "facing a raise" case handled
        so far -- see the module docstring's known limitation, and
        reference_charts.py's own TODO below for widening this further).

    Returns None (no match) for anything else rather than guessing.

    TODO(reference-charts): widen this as more chart entries are added --
    e.g. BB/SB/CO/etc. facing other positions' opens, 3bet-pot charts,
    other stack-depth buckets.
    """
    if spot.current_street != Street.PREFLOP:
        return None
    if not (80 <= spot.effective_stack_bb <= 120):
        return None

    if not spot.actions:
        if len(spot.positions_in_hand) != 1:
            return None
        chart_key = _OPENER_CHARTS.get(spot.positions_in_hand[0])
        return REFERENCE_CHARTS[chart_key] if chart_key else None

    if spot.positions_in_hand == [Position.BB] and _is_single_btn_open(spot.actions):
        return REFERENCE_CHARTS["bb_defend_vs_btn_open_100bb"]

    return None
