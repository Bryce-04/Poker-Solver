"""3-bet / 4-bet range data and the preflop-line resolver (preflop_ranges.py).
The invariant tests matter most: they're what stops a hand-edited range from
quietly giving a player hands they couldn't have reached that node with."""

import pytest
from fastapi.testclient import TestClient
from poker_solver_schema import Position, Spot

from app.main import app
from app.preflop_ranges import (
    PAIR_RANGES,
    InvalidPreflopLine,
    UnsupportedPreflopLine,
    call_vs_3bet_range,
    call_vs_4bet_range,
    defend_range,
    flat_range,
    four_bet_range,
    open_range,
    ranges_for_preflop_line,
    three_bet_range,
)
from app.reference_charts import _DEFEND_CHARTS

client = TestClient(app)
P = Position

PAIRS = sorted(PAIR_RANGES, key=lambda p: (p[0].value, p[1].value))


def _combos(hands) -> int:
    return sum(6 if len(h) == 2 else 4 if h.endswith("s") else 12 for h in hands)


def test_every_defend_chart_pair_has_response_ranges_and_vice_versa():
    assert set(PAIR_RANGES) == set(_DEFEND_CHARTS["100bb"])


@pytest.mark.parametrize("pair", PAIRS)
def test_ranges_never_give_a_player_hands_they_could_not_have(pair):
    opener, defender = pair
    open_, defend = set(open_range(opener)), set(defend_range(opener, defender))
    three_bet = set(three_bet_range(opener, defender))
    call3 = set(call_vs_3bet_range(opener, defender))
    four_bet = set(four_bet_range(opener, defender))
    call4 = set(call_vs_4bet_range(opener, defender))
    assert three_bet <= defend, f"3-bets outside what the defender continues with: {three_bet - defend}"
    assert call3 <= open_, f"calls a 3-bet with hands it never opened: {call3 - open_}"
    assert four_bet <= open_, f"4-bets hands it never opened: {four_bet - open_}"
    assert not (call3 & four_bet), f"both calls and 4-bets: {call3 & four_bet}"
    assert call4 <= three_bet, f"calls a 4-bet with hands it never 3-bet: {call4 - three_bet}"
    assert not (set(flat_range(opener, defender)) & three_bet)
    # flat + 3-bet is exactly the defend chart: nothing lost, nothing invented.
    assert set(flat_range(opener, defender)) | three_bet == defend


@pytest.mark.parametrize("pair", PAIRS)
def test_frequencies_are_in_a_sane_band(pair):
    opener, defender = pair
    pct = lambda r: 100 * _combos(r) / 1326  # noqa: E731
    assert 2 <= pct(three_bet_range(opener, defender)) <= 14
    assert 1.5 <= pct(four_bet_range(opener, defender)) <= 4
    # An opener continues against a 3-bet with somewhere around half its range.
    continues = (
        _combos(call_vs_3bet_range(opener, defender)) + _combos(four_bet_range(opener, defender))
    ) / _combos(open_range(opener))
    assert 0.35 <= continues <= 0.70


def _spot(seats, actions, stack=100):
    return Spot(
        positions_in_hand=seats,
        effective_stack_bb=stack,
        current_street="preflop",
        actions=[{"position": p, "street": "preflop", "action": a} for p, a in actions],
    )


def test_single_raised_pot_gives_open_and_flat_ranges():
    r = ranges_for_preflop_line(_spot(["BB", "BTN"], [("BTN", "raise"), ("BB", "call")]))
    assert r["line"] == "single_raised"
    assert r["ranges"][P.BTN] == open_range(P.BTN)
    assert r["ranges"][P.BB] == flat_range(P.BTN, P.BB)
    assert "AA" not in r["ranges"][P.BB]  # the flat range has no 3-bet hands


def test_three_bet_pot_gives_the_3bet_range_and_the_openers_call():
    r = ranges_for_preflop_line(
        _spot(["BB", "BTN"], [("BTN", "raise"), ("BB", "raise"), ("BTN", "call")])
    )
    assert r["line"] == "three_bet"
    assert r["ranges"][P.BB] == three_bet_range(P.BTN, P.BB)
    assert r["ranges"][P.BTN] == call_vs_3bet_range(P.BTN, P.BB)


def test_four_bet_pot_gives_the_4bet_range_and_the_callers_range():
    r = ranges_for_preflop_line(
        _spot(
            ["BB", "BTN"],
            [("BTN", "raise"), ("BB", "raise"), ("BTN", "raise"), ("BB", "call")],
        )
    )
    assert r["line"] == "four_bet"
    assert r["ranges"][P.BTN] == four_bet_range(P.BTN, P.BB)
    assert r["ranges"][P.BB] == call_vs_4bet_range(P.BTN, P.BB)


def test_the_opener_is_whoever_raised_first_regardless_of_seat_order():
    # SB opens, BB 3-bets, SB calls -- positions_in_hand lists BB first.
    r = ranges_for_preflop_line(
        _spot(["BB", "SB"], [("SB", "raise"), ("BB", "raise"), ("SB", "call")])
    )
    assert r["ranges"][P.BB] == three_bet_range(P.SB, P.BB)
    assert r["ranges"][P.SB] == call_vs_3bet_range(P.SB, P.BB)


FIVE_BET = [
    ("BTN", "raise"),
    ("BB", "raise"),
    ("BTN", "raise"),
    ("BB", "raise"),
    ("BTN", "call"),
]


@pytest.mark.parametrize(
    "seats, actions, stack, error",
    [
        (["BB", "BTN"], [("BTN", "call"), ("BB", "check")], 100, UnsupportedPreflopLine),  # limp
        (["BB", "BTN"], FIVE_BET, 100, UnsupportedPreflopLine),
        (["BB", "BTN"], [("BTN", "raise"), ("BB", "call")], 40, UnsupportedPreflopLine),
        (["UTG", "BTN"], [("UTG", "raise"), ("BTN", "call")], 100, UnsupportedPreflopLine),
        (["BB", "BTN"], [("BTN", "raise"), ("BB", "fold")], 100, InvalidPreflopLine),
        (["BB", "BTN"], [("BTN", "raise")], 100, InvalidPreflopLine),  # not closed
        (["BB", "BTN"], [("BTN", "raise"), ("BTN", "raise"), ("BB", "call")], 100, InvalidPreflopLine),
        (["BB", "BB"], [("BB", "raise"), ("BB", "call")], 100, InvalidPreflopLine),
    ],
)
def test_lines_outside_the_charts_are_refused_not_guessed(seats, actions, stack, error):
    with pytest.raises(error):
        ranges_for_preflop_line(_spot(seats, actions, stack))


def _post(actions):
    return client.post(
        "/spots/preflop-ranges",
        json={
            "positions_in_hand": ["BB", "BTN"],
            "effective_stack_bb": 100,
            "current_street": "preflop",
            "actions": [{"position": p, "street": "preflop", "action": a} for p, a in actions],
        },
    )


def test_route_returns_ranges_and_maps_errors_to_404_and_422():
    ok = _post([("BTN", "raise"), ("BB", "raise"), ("BTN", "call")])
    assert ok.status_code == 200
    body = ok.json()
    assert body["line"] == "three_bet"
    assert set(body["ranges"]) == {"BTN", "BB"}
    assert body["ranges"]["BB"]["AA"] == 1.0

    assert _post([("BTN", "call"), ("BB", "check")]).status_code == 404  # limped pot
    assert _post([("BTN", "raise")]).status_code == 422  # street not closed
