"""spot_builder: the port of handBuilder.ts, and describe_spot's arguments to a Spot.
Pure (no database)."""

import json
from pathlib import Path

import pytest
from poker_solver_schema import Spot

from app.ask_coach import spot_builder as sb

FIXTURES = Path(__file__).resolve().parents[3] / "apps/web/src/lib/handBuilder.fixtures.json"
CASES = json.loads(FIXTURES.read_text(encoding="utf-8"))["cases"]


# --- the shared fixtures (also run by handBuilder.fixtures.test.ts) ----------------------------


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_pot_fixtures(case):
    streets = {
        st: [sb.Act(a["position"], a["action"], a.get("toBb")) for a in acts]
        for st, acts in case["streets"].items()
    }
    s = sb.summarize_hand(case["oop"], case["ip"], case["startingStackBb"], streets, case["boardLength"])
    e = case["expected"]
    assert s.target_street == e["targetStreet"]
    assert s.pot_bb == pytest.approx(e["potBb"])
    assert s.effective_stack_bb == pytest.approx(e["effectiveStackBb"])
    assert s.blocked_reason == e["blockedReason"]
    assert s.target_state.to_act == e["toAct"]
    assert s.target_state.is_terminal == e["isTerminal"]
    assert s.target_state.facing_bet == e["facingBet"]
    assert s.target_state.to_call_bb == pytest.approx(e["toCallBb"])
    assert s.target_state.pot_now_bb == pytest.approx(e["potNowBb"])


def test_there_are_enough_fixtures():
    assert len(CASES) >= 15


# --- describe ----------------------------------------------------------------------------------

BTN_VS_BB_FLOP = {
    "hero_position": "BTN",
    "villain_position": "BB",
    "hero_hand": "AhQd",
    "board": ["Qs", "5c", "2c"],
    "preflop": {"line": "open_call", "aggressor": "hero"},
    "postflop_actions": [{"street": "flop", "actor": "villain", "action": "check"}],
    "assumptions": ["standard ranges"],
}


def test_the_mockups_spot():
    d = sb.describe(BTN_VS_BB_FLOP)
    assert d.ok, d.problems
    assert d.to_act == "hero"
    spot = d.spot
    assert [p.value for p in spot.positions_in_hand] == ["BB", "BTN"]
    assert spot.pot_bb == 5.5
    assert spot.effective_stack_bb == 100  # the starting stack, as Solve saves a clicked-through hand
    assert spot.current_street.value == "flop"
    assert [(a.position.value, a.street.value, a.action.value, a.size_bb) for a in spot.actions] == [
        ("BTN", "preflop", "raise", 2.5),
        ("BB", "preflop", "call", None),
        ("BB", "flop", "check", None),
    ]
    assert d.facts == [
        {"k": "You", "v": "BTN (acts last)"},
        {"k": "Opponent", "v": "BB (checked)"},
        {"k": "Pot", "v": "5.5bb"},
        {"k": "Stacks", "v": "97.5bb"},
    ]
    # Every default is listed, the model's own assumptions kept.
    assert d.assumptions == ["standard ranges", "100bb stacks", "a 2.5bb open"]
    assert "BTN" in d.summary and "pot 5.5bb" in d.summary and "you to act" in d.summary
    # It round-trips as a schema Spot.
    assert Spot.model_validate(spot.model_dump(mode="json")) == spot


def test_a_3bet_pot_with_default_sizes():
    d = sb.describe(
        {
            "hero_position": "BB",
            "villain_position": "CO",
            "board": ["Kd", "7s", "2h"],
            "preflop": {"line": "three_bet_call", "aggressor": "hero"},
        }
    )
    assert d.ok, d.problems
    # CO opens 2.5, BB 3-bets to 7.5, CO calls: 15 + the SB's dead 0.5.
    assert d.spot.pot_bb == 15.5
    assert d.to_act == "hero"
    assert "a 7.5bb 3-bet" in d.assumptions


def test_a_4bet_pot():
    d = sb.describe(
        {
            "hero_position": "BTN",
            "villain_position": "SB",
            "board": ["Ad", "7s", "2h"],
            "preflop": {"line": "four_bet_call", "aggressor": "hero", "three_bet_size_bb": 11, "four_bet_size_bb": 24},
        }
    )
    assert d.ok, d.problems
    assert d.spot.pot_bb == 49
    assert d.to_act == "villain"  # SB acts first after the flop


