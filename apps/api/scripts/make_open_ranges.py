"""Writes the Train tab's opening-range data (apps/web/src/data/open-ranges.json).

Run from apps/api with the project venv active:

    python scripts/make_open_ranges.py

The lessons grade "open or fold?" answers against the repo's reference opening
ranges (reference_charts.py, 100bb, 6-max), shipped as app data so a lesson
never waits on the API. tests/test_open_ranges_data.py fails when this file
drifts from the charts, so rerun the script after changing them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.reference_charts import REFERENCE_CHARTS  # noqa: E402

SEATS = ("UTG", "HJ", "CO", "BTN", "SB")
OUT = Path(__file__).resolve().parents[2] / "web" / "src" / "data" / "open-ranges.json"


def build() -> dict[str, list[str]]:
    data: dict[str, list[str]] = {}
    for seat in SEATS:
        entry = REFERENCE_CHARTS[f"{seat.lower()}_open_100bb"]
        (range_,) = entry.ranges.values()
        # Every weight is 1 in these charts; a lesson needs a plain in/out answer.
        assert all(w == 1.0 for w in range_.values()), seat
        data[seat] = sorted(range_)
    return data


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(build(), indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
