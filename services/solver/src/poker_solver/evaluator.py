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
scope: postflop_mccfr.py evaluates each player's hand once per iteration and
reuses it, not once per tree node.
"""

from __future__ import annotations

import itertools
from collections import Counter
from collections.abc import Sequence

import numpy as np

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


def evaluate_seven(cards: Sequence[int]) -> Strength:
    """Same result as evaluate_best for exactly 7 cards, in one pass over
    rank/suit counts instead of evaluate_five on all 21 subsets -- several
    times faster, which matters once equity.py is evaluating every combo
    in two whole ranges against hundreds of runouts. evaluate_best stays
    the trusted reference: test_evaluator.py cross-checks this against
    it on random hands and every category's edge cases, so don't trust
    this one on its own if it's ever changed."""
    if len(cards) != 7:
        raise ValueError(f"evaluate_seven needs exactly 7 cards, got {len(cards)}")
    ranks = [card_rank(c) for c in cards]
    suits = [card_suit(c) for c in cards]

    suit_counts = Counter(suits)
    flush_suit, flush_count = suit_counts.most_common(1)[0]
    flush_ranks: list[int] | None = None
    if flush_count >= 5:
        flush_ranks = sorted((r for r, s in zip(ranks, suits) if s == flush_suit), reverse=True)
        sf_high = _straight_high(sorted(set(flush_ranks), reverse=True))
        if sf_high is not None:
            return (STRAIGHT_FLUSH, (sf_high,))

    counts = Counter(ranks)
    # Rank-descending within each multiplicity, so [0] is always the best.
    quads = sorted((r for r, n in counts.items() if n == 4), reverse=True)
    trips = sorted((r for r, n in counts.items() if n == 3), reverse=True)
    pairs = sorted((r for r, n in counts.items() if n == 2), reverse=True)

    if quads:
        q = quads[0]
        return (QUADS, (q, max(r for r in ranks if r != q)))
    if trips and (len(trips) >= 2 or pairs):
        # A second set of trips plays as the pair, if it outranks every pair.
        return (FULL_HOUSE, (trips[0], max(trips[1:] + pairs)))
    if flush_ranks is not None:
        return (FLUSH, tuple(flush_ranks[:5]))
    straight_high = _straight_high(sorted(counts, reverse=True))
    if straight_high is not None:
        return (STRAIGHT, (straight_high,))
    if trips:
        t = trips[0]
        return (TRIPS, (t, *sorted((r for r in ranks if r != t), reverse=True)[:2]))
    if len(pairs) >= 2:
        p1, p2 = pairs[0], pairs[1]
        # A third pair's rank is a legitimate kicker here.
        return (TWO_PAIR, (p1, p2, max(r for r in ranks if r not in (p1, p2))))
    if pairs:
        p = pairs[0]
        return (PAIR, (p, *sorted((r for r in ranks if r != p), reverse=True)[:3]))
    return (HIGH_CARD, tuple(sorted(ranks, reverse=True)[:5]))


# --- Vectorized evaluation --------------------------------------------------
#
# equity.py evaluates every combo in two whole ranges (~1,000 hands) against
# every possible runout (990 on the flop) -- about a million 7-card
# evaluations per solve. Even evaluate_seven is too slow for that one call
# at a time from Python, so this evaluates a whole batch of hands sharing
# one board in a fixed number of numpy operations. Strength comes back as
# a single packed int (pack_strength) so comparing two hands is a plain
# integer comparison -- what lets equity.py compare every pair at once.


def pack_strength(strength: Strength) -> int:
    """(category, tiebreakers) -> one int with the same ordering: category
    in bits 20+, then each tiebreaker as rank-2 (0-12) in a 4-bit nibble,
    most significant first. Every hand in a category has the same number
    of tiebreakers, so left-aligning them preserves order. Also the bridge
    test_evaluator.py uses to check evaluate_seven_batch against
    evaluate_best for exact equality."""
    category, tiebreakers = strength
    score = category << 20
    for i, rank in enumerate(tiebreakers):
        score |= (rank - 2) << (16 - 4 * i)
    return score


def _build_mask_tables() -> tuple[np.ndarray, list[np.ndarray], np.ndarray]:
    """Lookup tables over every 13-bit rank mask (bit r = rank r+2 present):
    popcount, top-k ranks packed right-aligned into k nibbles, and the
    high-card index of the best straight (-1 if none; the wheel's high
    card is the 5, index 3)."""
    size = 1 << 13
    popcount = np.zeros(size, dtype=np.int64)
    top = [np.zeros(size, dtype=np.int64) for _ in range(6)]
    straight_high = np.full(size, -1, dtype=np.int64)
    for mask in range(size):
        bits = [r for r in range(12, -1, -1) if mask >> r & 1]
        popcount[mask] = len(bits)
        for k in range(1, 6):
            packed = 0
            for i in range(k):
                packed = (packed << 4) | (bits[i] if i < len(bits) else 0)
            top[k][mask] = packed
        for high in range(12, 3, -1):
            if all(mask >> (high - offset) & 1 for offset in range(5)):
                straight_high[mask] = high
                break
        else:
            if all(mask >> r & 1 for r in (12, 0, 1, 2, 3)):
                straight_high[mask] = 3
    return popcount, top, straight_high


_POPCOUNT, _TOP, _STRAIGHT_HIGH = _build_mask_tables()
_RANK_BITS = 1 << np.arange(13, dtype=np.int64)


