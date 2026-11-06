"""The Coach's solver tools (app/ask_coach/solver_tools.py): the preflop charts,
and solving the current spot (ranges, narrowing, the hero's exact combo, bet
sizes in bb, waiting for a busy solver). No database; one test runs a real solve."""

import pytest
from poker_solver_schema import Position

from app.ask_coach import solver_tools as st
from app.ask_coach import spot_builder as sb
from app.solve import SolverBusy

BTN_AQ_FLOP = {
    "hero_position": "BTN",
    "villain_position": "BB",
    "hero_hand": "AhQd",
    "board": ["Qs", "5c", "2c"],
    "preflop": {"line": "open_call"},
    "postflop_actions": [{"street": "flop", "actor": "villain", "action": "check"}],
}


def current(args: dict) -> dict:
    """A spot card's payload, as describe_spot stores it."""
    d = sb.describe(args)
    assert d.ok, d.problems
    return {"spot": d.spot.model_dump(mode="json"), "hero_position": d.hero_position, "hero_hand": d.hero_hand}


class Hooks:
    def __init__(self):
        self.cards, self.statuses = [], []
        self.hooks = st.SolveHooks(store_card=lambda k, p: self.cards.append((k, p)), set_status=self.statuses.append)


def canned(position="BTN", strategy=None, combo=None, **extra):
    return {
        "position": Position(position),
        "strategy": strategy or {"AQo": {"check": 0.3, "bet_small": 0.55, "bet_medium": 0.15}},
        "combo_strategy": combo or {},
        "exploitability_pct": 0.31,
        "converged": True,
        "bucketed_actions": [],
        "hand_categories": {"AQo": "Top pair, top kicker"},
        "hand_reasons": {"AQo": ["Worse queens and draws call."]},
        **extra,
    }


# --- get_preflop_strategy ---------------------------------------------------------------------


def preflop(args):
    return st.preflop_strategy(current({"board": [], **args}))


def freqs(outcome):
    return {r["action"]: r["freq"] for r in outcome.card["rows"]}


def test_an_unopened_pot_is_open_or_fold_from_the_chart():
    strong = preflop({"hero_position": "BTN", "hero_hand": "AQo", "preflop": {"line": "unopened"}})
    assert strong.result["ok"] and strong.card_kind == "preflop_card"
    assert freqs(strong) == {"raise": 1.0}
    weak = preflop({"hero_position": "UTG", "hero_hand": "72o", "preflop": {"line": "unopened"}})
    assert freqs(weak) == {"fold": 1.0}
    assert weak.card["note"] == st.CHART_NOTE  # never presented as a solver result


def test_facing_an_open_splits_3bet_call_and_fold():
    aa = preflop({"hero_position": "BB", "villain_position": "BTN", "hero_hand": "AA", "preflop": {"line": "facing_open"}})
    assert freqs(aa) == {"three_bet": 1.0}
    k9 = preflop({"hero_position": "BB", "villain_position": "BTN", "hero_hand": "K9o", "preflop": {"line": "facing_open"}})
    assert sum(freqs(k9).values()) == pytest.approx(1.0)
    assert k9.card["situation"] == "Facing a 2.5bb open from BTN"


def test_facing_a_3bet_is_4bet_call_or_fold():
    out = preflop({"hero_position": "CO", "villain_position": "BTN", "hero_hand": "AA", "preflop": {"line": "facing_three_bet"}})
    assert out.result["ok"]
    assert set(freqs(out)) <= {"four_bet", "call", "fold"}
    assert freqs(out).get("four_bet", 0) + freqs(out).get("call", 0) == pytest.approx(1.0)


def test_an_exact_hand_is_read_as_its_type():
    out = preflop({"hero_position": "BTN", "hero_hand": "AhQd", "preflop": {"line": "unopened"}})
    assert out.result["hand_type"] == "AQo" and out.card["hero_hand"] == "AhQd"


def test_the_model_gets_whole_percentages_matching_the_card():
    out = preflop({"hero_position": "BB", "villain_position": "BTN", "hero_hand": "K9o", "preflop": {"line": "facing_open"}})
    assert [r["percent"] for r in out.result["rows"]] == [round(100 * r["freq"]) for r in out.card["rows"]]