def test_facing_a_bet_on_the_turn():
    d = sb.describe(
        {
            **BTN_VS_BB_FLOP,
            "board": ["Qs", "5c", "2c", "9h"],
            "postflop_actions": [
                {"street": "flop", "actor": "villain", "action": "check"},
                {"street": "flop", "actor": "hero", "action": "bet", "amount_bb": 2},
                {"street": "flop", "actor": "villain", "action": "call"},
                {"street": "turn", "actor": "villain", "action": "bet", "amount_bb": 6},
            ],
        }
    )
    assert d.ok, d.problems
    assert d.spot.current_street.value == "turn"
    assert d.spot.pot_bb == 9.5
    assert {"k": "To call", "v": "6bb"} in d.facts
    assert {"k": "Opponent", "v": "BB (bet 6bb)"} in d.facts


@pytest.mark.parametrize(
    "line,extra,to_act",
    [
        ("unopened", {"villain_position": None}, "hero"),
        ("facing_open", {"hero_position": "BB", "villain_position": "BTN"}, "hero"),
        ("facing_three_bet", {"hero_position": "CO", "villain_position": "BTN"}, "hero"),
    ],
)
def test_preflop_decisions(line, extra, to_act):
    args = {"hero_position": "CO", "villain_position": "BTN", "hero_hand": "AQo", "preflop": {"line": line}}
    args.update(extra)
    d = sb.describe(args)
    assert d.ok, d.problems
    assert d.spot.current_street.value == "preflop"
    assert d.spot.board == []
    assert d.to_act == to_act


@pytest.mark.parametrize(
    "raw,expected",
    [("AhQd", "AhQd"), ("ah qd", "AhQd"), ("AQo", "AQo"), ("qas", "AQs"), ("TT", "TT"), ("10h10d", "ThTd")],
)
def test_hands(raw, expected):
    assert sb.normalize_hand(raw) == (expected, None)


def test_a_hand_without_suited_or_offsuit_is_a_question():
    hand, problem = sb.normalize_hand("AQ")
    assert hand is None and "suited or offsuit" in problem


@pytest.mark.parametrize(
    "change,problem",
    [
        ({"hero_position": "BB"}, "same position"),
        ({"hero_position": "dealer"}, "Which position are you in"),
        ({"board": ["Qs", "5c"]}, "3 cards"),
        ({"board": ["Qs", "5c", "Qs"]}, "appears twice"),
        ({"hero_hand": "QsKd"}, "appears twice"),
        ({"board": ["Qs", "5c", "Zz"]}, "board card"),
        ({"preflop": {"line": "limped"}}, "preflop action"),
        ({"preflop": {"line": "open_call", "aggressor": "hero", "open_size_bb": 0.5}}, "don't add up"),
        ({"effective_stack_bb": 1}, "between 2bb and 1000bb"),
    ],
)
def test_problems_are_questions_not_guesses(change, problem):
    d = sb.describe({**BTN_VS_BB_FLOP, **change})
    assert not d.ok
    assert any(problem in p for p in d.problems), d.problems


@pytest.mark.parametrize(
    "actions,problem",
    [
        ([{"street": "flop", "actor": "hero", "action": "check"}], "BB's turn"),
        ([{"street": "flop", "actor": "villain", "action": "call"}], "wasn't facing a bet"),
        (
            [{"street": "flop", "actor": "villain", "action": "bet", "amount_bb": 3}, {"street": "flop", "actor": "hero", "action": "check"}],
            "can't check facing a bet",
        ),
        ([{"street": "flop", "actor": "villain", "action": "bet"}], "How much"),
        ([{"street": "turn", "actor": "villain", "action": "check"}], "turn card"),
        (
            [{"street": "flop", "actor": "villain", "action": "bet", "amount_bb": 3}, {"street": "flop", "actor": "hero", "action": "call"}],
            "What was the turn card",
        ),
        (
            [{"street": "flop", "actor": "villain", "action": "bet", "amount_bb": 3}, {"street": "flop", "actor": "hero", "action": "fold"}],
            "the hand is over",
        ),
        ([{"street": "flop", "actor": "villain", "action": "bet", "amount_bb": 200}], "doesn't have"),
    ],
)
def test_actions_that_dont_make_sense(actions, problem):
    d = sb.describe({**BTN_VS_BB_FLOP, "postflop_actions": actions})
    assert not d.ok
    assert any(problem in p for p in d.problems), d.problems


