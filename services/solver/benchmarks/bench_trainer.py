"""Time the range-vs-range trainer on realistic spots.

    python services/solver/benchmarks/bench_trainer.py              # the real trainer
    python services/solver/benchmarks/bench_trainer.py --reference  # the frozen pre-optimization copy

Reports, per spot: setup (the equity matrix), milliseconds per training
iteration, and the wall-clock to reach the production target (exploitability
under 0.5% of the pot, as /spots/solve uses). Run both and compare to see what
the optimizations bought; docs/decisions.md records the numbers.

The ranges are the reference charts' (BB defends against a BTN open), the same
spots the product solves, not toy ranges.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tests"))  # reference_range_cfr.py lives with the tests
sys.path.insert(0, str(HERE.parent.parent.parent / "apps" / "api"))  # app.preflop_ranges

from app.preflop_ranges import defend_range, flat_range, open_range  # noqa: E402

from poker_solver.cards import parse_card  # noqa: E402
from poker_solver_schema import Position  # noqa: E402

BB, BTN = Position.BB, Position.BTN

# name, board, pot, stack, OOP range, IP range
SPOTS = [
    ("flop K72r, BB defend vs BTN open", "Ks 7h 2d", 6.5, 97.0, defend_range(BTN, BB), open_range(BTN)),
    ("flop QJ7 two-tone, BB flat vs BTN open", "Qs Jh 7h", 6.5, 97.0, flat_range(BTN, BB), open_range(BTN)),
    ("turn Q J 7 3 (flush), BB flat vs BTN open", "Qs Jh 7h 3h", 10.5, 95.0, flat_range(BTN, BB), open_range(BTN)),
    ("river K 7 2 9 4, BB flat vs BTN open", "Ks 7h 2d 9c 4s", 20.0, 80.0, flat_range(BTN, BB), open_range(BTN)),
]

TARGET_PCT = 0.5
MAX_ITERATIONS = 400
TIMING_ITERATIONS = 30


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--reference", action="store_true", help="run the frozen pre-optimization trainer")
    parser.add_argument("--only", help="substring of a spot name to run just that one")
    args = parser.parse_args()

    if args.reference:
        import reference_range_cfr as module

        label = "REFERENCE (pre-optimization)"
    else:
        from poker_solver import range_cfr as module

        label = "current trainer"
    print(f"{label}\n")
    print(f"{'spot':<46}{'combos':>10}{'setup s':>9}{'ms/iter':>9}{'iters':>7}{'total s':>9}{'expl %':>8}")
    for name, board_text, pot, stack, oop, ip in SPOTS:
        if args.only and args.only not in name:
            continue
        config = module.RangeSpotConfig(
            board=tuple(parse_card(c) for c in board_text.split()),
            pot_bb=pot, effective_stack_bb=stack, range0=oop, range1=ip,
        )
        t0 = time.perf_counter()
        trainer = module.RangeCfrTrainer(config)
        setup = time.perf_counter() - t0

        t0 = time.perf_counter()
        trainer.train(TIMING_ITERATIONS)
        ms_per_iteration = 1000 * (time.perf_counter() - t0) / TIMING_ITERATIONS

        # The production path, from scratch: setup + train until the target.
        t0 = time.perf_counter()
        fresh = module.RangeCfrTrainer(config)
        expl = fresh.train_until(TARGET_PCT, MAX_ITERATIONS)
        total = time.perf_counter() - t0
        print(
            f"{name:<46}{len(trainer.combos[0]):>5}x{len(trainer.combos[1]):<4}{setup:>9.2f}"
            f"{ms_per_iteration:>9.1f}{fresh.iterations:>7}{total:>9.1f}{expl:>8.2f}"
        )


if __name__ == "__main__":
    main()
