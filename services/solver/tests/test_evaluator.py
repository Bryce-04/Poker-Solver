import pytest

from poker_solver.cards import parse_card
from poker_solver.evaluator import (
    FLUSH,
    FULL_HOUSE,
    HIGH_CARD,
    PAIR,
    QUADS,
    STRAIGHT,
    STRAIGHT_FLUSH,
    TRIPS,
    TWO_PAIR,
    evaluate_best,
    evaluate_five,
)


def hand(text: str) -> list[int]:
    """'As Kd Qh Jc Ts' -> list of cards."""
    return [parse_card(t) for t in text.split()]


def test_high_card() -> None:
    category, _ = evaluate_five(hand("As Kd Qh Jc 9s"))
    assert category == HIGH_CARD


def test_pair() -> None:
    category, _ = evaluate_five(hand("As Ad Qh Jc 9s"))
    assert category == PAIR


def test_two_pair() -> None:
    category, tiebreak = evaluate_five(hand("As Ad Qh Qc 9s"))
    assert category == TWO_PAIR
    assert tiebreak == (14, 12, 9)  # aces, then queens, then the 9 kicker


def test_trips() -> None:
    category, _ = evaluate_five(hand("As Ad Ah Jc 9s"))
    assert category == TRIPS


def test_straight() -> None:
    category, tiebreak = evaluate_five(hand("9s Td Jh Qc Ks"))
    assert category == STRAIGHT
    assert tiebreak == (13,)


def test_wheel_straight() -> None:
    """A-2-3-4-5 is a straight with the 5 (not the ace) as the high card."""
    category, tiebreak = evaluate_five(hand("As 2d 3h 4c 5s"))
    assert category == STRAIGHT
    assert tiebreak == (5,)


def test_flush() -> None:
    category, tiebreak = evaluate_five(hand("As Ks 9s 5s 2s"))
    assert category == FLUSH
    assert tiebreak == (14, 13, 9, 5, 2)


def test_full_house() -> None:
    category, tiebreak = evaluate_five(hand("As Ad Ah 9c 9s"))
    assert category == FULL_HOUSE
    assert tiebreak == (14, 9)


def test_quads() -> None:
    category, tiebreak = evaluate_five(hand("As Ad Ah Ac 9s"))
    assert category == QUADS
    assert tiebreak == (14, 9)


def test_steel_wheel_straight_flush() -> None:
    category, tiebreak = evaluate_five(hand("As 2s 3s 4s 5s"))
    assert category == STRAIGHT_FLUSH
    assert tiebreak == (5,)


def test_straight_flush_beats_quads() -> None:
    sf = evaluate_five(hand("9s Ts Js Qs Ks"))
    quads = evaluate_five(hand("As Ad Ah Ac Ks"))
    assert sf > quads


def test_kicker_breaks_tie_within_same_category() -> None:
    top_pair_good_kicker = evaluate_five(hand("As Ad Kh Qc 9s"))
    top_pair_bad_kicker = evaluate_five(hand("As Ad Kh 8c 2s"))
    assert top_pair_good_kicker > top_pair_bad_kicker


def test_evaluate_five_rejects_wrong_count() -> None:
    with pytest.raises(ValueError):
        evaluate_five(hand("As Kd Qh"))


def test_evaluate_best_plays_the_board() -> None:
    # Board itself is a straight; hole cards don't improve it -- both
    # players should land on the same board-straight strength regardless
    # of their (irrelevant) hole cards.
    board = hand("9s Td Jh Qc Ks")
    hero = evaluate_best(hand("2c 7d") + board)
    villain = evaluate_best(hand("3h 8s") + board)
    assert hero == villain
    assert hero[0] == STRAIGHT


def test_evaluate_best_uses_hole_cards_when_better() -> None:
    board = hand("9s Td Jh 2c 3s")
    with_pair = evaluate_best(hand("9d 9h") + board)  # trips on the board
    without = evaluate_best(hand("4c 5d") + board)  # just board high card
    assert with_pair > without


# --- evaluate_seven: a fast path that must agree with evaluate_best
# exactly, since equity.py trusts it in place of the brute-force version.

import random as _random

from poker_solver.evaluator import evaluate_seven


