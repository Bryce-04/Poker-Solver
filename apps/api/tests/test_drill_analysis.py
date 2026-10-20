"""drill_analysis: hand/board classification and the explanation builder.
Pure functions, no database -- run with the --noconftest recipe in CLAUDE.md
(or normally)."""

from __future__ import annotations

import pytest

from app.drill_analysis import (
    AnalysisInput,
    describe_board,
    describe_hand,
    explain,
)
from poker_solver.cards import parse_card


def cards(text: str) -> tuple[int, ...]:
    return tuple(parse_card(c) for c in text.split())


def hand(hole: str, board: str):
    h = cards(hole)
    return describe_hand((h[0], h[1]), cards(board))


@pytest.mark.parametrize(
    "hole,board,label,made",
    [
        ("Ah Ad", "Ks 7h 2d", "an overpair", "pair_top"),
        ("Kd Qc", "Ks 7h 2d", "top pair", "pair_top"),
        ("7d Qc", "Ks 7h 2d", "second pair", "pair_mid"),
        ("2c Jc", "Ks 7h 2d", "bottom pair", "pair_weak"),
        ("Jd Jc", "Ks 7h 2d", "a pocket pair just under the top card", "pair_mid"),
        ("5d 5c", "Ks 7h 2d", "a pocket pair under the board", "pair_mid"),
        ("Kd Kc", "Ks 7h 2d", "a set", "monster"),
        ("Kd 7c", "Ks 7h 2d", "two pair", "monster"),
        ("Kd 2c", "Ks 7h 7d", "two pair", "monster"),
        ("7d 7c", "Ks 7h 2d", "a set", "monster"),
        ("Kd Kc", "Ks Kh 2d", "four of a kind", "monster"),
        ("Qd 7c", "7h 7d 2c", "trips", "monster"),
        ("Ad 2d", "Kd 7d 3d", "a flush", "monster"),
        ("Ah 3c", "Kd 7d 3d", "bottom pair", "pair_weak"),
    ],
)
def test_made_hands(hole, board, label, made):
    p = hand(hole, board)
    assert p.label == label
    assert p.made == made


def test_flush_and_straight_draws():
    fd = hand("Ah Th", "Kh 7h 2d")
    assert fd.draws == ("nut flush draw",)
    assert fd.made == "nothing"
    assert fd.label == "a nut flush draw"
    assert fd.draw_outs == 9

    oesd = hand("Jd Tc", "9h 8s 2d")
    assert "open-ended straight draw" in oesd.draws
    assert oesd.draw_outs == 8

    gut = hand("Jd Tc", "9h 7s 2d")
    assert "gutshot" in gut.draws
    assert gut.draw_outs == 4

    backdoor = hand("Ah Th", "Kh 7c 2d")
    assert backdoor.draws == ("backdoor flush draw",)


def test_straight_must_use_a_hole_card():
    # 9-8-7 on the board with a hand that doesn't join it: no straight draw.
    p = hand("Ac 2d", "9h 8s 7d")
    assert "open-ended straight draw" not in p.draws
    # The wheel counts (A-2-3-4-5): A4 on 2-3-K needs a five.
    assert "gutshot" in hand("Ad 4c", "2h 3s Kd").draws


def test_overcards_and_board_pair_note():
    p = hand("Ah Qd", "9c 7s 2d")
    assert p.made == "nothing"
    assert p.overcards == 2
    assert p.label == "ace high"
    paired = hand("Ah Qd", "9c 9s 2d")
    assert paired.made == "nothing"
    assert any("board" in n for n in paired.notes)


@pytest.mark.parametrize(
    "board,suitedness,connected,paired,starts",
    [
        ("Ks 7h 2d", "rainbow", False, False, "dry king-high"),
        ("Qs Js Td", "two-tone", True, False, "wet queen-high"),
        ("Kh Qh 3h", "monotone", False, False, "monotone king-high"),
        ("Td 5h 5c", "rainbow", False, True, "paired ten-high"),
        ("9s 8d 7c", "rainbow", True, False, "wet nine-high"),
    ],
)
def test_board_texture(board, suitedness, connected, paired, starts):
    t = describe_board(cards(board))
    assert t.suitedness == suitedness
    assert t.connected == connected
    assert t.paired == paired
    assert t.label.startswith(starts)