@pytest.mark.parametrize(
    "args,reason",
    [
        ({"hero_position": "BTN", "preflop": {"line": "unopened"}}, "user's hand"),
        ({"hero_position": "BTN", "hero_hand": "AQo", "preflop": {"line": "unopened"}, "effective_stack_bb": 300}, "no opening chart"),
    ],
)
def test_preflop_refusals(args, reason):
    out = preflop(args)
    assert not out.result["ok"] and reason in out.result["reason"]
    assert out.card is None


def test_preflop_on_a_spot_with_a_board_points_to_the_solver():
    assert "solve_current_spot" in st.preflop_strategy(current(BTN_AQ_FLOP)).result["reason"]


# --- solve_current_spot -----------------------------------------------------------------------


def test_a_flop_solve_reads_the_hero_hand_and_names_sizes_in_bb(monkeypatch):
    seen = []
    monkeypatch.setattr(st, "solve_spot", lambda spot: seen.append(spot) or canned())
    h = Hooks()
    out = st.solve_current(current(BTN_AQ_FLOP), h.hooks)

    assert out.result["ok"] and out.card_kind == "result_card"
    assert h.cards[0][0] == "solving" and h.cards[0][1]["street"] == "flop" and h.cards[0][1]["player"] == "BTN"
    request = seen[0]
    assert request.pot_bb == 5.5 and request.effective_stack_bb == 97.5  # entering the flop, not the start
    assert [a.action.value for a in request.actions] == ["check"]
    assert set(request.ranges) == {Position.BB, Position.BTN}  # both loaded from the preflop line
    assert [(r["label"], r["freq"]) for r in out.card["rows"]] == [
        ("Bet small (1.38bb)", 0.55),
        ("Check", 0.3),
        ("Bet medium (4.12bb)", 0.15),
    ]
    assert out.result["hero_mix"] == [
        {"play": "Bet small (1.38bb)", "percent": 55},
        {"play": "Check", "percent": 30},
        {"play": "Bet medium (4.12bb)", "percent": 15},
    ]
    assert out.result["category"] == "Top pair, top kicker"
    assert out.result["whose_strategy"] == "hero"


def test_the_exact_combo_wins_over_the_hand_type(monkeypatch):
    combo = {"AhQd": {"check": 0.9, "bet_small": 0.1}}
    monkeypatch.setattr(st, "solve_spot", lambda spot: canned(combo=combo))
    out = st.solve_current(current(BTN_AQ_FLOP), Hooks().hooks)
    assert [r["freq"] for r in out.card["rows"]] == [0.9, 0.1]
    assert out.card["range_rows"]  # the whole range's mix is kept alongside


def test_facing_a_bet_names_call_and_raise_to(monkeypatch):
    monkeypatch.setattr(
        st, "solve_spot", lambda spot: canned(strategy={"AQo": {"call": 0.7, "bet_small": 0.2, "fold": 0.1}})
    )
    args = {**BTN_AQ_FLOP, "postflop_actions": [{"street": "flop", "actor": "villain", "action": "bet", "amount_bb": 3}]}
    out = st.solve_current(current(args), Hooks().hooks)
    labels = [r["label"] for r in out.card["rows"]]
    assert labels[0] == "Call 3bb"
    assert labels[1].startswith("Raise to ")
    assert labels[2] == "Fold"