def evaluate_seven_batch(holes: np.ndarray, board: Sequence[int]) -> np.ndarray:
    """holes: (n, 2) int array of hole cards; board: exactly 5 cards none of
    them hold. Returns (n,) int64 scores, equal row-for-row to
    pack_strength(evaluate_best(hole + board)) -- test_evaluator.py checks
    that exactly, on random hands and every category's edge cases."""
    if len(board) != 5:
        raise ValueError(f"evaluate_seven_batch needs a 5-card board, got {len(board)}")
    return evaluate_seven_boards(holes, np.asarray(board, dtype=np.int64)[None, :])[0]


# How many (hand, board) pairs one call to the scorer handles. Big enough that
# numpy's fixed per-call cost (~10 microseconds an operation, ~50 operations)
# is spread over thousands of hands; small enough that the temporaries stay
# in cache.
_BLOCK_HANDS = 24_000


def evaluate_seven_boards(holes: np.ndarray, boards: np.ndarray) -> np.ndarray:
    """holes: (n, 2) hole cards; boards: (B, 5) five-card boards. Returns
    (B, n) int64 scores: row b equals evaluate_seven_batch(holes, boards[b]).

    Scoring many boards in one call is what makes the equity matrix cheap: a
    flop has 990 runouts, and one call per runout spent most of its time on
    fixed numpy overhead (the hands per call were only ~480). As with
    evaluate_seven_batch, a hand sharing a card with its board gets a
    meaningless score -- callers mask those out."""
    n = holes.shape[0]
    boards = np.asarray(boards, dtype=np.int64)
    count = boards.shape[0]

    # One 13-bit rank mask per suit, for each board.
    board_suits = np.zeros((count, 4), dtype=np.int64)
    rows = np.arange(count)
    for col in range(5):
        cards = boards[:, col]
        board_suits[rows, cards % 4] |= np.left_shift(1, cards // 4)

    hole_cards = holes.astype(np.int64)
    hole_suit = hole_cards % 4
    hole_bit = np.left_shift(1, hole_cards // 4)
    hand_rows = np.arange(n)

    out = np.empty((count, n), dtype=np.int64)
    per_block = max(1, _BLOCK_HANDS // max(n, 1))
    for start in range(0, count, per_block):
        stop = min(count, start + per_block)
        block = stop - start
        suit_mask = np.broadcast_to(board_suits[start:stop, None, :], (block, n, 4)).copy()
        for col in (0, 1):
            suit_mask[:, hand_rows, hole_suit[:, col]] |= hole_bit[:, col]
        out[start:stop] = _score_suit_masks(suit_mask.reshape(block * n, 4)).reshape(block, n)
    return out


def _score_suit_masks(suit_mask: np.ndarray) -> np.ndarray:
    """suit_mask: (N, 4) int64, each entry the 13-bit mask of ranks a hand holds
    in that suit (hole cards and board together). Returns (N,) packed scores."""
    a, b, c, d = suit_mask[:, 0], suit_mask[:, 1], suit_mask[:, 2], suit_mask[:, 3]
    presence = a | b | c | d

    # How many suits hold each rank, as a 3-bit counter per rank done with a
    # carry-save adder on the four masks -- instead of expanding to an
    # (N, 4, 13) tensor and summing it. bit0/bit1/bit2 are the counter's bits.
    t1, carry1 = a ^ b, a & b
    t2, carry2 = t1 ^ c, t1 & c
    bit0, carry3 = t2 ^ d, t2 & d
    bit1 = carry1 ^ carry2 ^ carry3
    bit2 = (carry1 & carry2) | (carry1 & carry3) | (carry2 & carry3)
    quad_mask = bit2  # held in all four suits
    trip_mask = bit0 & bit1  # in exactly three
    pair_mask = bit1 & ~bit0 & ~bit2  # in exactly two

    suit_counts = _POPCOUNT[suit_mask]
    flush_mask = np.where(suit_counts >= 5, suit_mask, 0).max(axis=1)  # at most one suit qualifies
    sf_high = _STRAIGHT_HIGH[flush_mask]
    straight_high = _STRAIGHT_HIGH[presence]

    top1, top2, top3, top5 = _TOP[1], _TOP[2], _TOP[3], _TOP[5]
    quad = top1[quad_mask]
    quad_kicker = top1[presence & ~np.left_shift(1, quad)]
    trip = top1[trip_mask]
    other_trips = trip_mask & ~np.left_shift(1, trip)
    full_house_pair = top1[other_trips | pair_mask]
    trips_kickers = top2[presence & ~np.left_shift(1, trip)]
    pair1 = top1[pair_mask]
    pair2 = top1[pair_mask & ~np.left_shift(1, pair1)]
    two_pair_kicker = top1[presence & ~np.left_shift(1, pair1) & ~np.left_shift(1, pair2)]
    pair_kickers = top3[presence & ~np.left_shift(1, pair1)]

    conditions = [
        sf_high >= 0,
        quad_mask != 0,
        (trip_mask != 0) & ((other_trips != 0) | (pair_mask != 0)),
        flush_mask != 0,
        straight_high >= 0,
        trip_mask != 0,
        _POPCOUNT[pair_mask] >= 2,
        pair_mask != 0,
    ]
    choices = [
        (STRAIGHT_FLUSH << 20) | (sf_high << 16),
        (QUADS << 20) | (quad << 16) | (quad_kicker << 12),
        (FULL_HOUSE << 20) | (trip << 16) | (full_house_pair << 12),
        (FLUSH << 20) | top5[flush_mask],
        (STRAIGHT << 20) | (straight_high << 16),
        (TRIPS << 20) | (trip << 16) | (trips_kickers << 8),
        (TWO_PAIR << 20) | (pair1 << 16) | (pair2 << 12) | (two_pair_kicker << 8),
        (PAIR << 20) | (pair1 << 16) | (pair_kickers << 4),
    ]
    return np.select(conditions, choices, default=top5[presence])
