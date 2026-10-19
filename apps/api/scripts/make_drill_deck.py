"""Builds the Swipe Drill's pre-solved deck (docs/plan.md, "Swipe Drill").

Run from apps/api with the project venv active:

    python scripts/make_drill_deck.py

Solves BB (defend range) vs BTN (open range) on a set of flops with the real
range-vs-range solver, then deals hands from the solved trees. One solve
yields every decision on the flop, so each board makes three kinds of card:

  first_to_act   hero is BB, out of position, nothing has happened yet
  facing_check   hero is BTN, in position, BB checked
  facing_bet     hero is BTN, BB bet (the size is drawn by how often BB bets it)

and each card carries the solver's action mix for that exact hand. The result
is written to apps/web/src/data/drill-deck.json and shipped as app data, so a
drill never waits on the API. Seeded: the same code gives the same deck.

Ranges are the repo's approximate reference charts (preflop_ranges.py), and
the pot is the standard single-raised pot at 100bb: BTN opens 2.5bb, BB calls,
the SB's 0.5bb is dead money, so 5.5bb with 97.5bb behind.
"""

from __future__ import annotations

import json
import math
import random
import sys
import time
from pathlib import Path

import numpy as np

from poker_solver.cards import parse_card
from poker_solver.combos import combo_key
from poker_solver.range_cfr import RangeCfrTrainer, RangeSpotConfig
from poker_solver_schema import Position

from app.preflop_ranges import defend_range, open_range

POT_BB = 5.5
STACK_BB = 97.5
OOP, IP = Position.BB, Position.BTN
TARGET_EXPLOITABILITY_PCT = 0.5
MAX_ITERATIONS = 250
SEED = 20261019

# Varied textures on purpose: dry high, dry low, paired, two-tone, monotone,
# connected, ace-high, broadway. A drill that is all K72r teaches one board.
BOARDS = [
    "Ks 7h 2d",
    "Ah 8c 3s",
    "Qd Jh 4c",
    "9s 8s 6d",
    "Td 5h 5c",
    "Kh Qh 3h",
    "7c 6d 2s",
    "Ac Kd 9h",
    "Jc 9d 4d",
    "Qs 5c 2c",
    "8h 7d 3c",
    "Th 9h 5s",
]

# Hands dealt per (board, scenario): one drawn at random by range weight, one
# picked as the most mixed of a larger sample (the interesting decisions).
RANDOM_PER_SCENARIO = 1
MIXED_PER_SCENARIO = 1
MIXED_SAMPLE = 12

SCENARIOS = [
    ("first_to_act", 0, ()),
    ("facing_check", 1, ("check",)),
    ("facing_bet", 1, None),  # history chosen per board
]


def entropy(row: np.ndarray) -> float:
    p = row[row > 1e-9]
    return float(-(p * np.log(p)).sum())


def deal(
    trainer: RangeCfrTrainer,
    player: int,
    history: tuple[str, ...],
    rng: random.Random,
) -> list[tuple[str, np.ndarray, tuple[str, ...]]]:
    """Hands for one decision: [(hand_key, strategy_row, actions)]."""
    actions, strategy = trainer.average_strategy(history)
    weights = trainer.weights[player]
    combos = trainer.combos[player]
    indices = list(range(len(combos)))

    def draw(k: int) -> list[int]:
        return rng.choices(indices, weights=[float(w) for w in weights], k=k)

    picked: list[int] = []
    sample = draw(MIXED_SAMPLE)
    mixed = max(sample, key=lambda i: entropy(strategy[i]))
    picked.append(mixed)
    while len(picked) < MIXED_PER_SCENARIO + RANDOM_PER_SCENARIO:
        i = draw(1)[0]
        if i not in picked:
            picked.append(i)
    return [(combo_key(combos[i]), strategy[i], actions) for i in picked]


def main() -> None:
    rng = random.Random(SEED)
    oop_range = defend_range(IP, OOP)
    ip_range = open_range(IP)
    spots: list[dict] = []
    worst = 0.0
    started = time.perf_counter()

    for board_text in BOARDS:
        board = board_text.split()
        t0 = time.perf_counter()
        trainer = RangeCfrTrainer(
            RangeSpotConfig(
                board=tuple(parse_card(c) for c in board),
                pot_bb=POT_BB,
                effective_stack_bb=STACK_BB,
                range0=oop_range,
                range1=ip_range,
            )
        )
        exploitability = trainer.train_until(TARGET_EXPLOITABILITY_PCT, MAX_ITERATIONS)
        worst = max(worst, exploitability)
        print(
            f"{board_text}: {trainer.iterations} iterations, "
            f"exploitability {exploitability:.2f}% of pot, {time.perf_counter() - t0:.1f}s",
            flush=True,
        )

        # How often BB opens each size, to choose which bet BTN faces.
        root_actions, root_strategy = trainer.average_strategy(())
        bet_freq = {
            a: float(np.average(root_strategy[:, k], weights=trainer.weights[0]))
            for k, a in enumerate(root_actions)
            if a.startswith("bet_")
        }

        for situation, player, history in SCENARIOS:
            if history is None:
                sizes = [a for a, f in bet_freq.items() if f >= 0.03]
                if not sizes:
                    continue
                choice = rng.choices(sizes, weights=[bet_freq[a] for a in sizes], k=1)[0]
                history = (choice,)
            for hand_key, row, actions in deal(trainer, player, history, rng):
                spot = {
                    "id": f"{board_text.replace(' ', '')}-{situation}-{hand_key}",
                    "board": board,
                    "heroPosition": (OOP if player == 0 else IP).value,
                    "villainPosition": (IP if player == 0 else OOP).value,
                    "situation": situation,
                    "potBb": POT_BB,
                    "stackBb": STACK_BB,
                    "hand": [hand_key[:2], hand_key[2:]],
                    "actions": list(actions),
                    "mix": {a: round(float(p), 3) for a, p in zip(actions, row)},
                }
                if situation == "facing_bet":
                    spot["facing"] = history[0]
                spots.append(spot)

    rng.shuffle(spots)
    out = {
        "worstExploitabilityPct": round(worst, 3),
        "decks": [
            {
                "id": "bb-vs-btn-srp-flop",
                "name": "BB vs BTN, single-raised pot",
                "description": (
                    "BTN opened, BB called. Flop decisions for either seat, "
                    "100bb deep, scored against a solved strategy."
                ),
                "spots": spots,
            }
        ],
    }
    path = Path(__file__).resolve().parents[2] / "web" / "src" / "data" / "drill-deck.json"
    path.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {len(spots)} spots to {path} in {time.perf_counter() - started:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