def test_a_closed_preflop_line_without_a_flop_asks_for_it():
    d = sb.describe({**BTN_VS_BB_FLOP, "board": [], "postflop_actions": []})
    assert d.problems == ["What was the flop?"]


@pytest.mark.parametrize(
    "hero,villain,line,opener",
    [
        ("BTN", "BB", "open_call", "BTN"),
        ("BB", "BTN", "open_call", "BTN"),
        ("BB", "CO", "three_bet_call", "CO"),
        ("SB", "BTN", "four_bet_call", "BTN"),
    ],
)
def test_who_opened_comes_from_the_seats_not_the_model(hero, villain, line, opener):
    # The model's own `aggressor`, even a wrong one, is ignored.
    d = sb.describe({**BTN_VS_BB_FLOP, "hero_position": hero, "villain_position": villain, "preflop": {"line": line, "aggressor": "nonsense"}, "postflop_actions": []})
    assert d.ok, d.problems
    first = sb.describe({**BTN_VS_BB_FLOP, "hero_position": hero, "villain_position": villain, "preflop": {"line": line}, "postflop_actions": []})
    assert first.ok, first.problems
    assert first.spot.actions[0].position.value == opener and first.spot.actions[0].action.value == "raise"


def test_facing_an_open_from_a_later_seat_is_a_question():
    d = sb.describe({"hero_position": "BTN", "villain_position": "BB", "preflop": {"line": "facing_open"}})
    assert any("can't have opened" in p for p in d.problems)


def test_a_checked_through_street_in_the_wrong_order_is_fixed():
    d = sb.describe(
        {
            **BTN_VS_BB_FLOP,
            "board": ["Qs", "5c", "2c", "9h"],
            "postflop_actions": [
                {"street": "flop", "actor": "hero", "action": "check"},  # BTN listed first: wrong
                {"street": "flop", "actor": "villain", "action": "check"},
            ],
        }
    )
    assert d.ok, d.problems
    assert [(a.position.value, a.street.value) for a in d.spot.actions[2:]] == [("BB", "flop"), ("BTN", "flop")]


def test_other_order_mistakes_are_still_questions():
    d = sb.describe({**BTN_VS_BB_FLOP, "postflop_actions": [{"street": "flop", "actor": "hero", "action": "bet", "amount_bb": 2}]})
    assert any("BB's turn" in p for p in d.problems)


def test_titles():
    assert sb.title_for("BTN", "AhQd", "BB", ["Qs", "5c", "2c"]) == "AQ on the button, Q-5-2 flop"
    assert sb.title_for("CO", "JTs", "BTN", ["9h", "8d", "2c", "Kd"]) == "JT on the cutoff, 9-8-2-K turn"
    assert sb.title_for("SB", None, "BB", []) == "SB vs BB, preflop"


# --- a pasted hand history --------------------------------------------------------------------

HISTORY_SPOT = Spot(
    positions_in_hand=["BB", "BTN"],
    effective_stack_bb=97.5,
    pot_bb=5.5,
    board=["Qs", "5c", "2c"],
    current_street="flop",
    actions=[{"position": "BB", "street": "flop", "action": "check"}],
)


def test_an_attached_spot_is_used_as_it_is():
    d = sb.from_attached(HISTORY_SPOT, {"hero_position": "BTN", "hero_hand": "AhQd", "board": ["2s", "3s", "4s"]})
    assert d.ok, d.problems
    assert d.spot.board == ["Qs", "5c", "2c"]  # the model's board is ignored
    assert d.to_act == "hero"
    assert {"k": "Pot", "v": "5.5bb"} in d.facts
    assert "read from your hand history" in d.assumptions


def test_an_attached_spot_needs_to_know_which_player_you_were():
    d = sb.from_attached(HISTORY_SPOT, {"hero_position": "CO"})
    assert d.problems == ["Which player were you in that hand, BB or BTN?"]


def test_an_attached_spot_rejects_your_cards_on_the_board():
    d = sb.from_attached(HISTORY_SPOT, {"hero_position": "BTN", "hero_hand": "QsQd"})
    assert any("also on the board" in p for p in d.problems)
