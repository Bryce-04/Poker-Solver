"""The Train tab's shipped opening ranges must match the reference charts."""

import json
import sys
from pathlib import Path

API = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API / "scripts"))

from make_open_ranges import OUT, build  # noqa: E402


def test_shipped_open_ranges_match_the_reference_charts():
    assert json.loads(OUT.read_text(encoding="utf-8")) == build(), (
        "apps/web/src/data/open-ranges.json is stale: run `python scripts/make_open_ranges.py` in apps/api"
    )


def test_ranges_widen_toward_the_button():
    data = build()
    sizes = [len(data[seat]) for seat in ("UTG", "HJ", "CO", "BTN")]
    assert sizes == sorted(sizes) and len(set(sizes)) == 4
