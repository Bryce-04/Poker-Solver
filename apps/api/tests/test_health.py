from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_confirms_a_real_database_connection():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
