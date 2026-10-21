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
from collections import OrderedDict

import numpy as np

from .cards import FULL_DECK
from .combos import Combo
from .evaluator import evaluate_seven_boards


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


# A dead hand (one holding a card of the runout being scored) can't exist
# alongside it. Rather than masking every comparison, a dead hero hand is scored
# below any real hand and a dead villain hand above any: then it can neither
# win nor tie against anything, and the comparisons need no mask at all.
_DEAD_HERO = -1
_DEAD_VILLAIN = 1 << 40


# The matrix depends only on the board and the two combo lists, and a user
# re-solving a spot (another bet size, one more action, reopening a saved
# spot) changes neither -- so the last few are kept. Bounded by BYTES, not
# entries: a wide river matrix is ~14 MB, and this runs on a small free-tier host.
_CACHE_MAX_BYTES = 64 * 1024 * 1024
_cache: OrderedDict[tuple, np.ndarray] = OrderedDict()


def compute_equity_matrix(
    combos0: list[Combo], combos1: list[Combo], board: tuple[int, ...]
) -> np.ndarray:
    """The equity matrix (see _compute_equity_matrix), from a small cache of
    recent ones. The array returned is read-only: it may be shared."""
    key = (tuple(board), tuple(combos0), tuple(combos1))
    cached = _cache.get(key)
    if cached is not None:
        _cache.move_to_end(key)
        return cached
    matrix = _compute_equity_matrix(combos0, combos1, board)
    matrix.flags.writeable = False
    _cache[key] = matrix
    while len(_cache) > 1 and sum(m.nbytes for m in _cache.values()) > _CACHE_MAX_BYTES:
        _cache.popitem(last=False)
    return matrix


def _compute_equity_matrix(
    combos0: list[Combo], combos1: list[Combo], board: tuple[int, ...]
) -> np.ndarray:
    """board may be 3 (flop), 4 (turn), or 5 (river) cards. Both combo
    lists must already exclude anything colliding with the board itself
    (combos.expand_range_to_combos' `blocked` does that).

    Cost structure (profiled, docs/decisions.md 2026-10-21): the flop's 990
    runouts times a ~500x500 pairwise comparison is the whole bill. So every
    runout is scored in big blocks (evaluator.evaluate_seven_boards), dead
    hands are handled by sentinel scores instead of per-comparison masks, and
    each pair's denominator -- how many runouts leave both hands alive -- is
    one matrix product of the two ranges' liveness tables, not accumulated a
    comparison at a time."""
    if len(board) not in (3, 4, 5):
        raise ValueError(f"board must be 3, 4, or 5 cards, got {len(board)}")

    holes0 = np.array(combos0, dtype=np.int64).reshape(-1, 2)
    holes1 = np.array(combos1, dtype=np.int64).reshape(-1, 2)
    member0, member1 = card_membership(combos0), card_membership(combos1)
    pair_ok = ~collision_mask(combos0, combos1)

    available = [c for c in FULL_DECK if c not in frozenset(board)]
    width = 5 - len(board)
    if width == 0:  # the river: one "runout" with no cards
        runouts = np.zeros((1, 0), dtype=np.int64)
    else:
        runouts = np.array(list(itertools.combinations(available, width)), dtype=np.int64)
    boards = np.hstack([np.tile(np.array(board, dtype=np.int64), (len(runouts), 1)), runouts])

    # live[i, r]: combo i holds none of runout r's cards. A (combos x 52) by
    # (52 x runouts) product of 0/1 tables counts the cards held in common.
    runout_cards = np.zeros((len(runouts), 52), dtype=np.int32)
    np.put_along_axis(runout_cards, runouts, 1, axis=1)
    live0 = (member0 @ runout_cards.T) == 0  # (n0, R)
    live1 = (member1 @ runout_cards.T) == 0  # (n1, R)

    scores0 = np.where(live0.T, evaluate_seven_boards(holes0, boards), _DEAD_HERO)  # (R, n0)
    scores1 = np.where(live1.T, evaluate_seven_boards(holes1, boards), _DEAD_VILLAIN)  # (R, n1)

    # Wins and ties summed over runouts. int16 holds up to 32,767 runouts
    # (there are at most 990), and keeps the accumulators in cache.
    shape = (len(combos0), len(combos1))
    win = np.zeros(shape, dtype=np.int16)
    tie = np.zeros(shape, dtype=np.int16)
    for hero, villain in zip(scores0, scores1):
        win += hero[:, None] > villain[None, :]
        tie += hero[:, None] == villain[None, :]

    # Runouts where BOTH hands are alive (and the pair doesn't share a card).
    count = (live0.astype(np.float32) @ live1.T.astype(np.float32)).round().astype(np.int32) * pair_ok

    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(count > 0, (win + tie / 2) / count, np.nan)
