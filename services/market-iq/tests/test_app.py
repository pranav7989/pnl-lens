# @file  services/market-iq/tests/test_app.py
# @area  Tests
# @what  Internal API: /healthz open, every /internal/* call needs the shared key (missing key = 503, wrong key = 401), status carries no secrets.
import pytest
from fastapi.testclient import TestClient

from app import config
from app.main import app

KEY = "k" * 40


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "a.db")
    monkeypatch.setenv("MARKETIQ_INTERNAL_KEY", KEY)
    monkeypatch.setattr(config, "secrets", lambda: config.Secrets("1100000001", "246810", "JBSWY3DPEHPK3PXP", "", ""))
    from app.nse import holidays
    monkeypatch.setattr(holidays, "refresh", lambda *a, **k: 0)        # never call NSE from tests
    return TestClient(app)


def test_healthz_is_open(client):
    assert client.get("/healthz").json() == {"status": "ok"}


def test_internal_calls_need_the_key(client, monkeypatch):
    assert client.get("/internal/status").status_code == 401
    assert client.get("/internal/status", headers={"x-internal-key": "wrong"}).status_code == 401
    r = client.get("/internal/status", headers={"x-internal-key": KEY})
    assert r.status_code == 200
    j = r.json()
    assert j["token"] == {"configured": True, "missing": [], "state": "none", "expires_at": None}
    assert set(j) >= {"instruments", "market", "jobs"}
    assert "246810" not in r.text and "JBSWY3DPEHPK3PXP" not in r.text
    monkeypatch.setenv("MARKETIQ_INTERNAL_KEY", "short")
    assert client.get("/internal/status", headers={"x-internal-key": "short"}).status_code == 503


def test_no_public_docs(client):
    for p in ("/docs", "/redoc", "/openapi.json", "/"):
        assert client.get(p).status_code == 404
