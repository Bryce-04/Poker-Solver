"""Turns a HandRange-shaped dict (169-type label like "AKs", or a specific
combo like "AhKh" -> weight) into
concrete, board-aware 2-card combos to sample from during MCCFR.

range_notation.py (apps/api) expands range-notation SHORTHAND ("A2s+") into
169-type labels -- a different job from this module, which expands a
169-type label into actual suited card pairs and removes anything that
collides with the board.
"""

from __future__ import annotations

import bisect
import random
from collections.abc import Sequence

from .cards import FULL_DECK, RANKS, card_str, card_suit, parse_card

Combo = tuple[int, int]


def label_to_combos(label: str) -> list[Combo]:
    """'AA' -> 6 combos, 'AKs' -> 4, 'AKo' -> 12."""
    if len(label) == 2:
        rank_char = label[0]
        if rank_char not in RANKS or label[1] != rank_char:
            raise ValueError(f"not a hand label: {label!r}")
        rank_idx = RANKS.index(rank_char) * 4
        return [(rank_idx + a, rank_idx + b) for a in range(4) for b in range(a + 1, 4)]

    if len(label) != 3 or label[2] not in "so":
        raise ValueError(f"not a hand label: {label!r}")
    high_char, low_char, suited_flag = label[0], label[1], label[2] == "s"
    if high_char not in RANKS or low_char not in RANKS or high_char == low_char:
        raise ValueError(f"not a hand label: {label!r}")
    high_idx, low_idx = RANKS.index(high_char) * 4, RANKS.index(low_char) * 4

    if suited_flag:
        return [(high_idx + s, low_idx + s) for s in range(4)]
    return [
        (high_idx + hs, low_idx + ls)
        for hs in range(4)
        for ls in range(4)
        if hs != ls
    ]


def combo_key(combo: Combo) -> str:
    """The canonical specific-combo range key: 'AhKh', higher card first."""
    high, low = max(combo), min(combo)
    return card_str(high) + card_str(low)


def combo_label(combo: Combo) -> str:
    """The 169-type label a concrete combo belongs to: (Ah, Kh) -> 'AKs'."""
    a, b = sorted(combo, reverse=True)
    ra, rb = a // 4, b // 4  # indexes into RANKS
    if ra == rb:
        return RANKS[ra] * 2
    return RANKS[ra] + RANKS[rb] + ("s" if card_suit(a) == card_suit(b) else "o")


def key_to_combos(key: str) -> list[Combo]:
    """A range key to its concrete combos: a 169-type label ('AKs') expands
    to all its combos, a specific-combo key ('AhKh') to exactly that one."""
    if len(key) == 4:
        try:
            first, second = parse_card(key[:2]), parse_card(key[2:])
        except ValueError as e:
            raise ValueError(f"not a hand label or combo: {key!r}") from e
        if first == second:
            raise ValueError(f"not a hand label or combo (same card twice): {key!r}")
        return [(max(first, second), min(first, second))]
    return label_to_combos(key)


def expand_range(
    range_weights: dict[str, float],
    blocked: frozenset[int] = frozenset(),
) -> list[tuple[Combo, float, str]]:
    """A HandRange-shaped dict to (combo, weight, 169-label) triples.

    Keys are 169-type labels ('AKs', which sets every combo of that label)
    and/or specific combos ('AhKh'). A specific-combo key overrides its
    label's weight for that one combo regardless of dict order -- so a
    range can be 'all of AKs except the heart combo' ({'AKs': 1, 'AhKh':
    0}) or 'only the nut flush draw' ({'AhKh': 1}). Zero-weight and
    board-blocked combos are dropped."""
    by_combo: dict[Combo, float] = {}
    for key, weight in range_weights.items():
        if len(key) != 4:
            for combo in label_to_combos(key):
                by_combo[combo] = weight
    for key, weight in range_weights.items():
        if len(key) == 4:
            by_combo[key_to_combos(key)[0]] = weight
    return [
        (combo, weight, combo_label(combo))
        for combo, weight in by_combo.items()
        if weight > 0 and combo[0] not in blocked and combo[1] not in blocked
    ]


def expand_range_to_combos(
    range_weights: dict[str, float],
    blocked: frozenset[int] = frozenset(),
) -> list[tuple[Combo, float]]:
    """expand_range without the labels: (combo, weight) pairs."""
    return [(combo, weight) for combo, weight, _ in expand_range(range_weights, blocked)]


class WeightedRangeSampler:
    """Precomputed cumulative-weight sampler over a fixed combo list, built
    once per (range, board) and reused across every MCCFR iteration."""

    def __init__(self, weighted_combos: Sequence[tuple[Combo, float]]) -> None:
        if not weighted_combos:
            raise ValueError("range has no combos left after removing blocked cards")
        self._combos = [combo for combo, _ in weighted_combos]
        cumulative: list[float] = []
        running = 0.0
        for _, weight in weighted_combos:
            running += weight
            cumulative.append(running)
        self._cumulative = cumulative
        self._total = running

    def sample(self, rng: random.Random) -> Combo:
        target = rng.random() * self._total
        index = bisect.bisect_left(self._cumulative, target)
        # Floating-point edge case: target can land exactly on (or a hair
        # past, due to rounding) the last cumulative value.
        index = min(index, len(self._combos) - 1)
        return self._combos[index]


def sample_deal(
    sampler0: WeightedRangeSampler,
    sampler1: WeightedRangeSampler,
    rng: random.Random,
    max_attempts: int = 100,
) -> tuple[Combo, Combo]:
    """Rejection-samples a (p0, p1) combo pair sharing no card. Board
    collisions are already excluded when each sampler was built (blocked=
    board cards), so only mutual p0-vs-p1 overlap needs a redraw here --
    redrawing on collision is exact for the distribution conditioned on "no
    overlap," unlike reweighting after the fact, which would need care not
    to bias the result."""
    for _ in range(max_attempts):
        hand0 = sampler0.sample(rng)
        hand1 = sampler1.sample(rng)
        if not (set(hand0) & set(hand1)):
            return hand0, hand1
    raise RuntimeError(
        "couldn't find a non-colliding deal after "
        f"{max_attempts} attempts -- ranges likely overlap almost entirely"
    )


def deal_runout(blocked: frozenset[int], count: int, rng: random.Random) -> tuple[int, ...]:
    """Deals `count` unique cards uniformly at random from the deck, for
    completing a board that isn't at the river yet (flop needs 2 more
    cards, turn needs 1, river needs 0). `blocked` is every card already
    spoken for this iteration -- the known board plus both players'
    sampled hole cards -- so the runout can never collide with them."""
    available = [c for c in FULL_DECK if c not in blocked]
    return tuple(rng.sample(available, count))
