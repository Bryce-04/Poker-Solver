"""Validates deal_runout + evaluate_best together on a genuinely uncertain
equity matchup -- independent of CFR/game theory entirely. The MCCFR
regression tests (test_postflop_mccfr.py) pick *locked* hands specifically
so the runout can't change the outcome, which proves the betting logic
survives a shorter board but doesn't exercise the interesting case where
the runout actually matters. This file is where that rigor lives instead:
a classic flush-draw-vs-overpair flop, checked against the EXACT equity
from brute-force enumeration (only 45 cards remain with 2 to come --
C(45,2) = 990 runouts, fully enumerable), not just "did sampling converge
to something plausible."
"""

import itertools
import random

from poker_solver.cards import FULL_DECK, parse_card
from poker_solver.combos import deal_runout
from poker_solver.evaluator import evaluate_best

BOARD = tuple(parse_card(c) for c in ["2c", "7d", "Jh"])
HERO = (parse_card("Ah"), parse_card("Kh"))  # nut flush draw + two overcards
VILLAIN = (parse_card("Qd"), parse_card("Qc"))  # an overpair


def _exact_equity(hero: tuple[int, int], villain: tuple[int, int], board: tuple[int, ...]) -> float:
    blocked = frozenset(board) | set(hero) | set(villain)
    remaining = [c for c in FULL_DECK if c not in blocked]
    wins = ties = total = 0
    for runout in itertools.combinations(remaining, 5 - len(board)):
        full_board = board + runout
        hero_strength = evaluate_best(hero + full_board)
        villain_strength = evaluate_best(villain + full_board)
        total += 1
        if hero_strength > villain_strength:
            wins += 1
        elif hero_strength == villain_strength:
            ties += 1
    return (wins + ties / 2) / total


def test_exact_equity_lands_in_the_expected_flush_draw_range() -> None:
    # Sanity check on the scenario itself, not just the mechanism: a
    # flush draw plus two overcards against an overpair is a real,
    # meaningfully-uncertain equity spot (comes out to ~29% here) -- a
    # wide band just confirms we built a genuine draw, not a lock or a
    # drawing-dead hand.
    equity = _exact_equity(HERO, VILLAIN, BOARD)
    assert 0.20 < equity < 0.40


def test_monte_carlo_runout_matches_exact_equity() -> None:
    exact = _exact_equity(HERO, VILLAIN, BOARD)

    blocked = frozenset(BOARD) | set(HERO) | set(VILLAIN)
    rng = random.Random(0)
    wins = ties = 0
    iterations = 20_000
    for _ in range(iterations):
        runout = deal_runout(blocked, 5 - len(BOARD), rng)
        full_board = BOARD + runout
        hero_strength = evaluate_best(HERO + full_board)
        villain_strength = evaluate_best(VILLAIN + full_board)
        if hero_strength > villain_strength:
            wins += 1
        elif hero_strength == villain_strength:
            ties += 1
    sampled = (wins + ties / 2) / iterations

    assert abs(sampled - exact) < 0.02


def test_deal_runout_on_the_turn_needs_only_one_card() -> None:
    turn_board = BOARD + (parse_card("3s"),)
    blocked = frozenset(turn_board) | set(HERO) | set(VILLAIN)
    rng = random.Random(0)
    river_card = deal_runout(blocked, 1, rng)
    assert len(river_card) == 1
    assert river_card[0] not in blocked
