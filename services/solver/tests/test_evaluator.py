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
