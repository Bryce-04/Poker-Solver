"""Solve one flop with several bet menus and compare what it costs.

    cd apps/api && python scripts/compare_bet_menus.py [--board "Ks 7h 2d"]

A custom menu changes the size of the game tree, and with it the solve time,
so this is how to see what a menu will cost before putting it in front of the
Render free tier (docs/decisions.md records the measured numbers). Spot: BB
(out of position) defends against a BTN open in a single-raised pot, 100bb,
BB to act first on the flop, using the reference charts' ranges. Nothing here
is saved or sent anywhere.
"""

from __future__ import annotations

import argparse
import time

from poker_solver.betting_round import DEFAULT_BET_MENU, BetMenu
from poker_solver.cards import parse_card
from poker_solver.range_cfr import RangeCfrTrainer, RangeSpotConfig

from app.preflop_ranges import flat_range, open_range
from poker_solver_schema import Position

MENUS: list[tuple[str, BetMenu]] = [
    ("one size   33%", BetMenu(sizes=(0.33,))),
    ("two sizes  33 / 75%", BetMenu(sizes=(0.33, 0.75))),
    ("default    25 / 75 / 125%", DEFAULT_BET_MENU),
    ("three      33 / 66 / 100%", BetMenu(sizes=(0.33, 0.66, 1.0))),
    ("four       25 / 50 / 100 / 200%", BetMenu(sizes=(0.25, 0.5, 1.0, 2.0))),
    ("default, raise cap 2", BetMenu(sizes=(0.25, 0.75, 1.25), max_aggressive_actions=2)),
    ("default, raise cap 4", BetMenu(sizes=(0.25, 0.75, 1.25), max_aggressive_actions=4)),
]

TARGET_PCT = 0.5
MAX_ITERATIONS = 600


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--board", default="Ks 7h 2d", help="3-5 cards, e.g. 'Qs Jh 7h 3h'")
    parser.add_argument("--pot", type=float, default=6.5, help="pot entering the street, bb")
    parser.add_argument("--stack", type=float, default=97.0, help="effective stack, bb")
    args = parser.parse_args()

    board = tuple(parse_card(c) for c in args.board.split())
    oop, ip = flat_range(Position.BTN, Position.BB), open_range(Position.BTN)
    print(f"board {args.board}, pot {args.pot}bb, stack {args.stack}bb, BB flat range vs BTN open range")
    print(f"target: exploitability under {TARGET_PCT}% of the pot, at most {MAX_ITERATIONS} iterations\n")
    print(f"{'menu':<34}{'actions at root':>16}{'iters':>7}{'seconds':>9}{'expl %':>8}  BB bets")
    for name, menu in MENUS:
        start = time.perf_counter()
        trainer = RangeCfrTrainer(
            RangeSpotConfig(
                board=board, pot_bb=args.pot, effective_stack_bb=args.stack,
                range0=oop, range1=ip, bet_menu=menu,
            )
        )
        expl = trainer.train_until(TARGET_PCT, MAX_ITERATIONS)
        seconds = time.perf_counter() - start

        # Share of BB's range (counting combos) that bets rather than checks.
        actions, strategy = trainer.average_strategy()
        weights = trainer.weights[0]
        check = actions.index("check")
        bet_share = 1.0 - float((weights * strategy[:, check]).sum() / weights.sum())
        print(
            f"{name:<34}{len(actions):>16}{trainer.iterations:>7}{seconds:>9.1f}{expl:>8.2f}  {bet_share:.0%}"
        )


if __name__ == "__main__":
    main()
