"""Solve the same turn spot with our joint trainer and compare it with postflop-solver's output.

    python compare_with_postflop_solver.py <their_strategy.csv> [target % of pot] [max iterations]

The CSV is what the Rust `compare` binary in postflop_solver/ writes (see README.md). Prints
our time, iterations and game value, then both solvers' OOP root strategies side by side.
"""
import csv
import sys
import time

import numpy as np

from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "apps" / "api"))
from app.preflop_ranges import flat_range, open_range  # noqa: E402

from poker_solver import equity  # noqa: E402
from poker_solver.betting_round import BetMenu  # noqa: E402
from poker_solver.cards import card_str, parse_card  # noqa: E402
from poker_solver.range_cfr import RangeCfrTrainer, RangeSpotConfig, RiverSpec  # noqa: E402
from poker_solver_schema import Position  # noqa: E402

theirs_csv = sys.argv[1]
board = tuple(parse_card(c) for c in ("Qs", "Jh", "7h", "3h"))
POT, STACK = 10.5, 95.0
config = RangeSpotConfig(
    board=board, pot_bb=POT, effective_stack_bb=STACK,
    range0=flat_range(Position.BTN, Position.BB), range1=open_range(Position.BTN),
    bet_menu=BetMenu(sizes=(0.5,), max_aggressive_actions=1),
    river=RiverSpec(bet_menu=BetMenu(sizes=(0.75,), max_aggressive_actions=1), cards=None),
)

equity._cache.clear()
t0 = time.perf_counter()
trainer = RangeCfrTrainer(config)
setup = time.perf_counter() - t0
t1 = time.perf_counter()
gap = trainer.train_until(float(sys.argv[2]) if len(sys.argv) > 2 else 0.5, int(sys.argv[3]) if len(sys.argv) > 3 else 800, check_every=10)
train = time.perf_counter() - t1
u0 = trainer.value_under_average(0)
u1 = trainer.value_under_average(1)
print(f"OURS  : setup {setup:.2f}s + train {train:.2f}s = {setup + train:.2f}s, {trainer.iterations} iterations, "
      f"gap {gap:.3f}% of pot, {len(trainer._decisions)} decision nodes")
print(f"OURS  : OOP EV {u0 * 100:.2f} chips, IP EV {u1 * 100:.2f} chips (x100 to compare; sum {100 * (u0 + u1):.2f})")

# ---- their root strategy
rows = list(csv.DictReader(open(theirs_csv)))
actions_cols = [c for c in rows[0] if c.startswith("a")]
theirs = {}
for r in rows:
    h = r["hand"]
    cards = frozenset([h[:2], h[2:]])
    theirs[cards] = (float(r["weight"]), np.array([float(r[c]) for c in actions_cols]))

ours_actions, ours_strategy = trainer.average_strategy()
print("OURS root actions :", ours_actions, "| THEIRS:", actions_cols)
w_sum = 0.0
freq_ours = np.zeros(len(ours_actions)); freq_theirs = np.zeros(len(ours_actions))
diff_hand = 0.0
missing = 0
for i, combo in enumerate(trainer.combos[0]):
    key = frozenset(card_str(c) for c in combo)
    # their card strings are rank+suit like ours
    if key not in theirs:
        missing += 1
        continue
    w, t = theirs[key]
    o = ours_strategy[i]
    w_sum += w
    freq_ours += w * o
    freq_theirs += w * t
    diff_hand += w * np.abs(o - t).max()
print(f"hands matched: {len(trainer.combos[0]) - missing} of {len(trainer.combos[0])} (their {len(theirs)})")
fo, ft = freq_ours / w_sum, freq_theirs / w_sum
print("root frequencies  ours   :", dict(zip(ours_actions, np.round(fo, 4))))
print("root frequencies  theirs:", dict(zip(ours_actions, np.round(ft, 4))))
print(f"max frequency difference {np.abs(fo - ft).max():.4f}; range-weighted per-hand strategy difference {diff_hand / w_sum:.4f}")
