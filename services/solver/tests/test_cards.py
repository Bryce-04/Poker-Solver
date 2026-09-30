import pytest

from poker_solver.cards import FULL_DECK, card_rank, card_str, card_suit, parse_card


def test_round_trip_known_cards() -> None:
    for text in ["As", "Td", "2c", "Kh", "9s"]:
        assert card_str(parse_card(text)) == text


def test_rank_and_suit_extraction() -> None:
    ace_of_spades = parse_card("As")
    assert card_rank(ace_of_spades) == 14
    assert card_suit(ace_of_spades) == 0

    two_of_clubs = parse_card("2c")
    assert card_rank(two_of_clubs) == 2
    assert card_suit(two_of_clubs) == 3


def test_full_deck_is_52_unique_cards() -> None:
    assert len(FULL_DECK) == 52
    assert len(set(FULL_DECK)) == 52
    assert set(FULL_DECK) == set(range(52))


def test_parse_card_accepts_lowercase_rank() -> None:
    assert parse_card("as") == parse_card("As")


def test_parse_card_rejects_garbage() -> None:
    for bad in ["", "A", "Asx", "1s", "Ax"]:
        with pytest.raises(ValueError):
            parse_card(bad)
