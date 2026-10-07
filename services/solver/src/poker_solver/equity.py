"""Precomputes a hero-combo x villain-combo equity matrix for a board --
the ingredient range_mccfr.py's terminal values need so that hole cards
never get Monte-Carlo-sampled inside the CFR loop (that sampling was the
actual cause of the "garbage jam frequencies" bug -- see
docs/decisions.md's 2026-10-07 entry). Every serious range-vs-range
solver computes equity once per board up front rather than re-deriving
it stochastically across thousands of CFR iterations.

Always exact: every possible runout is enumerated (990 on the flop, 44
on the turn, none on the river). Sampling runouts was tried first and
rejected on measured error -- with shared runouts, a drawing hand's
equity against the *whole* opposing range was still off by ~4% at 500
samples, because a lucky sample is wrong against every opponent combo
at once rather than averaging out. Exact enumeration became affordable
once hand evaluation was vectorized (evaluator.evaluate_seven_batch).

Cell [i][j] is hero combo i's equity (1.0 win / 0.5 tie / 0.0 lose,
averaged over every runout where both hands are live) against villain
combo j. NaN where the pair shares a physical card -- a distinct case
from 0.0 equity, and every caller must treat it as "exclude this pair,"
never "hero loses."
"""

from __future__ import annotations

import itertools

import numpy as np

from .cards import FULL_DECK
from .combos import Combo
from .evaluator import evaluate_seven_batch


def card_membership(combos: list[Combo]) -> np.ndarray:
    """(len(combos), 52) 0/1 matrix: row i marks combo i's two cards."""
    m = np.zeros((len(combos), 52), dtype=np.int32)
    for i, (a, b) in enumerate(combos):
        m[i, a] = m[i, b] = 1
    return m


def collision_mask(combos0: list[Combo], combos1: list[Combo]) -> np.ndarray:
    """True where a combo0/combo1 pair shares a physical card -- those
    pairs can never both be live hands at once, independent of runout.
    One matrix product instead of a pairwise Python loop."""
    return (card_membership(combos0) @ card_membership(combos1).T) > 0


def compute_equity_matrix(
    combos0: list[Combo], combos1: list[Combo], board: tuple[int, ...]
) -> np.ndarray:
    """board may be 3 (flop), 4 (turn), or 5 (river) cards. Both combo
    lists must already exclude anything colliding with the board itself
    (combos.expand_range_to_combos' `blocked` does that)."""
    if len(board) not in (3, 4, 5):
        raise ValueError(f"board must be 3, 4, or 5 cards, got {len(board)}")

    holes0 = np.array(combos0, dtype=np.int64).reshape(-1, 2)
    holes1 = np.array(combos1, dtype=np.int64).reshape(-1, 2)
    member0, member1 = card_membership(combos0), card_membership(combos1)
    pair_ok = ~collision_mask(combos0, combos1)

    available = [c for c in FULL_DECK if c not in frozenset(board)]
    shape = (len(combos0), len(combos1))
    win = np.zeros(shape, dtype=np.int32)
    tie = np.zeros(shape, dtype=np.int32)
    count = np.zeros(shape, dtype=np.int32)

    for runout in itertools.combinations(available, 5 - len(board)):
        full_board = board + runout
        # A hand holding one of this runout's cards can't exist alongside
        # it -- excluded for this runout only, which is why `count` (each
        # pair's own denominator) varies slightly from pair to pair.
        runout_idx = list(runout)
        live0 = member0[:, runout_idx].sum(axis=1) == 0 if runout_idx else np.ones(len(combos0), bool)
        live1 = member1[:, runout_idx].sum(axis=1) == 0 if runout_idx else np.ones(len(combos1), bool)
        scores0 = evaluate_seven_batch(holes0, full_board)
        scores1 = evaluate_seven_batch(holes1, full_board)

        valid = live0[:, None] & live1[None, :] & pair_ok
        count += valid
        win += (scores0[:, None] > scores1[None, :]) & valid
        tie += (scores0[:, None] == scores1[None, :]) & valid

    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(count > 0, (win + tie / 2) / count, np.nan)
