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

from poker_solver.betting_round import BET_SIZE_MENU
from poker_solver.cards import parse_card
from poker_solver.combos import combo_key
from poker_solver.equity import compute_equity_matrix
from poker_solver.range_cfr import RangeCfrTrainer, RangeSpotConfig
from poker_solver_schema import Position

from app.drill_analysis import AnalysisInput, describe_board, describe_hand, explain
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


class EquityFacts:
    """Per-board equity numbers the explanations quote, from the same exact
    equity matrix the solver trains on (recomputed here; the trainer keeps it
    private). eq[p][i] is player p's combo i equity against the other player's
    whole (weighted) range."""

    def __init__(self, trainer: RangeCfrTrainer, board: tuple[int, ...]) -> None:
        matrix = compute_equity_matrix(trainer.combos[0], trainer.combos[1], board)
        possible = (~np.isnan(matrix)).astype(np.float64)
        win0 = np.where(np.isnan(matrix), 0.0, matrix)
        w0, w1 = trainer.weights
        self.weights = (w0, w1)
        self.eq = (
            (win0 @ w1) / (possible @ w1),
            ((possible - win0).T @ w0) / (possible.T @ w0),
        )
        range0 = float(w0 @ win0 @ w1) / float(w0 @ possible @ w1)
        self.range_equity = (range0, 1.0 - range0)

    def percentile(self, player: int, index: int) -> float:
        """Share of the player's range (by weight) this combo beats on equity,
        counting ties as half."""
        eq, w = self.eq[player], self.weights[player]
        mine = eq[index]
        below = float(w[eq < mine - 1e-9].sum()) + 0.5 * float(w[np.abs(eq - mine) <= 1e-9].sum())
        return below / float(w.sum())


BET_FRACTION = {label: frac for frac, label in BET_SIZE_MENU}


def analyze(
    trainer: RangeCfrTrainer,
    facts: EquityFacts,
    board: tuple[int, ...],
    player: int,
    index: int,
    history: tuple[str, ...],
    mix: dict[str, float],
    facing: str | None,
) -> dict:
    """The "why" for one dealt hand -- see app/drill_analysis.py for what it is
    and is not. Returns the bullets plus the compact facts the UI shows."""
    hero = (OOP if player == 0 else IP).value
    villain = (IP if player == 0 else OOP).value
    hole = trainer.combos[player][index]
    profile = describe_hand((hole[0], hole[1]), board)
    texture = describe_board(board)
    actions, strategy = trainer.average_strategy(history)
    range_mix = {
        a: float(np.average(strategy[:, k], weights=trainer.weights[player]))
        for k, a in enumerate(actions)
    }
    equity = float(facts.eq[player][index])
    percentile = facts.percentile(player, index)
    bullets = explain(
        AnalysisInput(
            hero=hero,
            villain=villain,
            facing_bet=facing is not None,
            mix=mix,
            profile=profile,
            texture=texture,
            equity=equity,
            percentile=percentile,
            hero_range_equity=facts.range_equity[player],
            range_mix=range_mix,
            pot_bb=POT_BB,
            bet_bb=BET_FRACTION[facing] * POT_BB if facing else 0.0,
        )
    )
    return {
        "bullets": bullets,
        "facts": {
            "hand": profile.label,
            "draws": list(profile.draws),
            "board": texture.label,
            "equityPct": round(equity * 100),
            "rangePercentile": round(percentile * 100),
            "rangeEquityPct": round(facts.range_equity[player] * 100),
        },
    }


def deal(
    trainer: RangeCfrTrainer,
    player: int,
    history: tuple[str, ...],
    rng: random.Random,
) -> list[tuple[int, str, np.ndarray, tuple[str, ...]]]:
    """Hands for one decision: [(combo_index, hand_key, strategy_row, actions)]."""
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
    return [(i, combo_key(combos[i]), strategy[i], actions) for i in picked]


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
        facts = EquityFacts(trainer, tuple(parse_card(c) for c in board))
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
            for index, hand_key, row, actions in deal(trainer, player, history, rng):
                mix = {a: round(float(p), 3) for a, p in zip(actions, row)}
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
                    "mix": mix,
                }
                if situation == "facing_bet":
                    spot["facing"] = history[0]
                spot["analysis"] = analyze(
                    trainer,
                    facts,
                    tuple(parse_card(c) for c in board),
                    player,
                    index,
                    history,
                    {a: float(p) for a, p in zip(actions, row)},
                    history[0] if situation == "facing_bet" else None,
                )
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