def test_a_turn_solve_narrows_the_ranges_by_the_flop_first(monkeypatch):
    calls = []

    def narrow(spot):
        calls.append(("narrow", spot))
        return {
            "ranges": {Position.BB: {"AA": 1.0}, Position.BTN: {"AQo": 1.0, "KK": 0.5}},
            "line_probability": {Position.BB: 0.6, Position.BTN: 0.05},
        }

    def solve(spot):
        calls.append(("solve", spot))
        return canned(position="BB")

    monkeypatch.setattr(st, "narrow_ranges", narrow)
    monkeypatch.setattr(st, "solve_spot", solve)
    args = {
        **BTN_AQ_FLOP,
        "board": ["Qs", "5c", "2c", "9h"],
        "postflop_actions": [
            {"street": "flop", "actor": "villain", "action": "check"},
            {"street": "flop", "actor": "hero", "action": "check"},
        ],
    }
    out = st.solve_current(current(args), Hooks().hooks)

    (_, narrow_req), (_, solve_req) = calls
    assert narrow_req.board == ["Qs", "5c", "2c"] and narrow_req.current_street.value == "flop"
    assert [a.action.value for a in narrow_req.actions] == ["check", "check"]
    assert solve_req.board == ["Qs", "5c", "2c", "9h"] and solve_req.current_street.value == "turn"
    assert solve_req.ranges[Position.BB].root == {"AA": 1.0}  # the narrowed ranges
    assert out.card["narrowed"] == ["flop"]
    assert any("rarely plays your flop action" in n for n in out.card["notes"])
    # BB acts first on the turn: the solve is BB's strategy, said plainly.
    assert out.result["whose_strategy"] == "villain" and out.card["hero_hand"] is None
    assert any("BB's strategy" in n for n in out.result["notes"])


def test_a_hand_outside_the_range_shows_the_range_and_says_so(monkeypatch):
    monkeypatch.setattr(st, "solve_spot", lambda spot: canned(strategy={"KK": {"check": 1.0}}))
    out = st.solve_current(current(BTN_AQ_FLOP), Hooks().hooks)
    assert out.result["hand_in_range"] is False and out.result["hero_mix"] is None
    assert any("isn't in the range" in n for n in out.card["notes"])


def test_a_busy_solver_is_waited_for(monkeypatch):
    attempts = []

    def busy_twice(spot):
        attempts.append(1)
        if len(attempts) < 3:
            raise SolverBusy("busy")
        return canned()

    monkeypatch.setattr(st, "solve_spot", busy_twice)
    monkeypatch.setattr(st, "_sleep", lambda s: None)
    h = Hooks()
    assert st.solve_current(current(BTN_AQ_FLOP), h.hooks).result["ok"]
    assert len(attempts) == 3
    assert h.statuses == ["working", "waiting_for_solver", "working"]


def test_a_solver_busy_for_too_long_gives_up(monkeypatch):
    def always_busy(spot):
        raise SolverBusy("busy")

    now = [0.0]
    monkeypatch.setattr(st, "solve_spot", always_busy)
    monkeypatch.setattr(st, "_sleep", lambda s: now.__setitem__(0, now[0] + s))
    monkeypatch.setattr(st, "_clock", lambda: now[0])
    with pytest.raises(st.SolverStillBusy):
        st.solve_current(current(BTN_AQ_FLOP), Hooks().hooks)
    assert now[0] >= st.WAIT_FOR_SOLVER_S


def test_unsupported_lines_are_reasons_not_errors():
    shallow = st.solve_current(current({**BTN_AQ_FLOP, "effective_stack_bb": 40}), Hooks().hooks)
    assert not shallow.result["ok"] and "ranges for that preflop line" in shallow.result["reason"]


def test_a_hand_history_spot_without_preflop_betting_is_refused():
    spot = {
        "positions_in_hand": ["BB", "BTN"], "effective_stack_bb": 97.5, "pot_bb": 5.5,
        "board": ["Qs", "5c", "2c"], "current_street": "flop",
        "actions": [{"position": "BB", "street": "flop", "action": "check"}],
    }
    out = st.solve_current({"spot": spot, "hero_position": "BTN", "hero_hand": "AhQd"}, Hooks().hooks)
    assert not out.result["ok"] and "preflop" in out.result["reason"]


def test_no_spot_yet():
    assert "describe_spot" in st.solve_current(None, Hooks().hooks).result["reason"]


# --- the real solver, once ----------------------------------------------------------------------


def test_a_real_flop_solve_end_to_end():
    h = Hooks()
    out = st.solve_current(current(BTN_AQ_FLOP), h.hooks)
    assert out.result["ok"], out.result
    assert out.result["whose_strategy"] == "hero"
    rows = out.card["rows"]
    assert sum(r["freq"] for r in rows) == pytest.approx(1.0, abs=0.02)
    assert all(r["label"] == "Check" or "bb)" in r["label"] for r in rows)
    assert out.card["exploitability_pct"] < 1.0
    assert out.result["category"]  # flop hand notes