@pytest.mark.parametrize(
    "text",
    [
        "As Ks Qs Js Ts 2d 3c",  # royal flush
        "5h 4h 3h 2h Ah Kd Qc",  # steel wheel -- SF high is 5, not ace
        "9h 8h 7h 6h 5h 4h 3h",  # seven-card straight flush: high 9
        "Ah Kh Qh Jh 9h Ts 2c",  # flush AND a straight, not a straight flush
        "Ac Ad Ah As Kc Kd 2s",  # quads; kicker from the pair, not a 2
        "Kc Kd Kh 3c 3d 3h 2s",  # two sets of trips -> full house K over 3
        "3c 3d 3h Ac Ad Kc Kd",  # trips + two pairs: 3s full of aces
        "Ac Ad Kc Kd Qc Qd 2s",  # three pairs: kicker is the third pair's Q
        "Ac Ad Ah 7c 4d 3h 2s",  # trips, two kickers
        "Ac Ad 9c 7d 5h 3c 2s",  # pair, three kickers
        "Ac Kd 9c 7d 5h 3c 2s",  # high card
        "Ac 2d 3c 4d 5h 9c Ts",  # wheel straight
        "6c 2d 3c 4d 5h Ac Ts",  # 6-high straight beats the wheel in the same cards
        "Ah 9h 7h 5h 3h 2h Kc",  # six-card flush: top five only
        "Kc Kd Kh Ks Ac Ad Ah",  # quads with trips aside: kicker A
    ],
)
def test_evaluate_seven_matches_evaluate_best_on_edge_cases(text: str) -> None:
    cards = hand(text)
    assert evaluate_seven(cards) == evaluate_best(cards)


def test_evaluate_seven_matches_evaluate_best_on_random_hands() -> None:
    rng = _random.Random(0)
    deck = list(range(52))
    for _ in range(20_000):
        cards = rng.sample(deck, 7)
        assert evaluate_seven(cards) == evaluate_best(cards), cards


def test_evaluate_seven_rejects_wrong_count() -> None:
    with pytest.raises(ValueError):
        evaluate_seven(hand("As Ks Qs Js Ts"))


# --- evaluate_seven_batch: packed int scores that must equal
# pack_strength(evaluate_best(...)) exactly, row for row.

import numpy as _np

from poker_solver.evaluator import evaluate_seven_batch, pack_strength

_EDGE_CASES = [
    "As Ks Qs Js Ts 2d 3c",
    "5h 4h 3h 2h Ah Kd Qc",
    "9h 8h 7h 6h 5h 4h 3h",
    "Ah Kh Qh Jh 9h Ts 2c",
    "Ac Ad Ah As Kc Kd 2s",
    "Kc Kd Kh 3c 3d 3h 2s",
    "3c 3d 3h Ac Ad Kc Kd",
    "Ac Ad Kc Kd Qc Qd 2s",
    "Ac Ad Ah 7c 4d 3h 2s",
    "Ac Ad 9c 7d 5h 3c 2s",
    "Ac Kd 9c 7d 5h 3c 2s",
    "Ac 2d 3c 4d 5h 9c Ts",
    "6c 2d 3c 4d 5h Ac Ts",
    "Ah 9h 7h 5h 3h 2h Kc",
    "Kc Kd Kh Ks Ac Ad Ah",
]


@pytest.mark.parametrize("text", _EDGE_CASES)
def test_batch_matches_evaluate_best_on_edge_cases(text: str) -> None:
    cards = hand(text)
    holes = _np.array([cards[:2]])
    assert evaluate_seven_batch(holes, cards[2:])[0] == pack_strength(evaluate_best(cards))


def test_batch_matches_evaluate_best_on_random_boards_and_hands() -> None:
    # Many hands per shared board, mirroring how equity.py actually calls it.
    rng = _random.Random(1)
    deck = list(range(52))
    for _ in range(300):
        board = rng.sample(deck, 5)
        rest = [c for c in deck if c not in board]
        holes = [tuple(rng.sample(rest, 2)) for _ in range(60)]
        scores = evaluate_seven_batch(_np.array(holes), board)
        for hole, score in zip(holes, scores):
            assert score == pack_strength(evaluate_best(list(hole) + board)), (hole, board)


def test_pack_strength_preserves_order() -> None:
    rng = _random.Random(2)
    deck = list(range(52))
    strengths = [evaluate_best(rng.sample(deck, 7)) for _ in range(2_000)]
    for a, b in zip(strengths, strengths[1:]):
        assert (a < b) == (pack_strength(a) < pack_strength(b))
        assert (a == b) == (pack_strength(a) == pack_strength(b))
