import random

import pytest

from poker_solver.cards import card_rank, card_suit, parse_card
from poker_solver.combos import (
    WeightedRangeSampler,
    expand_range_to_combos,
    label_to_combos,
    sample_deal,
)


def test_pair_has_six_combos() -> None:
    combos = label_to_combos("AA")
    assert len(combos) == 6
    for a, b in combos:
        assert card_rank(a) == card_rank(b) == 14
        assert card_suit(a) != card_suit(b)


def test_suited_has_four_combos() -> None:
    combos = label_to_combos("AKs")
    assert len(combos) == 4
    for a, b in combos:
        assert {card_rank(a), card_rank(b)} == {14, 13}
        assert card_suit(a) == card_suit(b)


def test_offsuit_has_twelve_combos() -> None:
    combos = label_to_combos("AKo")
    assert len(combos) == 12
    for a, b in combos:
        assert {card_rank(a), card_rank(b)} == {14, 13}
        assert card_suit(a) != card_suit(b)


def test_label_to_combos_rejects_garbage() -> None:
    for bad in ["A", "AKx", "Z9s", "AA "]:
        with pytest.raises(ValueError):
            label_to_combos(bad)


def test_expand_range_drops_blocked_combos() -> None:
    blocked = frozenset([parse_card("As")])
    weighted = expand_range_to_combos({"AA": 1.0}, blocked=blocked)
    # 6 combos total, 3 of them touch the blocked ace of spades.
    assert len(weighted) == 3
    for (a, b), weight in weighted:
        assert parse_card("As") not in (a, b)
        assert weight == 1.0


def test_expand_range_drops_zero_weight_labels() -> None:
    weighted = expand_range_to_combos({"AA": 1.0, "72o": 0.0})
    labels_present = {tuple(sorted((card_rank(a), card_rank(b)))) for (a, b), _ in weighted}
    assert labels_present == {(14, 14)}


def test_sampler_respects_weights_roughly() -> None:
    # Two labels, one weighted 3x the other -- over many draws, the
    # heavier one should come up roughly 3x as often. Generous tolerance;
    # this is a sanity check, not a statistical proof.
    weighted = expand_range_to_combos({"AA": 1.0, "KK": 3.0})
    sampler = WeightedRangeSampler(weighted)
    rng = random.Random(0)
    counts = {14: 0, 13: 0}
    for _ in range(4000):
        a, b = sampler.sample(rng)
        counts[card_rank(a)] += 1
    ratio = counts[13] / counts[14]
    assert 2.0 < ratio < 4.0


def test_sample_deal_never_collides() -> None:
    sampler0 = WeightedRangeSampler(expand_range_to_combos({"AA": 1.0}))
    sampler1 = WeightedRangeSampler(expand_range_to_combos({"AKo": 1.0}))
    rng = random.Random(0)
    for _ in range(2000):
        hand0, hand1 = sample_deal(sampler0, sampler1, rng)
        assert not (set(hand0) & set(hand1))


def test_sampler_rejects_empty_range() -> None:
    with pytest.raises(ValueError):
        WeightedRangeSampler([])
