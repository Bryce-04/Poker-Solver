from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# The same river scenario services/solver's own closed-form regression
# test (test_postflop_mccfr.py) checks against known theory -- reusing it
# here means a wrong number would already be a familiar failure mode, not
# a new one to debug from scratch.
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
    # DEFAULT_ITERATIONS (solve.py) iterations through the full route -- a
    # couple seconds for this narrow a range pair, same ballpark as
    # services/solver's own regression tests.
    res = client.post("/spots/solve", json=RIVER_SPOT)
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "live_solve"
    assert body["position"] == "BTN"

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


def test_solve_rejects_an_action_already_on_the_current_street():
    spot = {
        **RIVER_SPOT,
        "actions": [{"position": "BB", "street": "river", "action": "bet", "size_bb": 10}],
    }
    res = client.post("/spots/solve", json=spot)
    assert res.status_code == 422
    assert "mid-street" in res.json()["detail"]
