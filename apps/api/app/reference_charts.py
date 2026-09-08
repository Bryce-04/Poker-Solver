"""Stage 2 reference-chart data: a small, hand-curated table of canonical
single-raised-pot spots, sourced from widely-published, non-proprietary
poker theory -- NOT scraped or eyeballed from any commercial solver (see
docs/plan.md, "What has to change" #3). This is a stand-in for real
solving, and every response using it must say so explicitly -- Stage 5
replaces this with a live MCCFR solve.

TODO(reference-charts): only one entry is filled in so far, as a pattern
to copy. Good next spots to add, roughly in order of how often they come
up: CO open (100bb), BTN open (100bb), SB open (100bb), BB defend vs a
BTN open (100bb). For each: pick a stack-depth bucket, write down the
range as a HandRange-shaped dict, and cite where it came from in `source`
-- a range that's been independently published by several free
communities/sites is fine, a single paid tool's chart is not.
"""

from dataclasses import dataclass

from poker_solver_schema import Position, Spot, Street


@dataclass(frozen=True)
class ChartEntry:
    key: str
    description: str
    source: str
    ranges: dict[Position, dict[str, float]]  # position -> HandRange-shaped dict


REFERENCE_CHARTS: dict[str, ChartEntry] = {
    "utg_open_100bb": ChartEntry(
        key="utg_open_100bb",
        description="UTG opening range, ~100bb effective, 6-max, unopened pot",
        source="TODO: cite the published source(s) this range comes from",
        ranges={
            Position.UTG: {
                # PLACEHOLDER -- this is not a real opening range, it's just
                # enough entries to prove the endpoint works end to end.
                # Replace with an actual ~15% UTG opening range.
                "AA": 1.0,
                "KK": 1.0,
                "QQ": 1.0,
                "JJ": 1.0,
                "AKs": 1.0,
                "AKo": 1.0,
            },
        },
    ),
    # TODO(reference-charts): add more entries here, following the shape above.
}


def find_matching_chart(spot: Spot) -> ChartEntry | None:
    """Decide which (if any) REFERENCE_CHARTS entry applies to `spot`.

    Only handles "first to act preflop, no action yet" spots so far --
    returns None (no match) for anything else rather than guessing, so a
    caller can tell "no chart for this yet" apart from "here's the chart".

    TODO(reference-charts): as more entries are added above, extend this
    to match them -- e.g. dispatch on spot.positions_in_hand[0] once more
    than one position has a chart, and widen beyond "no action yet" once
    charts exist for facing-a-raise spots.
    """
    if spot.current_street != Street.PREFLOP or spot.actions:
        return None
    if spot.positions_in_hand != [Position.UTG]:
        return None
    if not (80 <= spot.effective_stack_bb <= 120):
        return None
    return REFERENCE_CHARTS["utg_open_100bb"]
