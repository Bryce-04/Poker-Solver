from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_reference_strategy_matches_and_labels_the_response():
    res = client.post(
        "/spots/reference-strategy",
        json={"positions_in_hand": ["UTG"], "effective_stack_bb": 100},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "reference_chart"
    assert body["chart_key"] == "utg_open_100bb"
    assert "AA" in body["ranges"]["UTG"]


def test_reference_strategy_404s_with_a_clear_message_when_unmatched():
    res = client.post(
        "/spots/reference-strategy",
        json={"positions_in_hand": ["HJ"], "effective_stack_bb": 100},
    )
    assert res.status_code == 404
    assert "reference_charts.py" in res.json()["detail"]


def test_reference_strategy_rejects_an_invalid_spot():
    # Missing the required effective_stack_bb -- should fail schema
    # validation (422), not reach the matching logic at all.
    res = client.post("/spots/reference-strategy", json={"positions_in_hand": ["UTG"]})
    assert res.status_code == 422