def _info(**overrides):
    board = cards("Ks 7h 2d")
    h = cards("Kd Qc")
    base = dict(
        hero="BB",
        villain="BTN",
        facing_bet=False,
        mix={"check": 0.2, "bet_small": 0.7, "bet_medium": 0.1, "bet_large": 0.0, "all_in": 0.0},
        profile=describe_hand((h[0], h[1]), board),
        texture=describe_board(board),
        equity=0.78,
        percentile=0.91,
        hero_range_equity=0.52,
        range_mix={"check": 0.6, "bet_small": 0.3, "bet_medium": 0.1, "bet_large": 0.0, "all_in": 0.0},
        pot_bb=5.5,
    )
    base.update(overrides)
    return AnalysisInput(**base)


def test_explain_value_bet_uses_the_computed_numbers():
    text = " ".join(explain(_info()))
    assert "top pair" in text
    assert "78%" in text and "91%" in text
    assert "dry king-high" in text
    assert "for value" in text


def test_explain_says_so_when_the_solver_is_close():
    mix = {"check": 0.45, "bet_small": 0.4, "bet_medium": 0.15, "bet_large": 0.0, "all_in": 0.0}
    bullets = explain(_info(mix=mix))
    assert any("close" in b for b in bullets)
    # A dominant play does not get the caveat.
    assert not any("close" in b for b in explain(_info()))


def test_explain_facing_a_bet_states_the_price():
    board = cards("Ks 7h 2d")
    h = cards("9d 8c")
    info = _info(
        facing_bet=True,
        bet_bb=1.375,
        mix={"fold": 0.8, "call": 0.15, "bet_small": 0.05, "bet_medium": 0.0, "bet_large": 0.0, "all_in": 0.0},
        profile=describe_hand((h[0], h[1]), board),
        equity=0.12,
        percentile=0.1,
        range_mix={"fold": 0.3, "call": 0.6, "bet_small": 0.1, "bet_medium": 0.0, "bet_large": 0.0, "all_in": 0.0},
    )
    text = " ".join(explain(info))
    assert "25% of the pot" in text
    assert "needs about 17% equity" in text
    assert "12% equity is below the 17%" in text
    assert "Folding is the main play" in text


def test_explain_never_claims_equity_is_below_a_price_it_is_above():
    board = cards("Ks 7h 2d")
    h = cards("9d 8c")
    info = _info(
        facing_bet=True,
        bet_bb=1.375,
        mix={"fold": 0.8, "call": 0.15, "bet_small": 0.05, "bet_medium": 0.0, "bet_large": 0.0, "all_in": 0.0},
        profile=describe_hand((h[0], h[1]), board),
        equity=0.2,
        percentile=0.1,
        range_mix={"fold": 0.3, "call": 0.6, "bet_small": 0.1, "bet_medium": 0.0, "bet_large": 0.0, "all_in": 0.0},
    )
    text = " ".join(explain(info))
    assert "is below the" not in text
    assert "just above" in text


def test_explain_draw_semi_bluff():
    board = cards("Kh 7h 2d")
    h = cards("Ah Th")
    info = _info(
        profile=describe_hand((h[0], h[1]), board),
        equity=0.46,
        percentile=0.7,
        mix={"check": 0.1, "bet_small": 0.2, "bet_medium": 0.7, "bet_large": 0.0, "all_in": 0.0},
    )
    text = " ".join(explain(info))
    assert "semi-bluff" in text
    assert "nut flush draw" in text


def test_explain_does_not_call_a_coin_flip_the_main_play():
    mix = {"check": 0.5, "bet_small": 0.0, "bet_medium": 0.0, "bet_large": 0.5, "all_in": 0.0}
    text = " ".join(explain(_info(mix=mix)))
    assert "essentially a coin flip" in text
    assert "is the main play" not in text
    assert "slight favorite" in text
