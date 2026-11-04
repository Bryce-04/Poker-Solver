"""Writes the practice table's preflop data (apps/web/src/data/preflop-pairs.json).

Run from apps/api with the project venv active:

    python scripts/make_preflop_pairs.py

For each (opener, defender) pair the repo has charts for (preflop_ranges.py, 100bb,
6-max), the five ranges the table needs to run a hand and grade it: the defender's
call and 3-bet ranges against the open, the opener's call and 4-bet ranges against
the 3-bet, and the defender's call range against the 4-bet. Shipped as app data so
a hand never waits on the API; tests/test_preflop_pairs_data.py fails when this
file drifts from the charts, so rerun the script after changing them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.preflop_ranges import (  # noqa: E402
    PAIR_RANGES,
    call_vs_3bet_range,
    call_vs_4bet_range,
    flat_range,
    four_bet_range,
    three_bet_range,
)

OUT = Path(__file__).resolve().parents[2] / "web" / "src" / "data" / "preflop-pairs.json"


def _hands(range_: dict[str, float]) -> list[str]:
    assert all(w == 1.0 for w in range_.values())  # a table hand needs a plain in/out answer
    return sorted(range_)


def build() -> dict[str, dict[str, list[str]]]:
    data: dict[str, dict[str, list[str]]] = {}
    for opener, defender in PAIR_RANGES:
        data[f"{opener.value}>{defender.value}"] = {
            "flat": _hands(flat_range(opener, defender)),
            "threeBet": _hands(three_bet_range(opener, defender)),
            "callVs3": _hands(call_vs_3bet_range(opener, defender)),
            "fourBet": _hands(four_bet_range(opener, defender)),
            "callVs4": _hands(call_vs_4bet_range(opener, defender)),
        }
    return data


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(build(), indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
