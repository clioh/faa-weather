"""Unit tests for security.py (no Flask app, no camera)."""

import hashlib
import os
import secrets
import stat
import threading

import pytest

import security


@pytest.fixture
def data(monkeypatch, tmp_path):
    d = tmp_path / "data"
    monkeypatch.setenv("SKYGLASS_DATA_DIR", str(d))
    monkeypatch.setenv("SKYGLASS_INTERNAL_TOKEN_FILE", str(d / "internal-token"))
    security.reset_internal_token_cache()
    yield d
    security.reset_internal_token_cache()


# ---------------------------------------------------------------- secrets


def test_internal_token_created_once_with_0600(data):
    token = security.get_internal_token()
    path = data / "internal-token"
    assert len(token) == 64 and int(token, 16) >= 0
    assert path.read_text().strip() == token
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert sorted(os.listdir(data)) == ["internal-token"]  # no temp files left
    security.reset_internal_token_cache()
    assert security.get_internal_token() == token


def test_internal_token_reuses_backend_file_and_tightens_mode(data):
    data.mkdir()
    path = data / "internal-token"
    path.write_text("b" * 64 + "\n")
    os.chmod(path, 0o644)
    assert security.get_internal_token() == "b" * 64
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_malformed_token_file_is_refused_not_replaced(data):
    data.mkdir()
    (data / "internal-token").write_text("weak")
    with pytest.raises(RuntimeError):
        security.load_or_create_token(data / "internal-token")
    assert (data / "internal-token").read_text() == "weak"


def test_concurrent_creation_yields_one_token(data):
    path = data / "race-token"
    results = []

    def worker():
        results.append(security.load_or_create_token(path))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(set(results)) == 1
    assert path.read_text().strip() == results[0]


def test_tokens_equal():
    assert security.tokens_equal("abc", "abc")
    assert not security.tokens_equal("abc", "abd")
    assert not security.tokens_equal("", "")
    assert not security.tokens_equal(None, "abc")


# ---------------------------------------------------------------- passwords


def test_password_hash_round_trip(data):
    stored = security.hash_password("correct horse battery")
    assert stored.startswith("scrypt$32768$8$1$")
    assert security.verify_password("correct horse battery", stored)
    assert not security.verify_password("correct horse batterY", stored)
    assert not security.verify_password("", stored)
    # salted: same password, different hash
    assert security.hash_password("correct horse battery") != stored


def test_old_sha256_format_is_rejected(data):
    salt = secrets.token_hex(16)
    legacy = f"{salt}:{hashlib.sha256((salt + 'hunter2hunter2').encode()).hexdigest()}"
    assert not security.verify_password("hunter2hunter2", legacy)
    data.mkdir()
    security.admin_password_path().write_text(legacy)
    assert not security.is_password_set()
    assert security.has_legacy_password()
    # the CLI path replaces it
    security.store_password("a brand new password")
    assert security.is_password_set()
    assert not security.has_legacy_password()
    assert security.verify_password("a brand new password", security.read_password_hash())


def test_weak_or_expensive_parameters_rejected():
    good = security.hash_password("whatever-password")
    parts = good.split("$")
    weak = "$".join([parts[0], "1024"] + parts[2:])
    huge = "$".join([parts[0], str(2**20)] + parts[2:])
    assert not security.verify_password("whatever-password", weak)
    assert not security.verify_password("whatever-password", huge)


def test_store_password_file_mode_and_policy(data):
    with pytest.raises(ValueError):
        security.store_password("short")
    with pytest.raises(ValueError):
        security.store_password("x" * 300)
    security.store_password("long enough password")
    path = security.admin_password_path()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    fp1 = security.password_fingerprint()
    security.store_password("another long password")
    assert security.password_fingerprint() != fp1
    assert security.clear_password()
    assert not security.is_password_set()
    assert security.password_fingerprint() is None


