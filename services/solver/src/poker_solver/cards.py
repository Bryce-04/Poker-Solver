"""Card representation shared by every solver module.

A card is a plain int 0-51 (`rank_index*4 + suit_index`), not a dataclass --
fast and hashable, which matters once MCCFR is sampling and comparing
thousands of hands a second (see postflop_mccfr.py). This module is the only
place that knows about that encoding; everything downstream treats a card
as an opaque comparable/hashable value and only ever gets one from
`parse_card` or `FULL_DECK`.

Text notation matches packages/schema's CARD_PATTERN (models.py):
rank char from "23456789TJQKA", suit char from "shdc", e.g. "As", "Td".
"""

from __future__ import annotations

RANKS = "23456789TJQKA"
SUITS = "shdc"


def parse_card(text: str) -> int:
    """'As' -> int. Raises ValueError on anything not matching the schema's
    CARD_PATTERN (two chars, a rank then a suit)."""
    if len(text) != 2:
        raise ValueError(f"not a card: {text!r}")
    rank_char, suit_char = text[0].upper(), text[1].lower()
    if rank_char not in RANKS or suit_char not in SUITS:
        raise ValueError(f"not a card: {text!r}")
    return RANKS.index(rank_char) * 4 + SUITS.index(suit_char)


def card_str(card: int) -> str:
    rank_idx, suit_idx = divmod(card, 4)
    return f"{RANKS[rank_idx]}{SUITS[suit_idx]}"


def card_rank(card: int) -> int:
    """2-14, ace high."""
    return card // 4 + 2


def card_suit(card: int) -> int:
    """0-3, indexing SUITS."""
    return card % 4


FULL_DECK: tuple[int, ...] = tuple(range(52))
