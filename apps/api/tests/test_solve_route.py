from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# The same river scenario services/solver's own closed-form regression
# tests (test_range_cfr.py) check against known theory -- reusing it here
# means a wrong number would already be a familiar failure mode, not a new
# one to debug from scratch.
RIVER_SPOT = {
    "positions_in_hand": ["BB", "BTN"],
    "effective_stack_bb": 33,
    "pot_bb": 100,
    "board": ["Ks", "Qh", "9d", "4c", "2s"],
    "current_street": "river",
    "actions": [{"position": "BB", "street": "river", "action": "check"}],
    "ranges": {"BB": {"KJo": 1.0}, "BTN": {"AA": 1.0, "33": 1.0}},
}


def test_solve_returns_a_strategy_that_sums_to_one_per_hand():
    # Trains until TARGET_EXPLOITABILITY_PCT (solve.py) -- well under a
    # second for this narrow a range pair.
    res = client.post("/spots/solve", json=RIVER_SPOT)
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "live_solve"
    assert body["position"] == "BTN"
    assert body["exploitability_pct"] < 0.5
    assert 0 < body["iterations"] <= 250

    strategy = body["strategy"]
    assert set(strategy) == {"AA", "33"}
    for probs in strategy.values():
        assert abs(sum(probs.values()) - 1.0) < 1e-6
    # AA can never lose on this board -- shoving should be dominant.
    assert strategy["AA"]["all_in"] > 0.95


def test_solve_rejects_one_position():
    spot = {**RIVER_SPOT, "positions_in_hand": ["BTN"]}
    res = client.post("/spots/solve", json=spot)
    assert res.status_code == 422
    assert "exactly 2 entries" in res.json()["detail"]


def test_solve_rejects_a_too_short_board():
    spot = {**RIVER_SPOT, "board": ["Ks", "Qh"]}
    res = client.post("/spots/solve", json=spot)
    assert res.status_code == 422
    assert "flop" in res.json()["detail"]


def test_solve_rejects_missing_pot_bb():
    spot = {k: v for k, v in RIVER_SPOT.items() if k != "pot_bb"}
    res = client.post("/spots/solve", json=spot)
    assert res.status_code == 422
    assert "pot_bb" in res.json()["detail"]


def test_solve_rejects_a_range_missing_for_either_position():
    spot = {**RIVER_SPOT, "ranges": {"BB": {"KJo": 1.0}}}
    res = client.post("/spots/solve", json=spot)
    assert res.status_code == 422
    assert "BTN" in res.json()["detail"]


def test_solve_accepts_a_seeded_bet_and_discloses_the_bucketing():
    # BB's 10bb bet (10% of the 100bb pot) is lossily bucketed onto the
    # nearest of {25%, 75%, 125%} pot -- here, bet_small -- and the solve
    # now runs for BTN facing it, instead of being rejected outright.
    spot = {
        **RIVER_SPOT,
        "actions": [{"position": "BB", "street": "river", "action": "bet", "size_bb": 10}],
    }
    res = client.post("/spots/solve", json=spot)
    assert res.status_code == 200
    body = res.json()
    assert body["position"] == "BTN"
    assert set(body["strategy"]) == {"AA", "33"}
    assert len(body["bucketed_actions"]) == 1
    assert "bet_small" in body["bucketed_actions"][0]


def test_solve_rejects_an_out_of_turn_action():
    # BB is first to act this street (positions_in_hand[0]) -- BTN acting
    # first instead is illegal, not something to guess a fix for.
    spot = {
        **RIVER_SPOT,
        "actions": [{"position": "BTN", "street": "river", "action": "check"}],
    }
    res = client.post("/spots/solve", json=spot)
    assert res.status_code == 422
    assert "out of turn" in res.json()["detail"]


def test_solve_rejects_an_already_terminal_action_sequence():
    # BB bets, BTN folds -- the hand's over on this street; there's no
    # decision left for anyone to solve.
    spot = {
        **RIVER_SPOT,
        "actions": [
            {"position": "BB", "street": "river", "action": "bet", "size_bb": 10},
            {"position": "BTN", "street": "river", "action": "fold"},
        ],
    }
    res = client.post("/spots/solve", json=spot)
    assert res.status_code == 422
    assert "no decision left to solve" in res.json()["detail"]


def test_solve_accepts_a_two_action_prefix_ending_on_a_raise():
    # BB bets 25% pot (bucketed cleanly to bet_small), BTN raises to 60%
    # of the resulting pot (bucketed to bet_medium) -- a short multi-action
    # prefix, not just a single seeded check or bet. The solve now runs
    # for BB, facing BTN's raise.
    spot = {
        **RIVER_SPOT,
        "effective_stack_bb": 200,
        "actions": [
            {"position": "BB", "street": "river", "action": "bet", "size_pct_pot": 0.25},
            {"position": "BTN", "street": "river", "action": "raise", "size_pct_pot": 0.6},
        ],
    }
    res = client.post("/spots/solve", json=spot)
    assert res.status_code == 200
    body = res.json()
    assert body["position"] == "BB"
    assert len(body["bucketed_actions"]) == 2
    assert "bet_small" in body["bucketed_actions"][0]
    assert "bet_medium" in body["bucketed_actions"][1]


def test_solve_rejects_a_sized_action_with_no_size_given():
    spot = {
        **RIVER_SPOT,
        "actions": [{"position": "BB", "street": "river", "action": "bet"}],
    }
    res = client.post("/spots/solve", json=spot)
    assert res.status_code == 422
    assert "needs size_bb or size_pct_pot" in res.json()["detail"]
