"""The Coach's evaluation set (coach_eval/cases.jsonl) must stay usable: every
expected answer a valid spot, and the scorer's board matching right. The eval
itself needs a Gemini key and runs by hand (scripts/coach_eval.py)."""

import sys
from pathlib import Path

API = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API / "scripts"))

from coach_eval import board_matches, check_cases, compare, load_cases  # noqa: E402


def test_there_are_about_fifty_cases_with_unique_ids():
    cases = load_cases(None)
    assert len(cases) >= 50
    assert len({c["id"] for c in cases}) == len(cases)


def test_every_expected_answer_is_a_valid_spot():
    assert check_cases(load_cases(None)) == 0


def test_board_matching():
    assert board_matches(["5c", "Qs", "2c"], ["Qs", "5c", "2c"], "exact")  # flop order doesn't matter
    assert not board_matches(["Qs", "5c", "2d"], ["Qs", "5c", "2c"], "exact")
    assert board_matches(["Qh", "5d", "2d"], ["Qs", "5c", "2c"], "pattern")  # "two of a suit"
    assert not board_matches(["Qd", "5d", "2d"], ["Qs", "5c", "2c"], "pattern")
    assert board_matches(["Qd", "5d", "2d"], ["Qs", "5c", "2c"], "ranks")
    assert not board_matches(["Qs", "5c", "2c", "9h"], ["Qs", "5c", "2c", "Th"], "ranks")


def test_compare():
    expect = {"hero": "BTN", "hand": "AQo", "line": "open_call", "actions": [["flop", "villain", "check"]]}
    args = {
        "hero_position": "BTN",
        "hero_hand": "qao",
        "preflop": {"line": "open_call"},
        "postflop_actions": [{"street": "flop", "actor": "villain", "action": "check"}],
    }
    assert compare(expect, args) == []
    assert compare(expect, {**args, "hero_position": "CO"}) == ["hero='CO'"]
    assert compare({"no_describe": True}, None) == []
    assert compare({"no_describe": True}, args) == ["called describe_spot"]
    assert compare(expect, None) == ["no describe_spot call"]
    # "asks": asking directly, or a describe_spot that comes back with a question, both pass.
    assert compare({"asks": True}, None) == []
    assert compare({"asks": True}, {"hero_hand": "KQs", "preflop": {"line": "open_call"}}) == []
    assert compare({"asks": True}, {**args, "villain_position": "BB", "board": ["Qs", "5c", "2c"]}) == [
        "describe_spot found nothing to ask"
    ]
