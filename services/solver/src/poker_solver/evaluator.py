"""A pure-Python poker hand evaluator: rank a 5-card hand, or find the best
5 of an arbitrary number of cards (used for the 7-card hole+board case).

Strength is a (category, tiebreakers) tuple -- directly comparable with
</>/== via normal tuple comparison, since category dominates and
tiebreakers are already ordered highest-significance-first. Categories,
high to low:

    8 straight flush   5 flush        2 two pair    (see _rank_counts_key
    7 quads            4 straight     1 pair         for why the count-
    6 full house       3 trips        0 high card    based ones share code)

This brute-forces the 21 5-card subsets of a 7-card hand rather than using
a lookup table -- simple and obviously correct. Fine for this engine's
scope: river_mccfr.py evaluates each player's hand once per iteration and
reuses it, not once per tree node.
"""

from __future__ import annotations

import itertools
from collections import Counter
from collections.abc import Sequence

from .cards import card_rank, card_suit

STRAIGHT_FLUSH, QUADS, FULL_HOUSE, FLUSH, STRAIGHT, TRIPS, TWO_PAIR, PAIR, HIGH_CARD = (
    8,
    7,
    6,
    5,
    4,
    3,
    2,
    1,
    0,
)

Strength = tuple[int, tuple[int, ...]]


def _straight_high(distinct_ranks_desc: list[int]) -> int | None:
    """distinct_ranks_desc: unique ranks, descending. Returns the high card
    of a straight found among them, if any -- checking every 5-in-a-row
    window, plus the wheel (A-5-4-3-2, where the straight's "high" card is
    the 5, not the ace)."""
    ranks = set(distinct_ranks_desc)
    if {14, 5, 4, 3, 2} <= ranks:
        wheel_high = 5
    else:
        wheel_high = None
    for high in distinct_ranks_desc:
        if all((high - offset) in ranks for offset in range(5)):
            return high
    return wheel_high


def evaluate_five(cards: Sequence[int]) -> Strength:
    if len(cards) != 5:
        raise ValueError(f"evaluate_five needs exactly 5 cards, got {len(cards)}")

    ranks = [card_rank(c) for c in cards]
    suits = [card_suit(c) for c in cards]
    is_flush = len(set(suits)) == 1

    distinct_desc = sorted(set(ranks), reverse=True)
    straight_high = _straight_high(distinct_desc)

    if is_flush and straight_high is not None:
        return (STRAIGHT_FLUSH, (straight_high,))

    # Group by count then rank, both descending -- this ordering IS the
    # tiebreaker tuple for every count-based category below, generically:
    # quads' one four-of-a-kind rank outranks any kicker, full house's
    # trip rank outranks its pair rank, two pair's higher pair outranks
    # the lower, etc. No per-category kicker logic needed.
    counts = Counter(ranks)
    ordered_ranks = tuple(
        rank for rank, _ in sorted(counts.items(), key=lambda item: (item[1], item[0]), reverse=True)
    )
    count_pattern = tuple(sorted(counts.values(), reverse=True))

    if count_pattern == (4, 1):
        return (QUADS, ordered_ranks)
    if count_pattern == (3, 2):
        return (FULL_HOUSE, ordered_ranks)
    if is_flush:
        return (FLUSH, tuple(sorted(ranks, reverse=True)))
    if straight_high is not None:
        return (STRAIGHT, (straight_high,))
    if count_pattern == (3, 1, 1):
        return (TRIPS, ordered_ranks)
    if count_pattern == (2, 2, 1):
        return (TWO_PAIR, ordered_ranks)
    if count_pattern == (2, 1, 1, 1):
        return (PAIR, ordered_ranks)
    return (HIGH_CARD, tuple(sorted(ranks, reverse=True)))


def evaluate_best(cards: Sequence[int]) -> Strength:
    """Best 5-of-N via evaluate_five over every 5-card subset. N is 5 or 7
    in this engine (5 = no hole cards relevant, 7 = 2 hole + 5 board)."""
    if len(cards) < 5:
        raise ValueError(f"evaluate_best needs at least 5 cards, got {len(cards)}")
    return max(evaluate_five(combo) for combo in itertools.combinations(cards, 5))
