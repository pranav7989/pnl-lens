from fastapi.testclient import TestClient

from app.main import app


def test_health_and_page():
    c = TestClient(app)
    assert c.get("/health").json() == {"status": "ok"}
    r = c.get("/")
    assert r.status_code == 200 and "Not investment advice" in r.text
