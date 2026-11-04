"""The practice table's shipped preflop data must match the charts, and be internally consistent."""

import json
import sys
from pathlib import Path

API = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API / "scripts"))

from make_open_ranges import OUT as OPEN_OUT  # noqa: E402
from make_preflop_pairs import OUT, build  # noqa: E402


def test_shipped_pair_data_matches_the_charts():
    assert json.loads(OUT.read_text(encoding="utf-8")) == build(), (
        "apps/web/src/data/preflop-pairs.json is stale: run `python scripts/make_preflop_pairs.py` in apps/api"
    )


def test_the_table_can_always_decide_what_a_hand_does_at_each_node():
    opens = json.loads(OPEN_OUT.read_text(encoding="utf-8"))
    for pair, r in build().items():
        opener, defender = pair.split(">")
        assert opener in opens, pair
        flat, three, call3, four, call4 = (set(r[k]) for k in ("flat", "threeBet", "callVs3", "fourBet", "callVs4"))
        # One action per hand at every node, so a hand has exactly one right answer.
        assert not flat & three, pair
        assert not call3 & four, pair
        # You can only be holding hands you could have reached the node with.
        assert call3 | four <= set(opens[opener]), pair
        assert call4 <= three, pair
