"""Time joint (turn + river) solves, and check how good a river-card sample is.

    python services/solver/benchmarks/bench_joint.py              # sizes and timings
    python services/solver/benchmarks/bench_joint.py --accuracy   # sampled vs exact turn strategies

Spot: Q J 7 3 with the flush arriving, 100bb deep, BB's flat range against BTN's open
range (the reference charts' wide ranges), turn menu of one 50% size and a raise cap
of 2. The joint game is every closing turn line x every river card x the river's
betting, so these are the settings that decide whether a solve fits (docs/decisions.md
records the numbers, and apps/api's JOINT_MEMORY_BUDGET_BYTES is set from them).

`--accuracy` compares the turn strategy from a SAMPLE of k river cards with the
exact one (all 48), at k = 6 / 12 / 24: the root action frequencies, and the
per-hand strategies weighted by how much of the range each hand is.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent.parent / "apps" / "api"))  # app.preflop_ranges

from app.preflop_ranges import flat_range, open_range  # noqa: E402

from poker_solver import equity  # noqa: E402
from poker_solver.betting_round import BetMenu  # noqa: E402
from poker_solver.cards import card_str, parse_card  # noqa: E402
from poker_solver.range_cfr import (  # noqa: E402
    RangeCfrTrainer,
    RangeSpotConfig,
    RiverSpec,
    estimate_joint_size,
    select_river_cards,
)
from poker_solver_schema import Position  # noqa: E402

BOARD = tuple(parse_card(c) for c in ("Qs", "Jh", "7h", "3h"))
POT, STACK = 10.5, 95.0
OOP, IP = flat_range(Position.BTN, Position.BB), open_range(Position.BTN)
TURN_MENU = BetMenu(sizes=(0.5,), max_aggressive_actions=2)
RIVER_1 = BetMenu(sizes=(0.75,), max_aggressive_actions=1)
RIVER_2 = BetMenu(sizes=(0.75,), max_aggressive_actions=2)

TARGET_PCT = 0.5
MAX_ITERATIONS = 600
TIMING_ITERATIONS = 5


def config(river_menu, cards) -> RangeSpotConfig:
    return RangeSpotConfig(
        board=BOARD, pot_bb=POT, effective_stack_bb=STACK, range0=OOP, range1=IP,
        bet_menu=TURN_MENU, river=RiverSpec(bet_menu=river_menu, cards=cards),
    )


SETTINGS = [
    ("river equity only (no river betting), all 48 cards", None, None),
    ("river 75% cap 1, 12 cards", RIVER_1, 12),
    ("river 75% cap 2, 12 cards", RIVER_2, 12),
    ("river 75% cap 1, 24 cards", RIVER_1, 24),
    ("river 75% cap 1, all 48 cards (exact)", RIVER_1, None),
]


def timings() -> None:
    print(f"board {' '.join(card_str(c) for c in BOARD)}, pot {POT}bb, stack {STACK}bb, "
          f"{len(OOP)} / {len(IP)} hand types; turn menu 50% cap 2")
    print(f"target: Nash gap under {TARGET_PCT}% of the pot, at most {MAX_ITERATIONS} iterations")
    print()
    print(f"{'setting':<52}{'nodes':>8}{'est MB':>8}{'ms/iter':>9}{'iters':>7}{'total s':>9}{'gap %':>7}")
    for name, river_menu, cards in SETTINGS:
        cfg = config(river_menu, cards)
        size = estimate_joint_size(cfg)
        equity._cache.clear()
        start = time.perf_counter()
        trainer = RangeCfrTrainer(cfg)
        trainer.train(TIMING_ITERATIONS)
        per_iteration = 1000 * (time.perf_counter() - start) / TIMING_ITERATIONS  # includes setup: honest for short runs
        # the production path from scratch
        equity._cache.clear()
        start = time.perf_counter()
        fresh = RangeCfrTrainer(cfg)
        gap = fresh.train_until(TARGET_PCT, MAX_ITERATIONS)
        total = time.perf_counter() - start
        steady = None
        t0 = time.perf_counter()
        fresh.train(5)
        steady = 1000 * (time.perf_counter() - t0) / 5
        print(f"{name:<52}{size.decisions:>8,}{size.bytes / 1e6:>8.0f}{steady:>9.0f}{fresh.iterations:>7}{total:>9.1f}{gap:>7.2f}")


def accuracy() -> None:
    def solve(cards, iterations=300):
        trainer = RangeCfrTrainer(config(RIVER_1, cards))
        trainer.train(iterations)
        return trainer

    exact = solve(None)
    actions, exact_strategy = exact.average_strategy()
    weights = exact.weights[exact._nodes[()].actor]
    exact_freq = (exact_strategy * weights[:, None]).sum(0) / weights.sum()
    print(f"exact (all 48 cards) turn-root frequencies: "
          + ", ".join(f"{a} {f:.1%}" for a, f in zip(actions, exact_freq)))
    print(f"{'cards':>6}{'sample':<40}{'max freq diff':>15}{'per-hand diff':>15}")
    for k in (6, 12, 24):
        trainer = solve(k)
        _, strategy = trainer.average_strategy()
        freq = (strategy * weights[:, None]).sum(0) / weights.sum()
        per_hand = np.abs(strategy - exact_strategy).max(axis=1)
        sample = " ".join(card_str(c) for c in select_river_cards(BOARD, k))
        print(f"{k:>6} {sample:<39}{np.abs(freq - exact_freq).max():>15.3f}{(per_hand * weights).sum() / weights.sum():>15.3f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--accuracy", action="store_true", help="compare sampled river cards against all of them")
    args = parser.parse_args()
    accuracy() if args.accuracy else timings()
