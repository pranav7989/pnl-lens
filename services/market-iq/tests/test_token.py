# @file  services/market-iq/tests/test_token.py
# @area  Tests
# @what  Dhan token manager with mocked HTTP: login, reuse, renewal on expiry and rejection, clear errors, no secrets in logs.
"""Token manager with Dhan's HTTP mocked: login, reuse, renewal on expiry and on rejection, clear errors, no secrets in output."""
import logging
from datetime import datetime, timedelta

import httpx
import pyotp
import pytest
import respx

from app import config
from app.auth import token as tk
from app.store import db

SECRET = pyotp.random_base32()
S = config.Secrets(client_id="1100000001", pin="246810", totp_secret=SECRET, api_key="", api_secret="")
LOGIN = f"{config.DHAN_AUTH_BASE}/app/generateAccessToken"
PROFILE = f"{config.DHAN_API_BASE}/profile"


@pytest.fixture
def con(tmp_path):
    return db.connect(tmp_path / "t.db")


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setattr(config, "secrets", lambda: S)
    monkeypatch.setattr(tk, "_totp_code", lambda secret, now=None: pyotp.TOTP(secret).now())


def login_ok(tok="tok-1", hours=24):
    exp = (datetime.now(config.IST) + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%S")
    return httpx.Response(200, json={"dhanClientId": S.client_id, "accessToken": tok, "expiryTime": exp})


@respx.mock
def test_login_sends_client_pin_and_current_totp_then_reuses_the_token(con):
    route = respx.post(LOGIN).mock(return_value=login_ok())
    with httpx.Client() as c:
        t = tk.get_token(con, c)
        assert t.access_token == "tok-1" and t.valid()
        q = route.calls[0].request.url.params
        assert q["dhanClientId"] == S.client_id and q["pin"] == S.pin
        assert pyotp.TOTP(SECRET).verify(q["totp"], valid_window=1)
        assert tk.get_token(con, c).access_token == "tok-1"           # reused from SQLite
    assert route.call_count == 1


@respx.mock
def test_a_token_close_to_expiry_is_renewed(con):
    tk.save(con, tk.Token("old", datetime.now(config.IST) + timedelta(minutes=10)))
    respx.post(LOGIN).mock(return_value=login_ok("tok-new"))
    with httpx.Client() as c:
        assert tk.get_token(con, c).access_token == "tok-new"
    assert tk.load(con).access_token == "tok-new"


@respx.mock
def test_a_rejected_token_is_renewed_once_and_the_call_retried(con):
    tk.save(con, tk.Token("stale", datetime.now(config.IST) + timedelta(hours=10)))
    respx.post(LOGIN).mock(return_value=login_ok("fresh"))
    prof = respx.get(PROFILE).mock(side_effect=[
        httpx.Response(401, json={"errorCode": "DH-901", "errorMessage": "Invalid token"}),
        httpx.Response(200, json={"dhanClientId": S.client_id, "dataPlan": "Active", "dataValidity": "2026-12-12 09:00:00.0"}),
    ])
    with httpx.Client() as c:
        assert tk.profile(con, c)["dataPlan"] == "Active"
    assert [call.request.headers["access-token"] for call in prof.calls] == ["stale", "fresh"]


@respx.mock
def test_wrong_pin_or_totp_gives_a_clear_error_without_secrets(con, caplog):
    respx.post(LOGIN).mock(return_value=httpx.Response(400, json={"errorCode": "DH-905", "errorMessage": "Invalid TOTP"}))
    caplog.set_level(logging.DEBUG)
    with httpx.Client() as c, pytest.raises(tk.TokenError) as e:
        tk.get_token(con, c)
    text = str(e.value) + caplog.text
    assert "Invalid TOTP" in text and "DHAN_PIN" in text
    assert S.pin not in text and SECRET not in text


@respx.mock
def test_network_error_message_has_no_url_or_pin(con):
    respx.post(LOGIN).mock(side_effect=httpx.ConnectError("boom"))
    with httpx.Client() as c, pytest.raises(tk.TokenError) as e:
        tk.get_token(con, c)
    assert S.pin not in str(e.value) and "generateAccessToken" not in str(e.value)


def test_missing_secrets_are_named(con, monkeypatch):
    blank = config.Secrets("", "", "", "", "")
    with httpx.Client() as c, pytest.raises(tk.TokenError, match="DHAN_CLIENT_ID, DHAN_PIN, DHAN_TOTP_SECRET"):
        tk.get_token(con, c, blank)


def test_expiry_formats():
    now = datetime(2026, 11, 12, 9, 0, tzinfo=config.IST)
    assert tk._parse_expiry("2026-11-13T09:00:00", now) == datetime(2026, 11, 13, 9, 0, tzinfo=config.IST)
    assert tk._parse_expiry("2026-11-13 09:00:00.0", now).hour == 9
    assert tk._parse_expiry("2026-11-13T03:30:00Z", now) == datetime(2026, 11, 13, 9, 0, tzinfo=config.IST)
    assert tk._parse_expiry(None, now) == now + timedelta(hours=24)


@respx.mock
def test_cli_check_prints_token_and_plan(con, monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(db, "connect", lambda path=None: con)
    respx.post(LOGIN).mock(return_value=login_ok())
    respx.get(PROFILE).mock(return_value=httpx.Response(200, json={"dhanClientId": S.client_id, "dataPlan": "Active", "dataValidity": "2026-12-12 09:00:00.0"}))
    assert tk.main(["--check"]) == 0
    out = capsys.readouterr().out
    assert out.startswith("token ok, expires") and "data plan: Active" in out and S.client_id not in out


def test_redaction_filter_blanks_pin_totp_and_tokens(caplog):
    caplog.set_level(logging.DEBUG, logger="httpx")
    lg = logging.getLogger("httpx")
    lg.setLevel(logging.DEBUG)
    try:
        lg.info("HTTP Request: POST https://auth.dhan.co/app/generateAccessToken?dhanClientId=1&pin=246810&totp=123456 \"HTTP/1.1 200\"")
    finally:
        config.quiet_http_logs()
    assert "246810" not in caplog.text and "123456" not in caplog.text and "pin=***" in caplog.text