def test_cli_sets_and_clears(data, monkeypatch, capsys):
    import io

    import set_admin_password as cli

    monkeypatch.setattr("sys.stdin", io.StringIO("cli password 123\n"))
    assert cli.main(["--stdin"]) == 0
    assert security.verify_password("cli password 123", security.read_password_hash())
    monkeypatch.setattr("sys.stdin", io.StringIO("short\n"))
    assert cli.main(["--stdin"]) == 1
    assert cli.main(["--clear"]) == 0
    assert not security.is_password_set()


# ---------------------------------------------------------------- limiter


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_login_limiter_per_client_lockout_and_expiry():
    clock = Clock()
    lim = security.LoginLimiter(per_client=3, global_limit=100, window=60, clock=clock)
    for _ in range(3):
        assert lim.retry_after("1.2.3.4") == 0
        lim.record_failure("1.2.3.4")
    assert lim.retry_after("1.2.3.4") > 0
    assert lim.retry_after("5.6.7.8") == 0  # other clients unaffected
    clock.t += 61
    assert lim.retry_after("1.2.3.4") == 0


def test_login_limiter_global_lockout():
    clock = Clock()
    lim = security.LoginLimiter(per_client=100, global_limit=5, window=60, clock=clock)
    for i in range(5):
        lim.record_failure(f"10.0.0.{i}")
    assert lim.retry_after("10.0.0.99") > 0


def test_login_limiter_success_clears_client():
    lim = security.LoginLimiter(per_client=2, global_limit=100, window=60, clock=Clock())
    lim.record_failure("a")
    lim.record_success("a")
    lim.record_failure("a")
    assert lim.retry_after("a") == 0


# ---------------------------------------------------------------- enrollment


def test_enrollment_gate_lifecycle_and_expiry():
    clock = Clock()
    gate = security.EnrollmentGate(ttl=600, clock=clock, wall_clock=lambda: 5000.0)
    assert not gate.is_open()
    assert not gate.check("anything")
    token, expires = gate.open()
    assert expires == 5600.0
    assert gate.check(token)
    assert not gate.check(token + "x")
    assert not gate.check(None)
    clock.t += 599
    assert gate.check(token)
    clock.t += 2
    assert not gate.check(token)
    assert not gate.is_open()
    assert gate.expires_at is None


def test_enrollment_gate_close_and_reopen_invalidate_old_token():
    gate = security.EnrollmentGate(ttl=600, clock=Clock())
    t1, _ = gate.open()
    t2, _ = gate.open()
    assert t1 != t2
    assert not gate.check(t1)
    assert gate.check(t2)
    gate.close()
    assert not gate.check(t2)


# ---------------------------------------------------------------- CSRF


class Req:
    def __init__(self, method="POST", host="skyglass.local:5000", headers=None):
        self.method = method
        self.host = host
        self.headers = headers or {}


@pytest.mark.parametrize("headers,ok", [
    ({"X-SkyGlass-Request": "1", "Origin": "http://skyglass.local:5000"}, True),
    ({"X-SkyGlass-Request": "1", "Referer": "http://skyglass.local:5000/admin"}, True),
    ({"Origin": "http://skyglass.local:5000"}, False),               # no custom header
    ({"X-SkyGlass-Request": "1"}, False),                            # no Origin/Referer
    ({"X-SkyGlass-Request": "1", "Origin": "http://evil.example"}, False),
    ({"X-SkyGlass-Request": "1", "Origin": "null"}, False),
    ({"X-SkyGlass-Request": "1", "Origin": "http://skyglass.local:5000.evil.example"}, False),
    ({"X-SkyGlass-Request": "1", "Origin": "http://evil.example",
      "Referer": "http://skyglass.local:5000/"}, False),             # Origin wins
])
def test_csrf_ok(headers, ok):
    assert security.csrf_ok(Req(headers=headers)) is ok


def test_csrf_safe_methods_pass():
    assert security.csrf_ok(Req(method="GET"))
