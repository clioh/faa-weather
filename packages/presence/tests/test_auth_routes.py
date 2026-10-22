"""Access control on every route of the presence/admin server (docs/SECURITY.md)."""

import numpy as np
import pytest

import admin_portal as ap
import security
import web_server as ws

HOST = "skyglass.local:5000"
ORIGIN = f"http://{HOST}"
LAN = {"REMOTE_ADDR": "192.168.1.50"}
LOOPBACK = {"REMOTE_ADDR": "127.0.0.1"}
PASSWORD = "correct horse battery"

# (method, path) of every device-control route.
DEVICE_ROUTES = [
    ("GET", "/api/users"),
    ("GET", "/api/users/u1/face"),
    ("DELETE", "/api/users/u1/face"),
    ("GET", "/api/admin/logs"),
    ("GET", "/api/admin/wifi/status"),
    ("GET", "/api/admin/wifi/scan"),
    ("POST", "/api/admin/wifi/connect"),
    ("POST", "/api/admin/password"),
]
CAMERA_ROUTES = [
    ("GET", "/video_feed"),
    ("POST", "/api/start"),
    ("POST", "/api/capture"),
    ("POST", "/api/reset"),
]


@pytest.fixture
def env(monkeypatch, tmp_path):
    users = tmp_path / "users"
    (users / "u1").mkdir(parents=True)
    (users / "u1" / "encodings.pkl").write_bytes(b"x")
    monkeypatch.setattr(ws, "USERS_DIR", users)
    monkeypatch.setattr(ap, "LOG_DIR", tmp_path / "logs")
    monkeypatch.setattr(ap.platform, "system", lambda: "Darwin")  # never run wpa_cli
    notified = []
    monkeypatch.setattr(ws, "notify_backend", lambda ep, data: notified.append((ep, data)) or True)
    monkeypatch.setattr(ws, "get_frame", lambda: np.zeros((480, 640, 3), dtype=np.uint8))
    monkeypatch.setattr(ws, "detect_faces", lambda _f: [])
    return notified


def call(client, method, path, headers=None, environ=None, **kw):
    kw.setdefault("json", {"ssid": "home", "password": "longenough1", "new_password": "x" * 12}
                  if method == "POST" else None)
    if kw["json"] is None:
        del kw["json"]
    return client.open(path, method=method, headers=headers or {},
                       environ_base=environ or LAN, base_url=ORIGIN, **kw)


def login(client, password=PASSWORD, environ=None):
    return client.post("/admin/login", data={"password": password}, base_url=ORIGIN,
                       headers={"Origin": ORIGIN}, environ_base=environ or LAN)


# ------------------------------------------------------------ unauthenticated


@pytest.mark.parametrize("method,path", DEVICE_ROUTES + CAMERA_ROUTES)
@pytest.mark.parametrize("password_set", [False, True])
def test_unauthenticated_requests_are_refused(env, method, path, password_set):
    if password_set:
        security.store_password(PASSWORD)
    client = ws.app.test_client()
    for environ in (LAN, LOOPBACK):  # loopback earns nothing
        resp = call(client, method, path, environ=environ)
        assert resp.status_code in (401, 403), (method, path, resp.status_code)
    assert (ws.USERS_DIR / "u1").exists()
    assert not ws.registration_state["active"]


def test_wrong_internal_token_is_refused(env):
    client = ws.app.test_client()
    bad = {security.INTERNAL_HEADER: "0" * 64}
    for method, path in DEVICE_ROUTES + [("POST", "/api/start")]:
        assert call(client, method, path, headers=bad).status_code == 401, path


def test_public_routes(env):
    client = ws.app.test_client()
    assert client.get("/api/health").status_code == 200
    status = client.get("/api/status")
    assert status.status_code == 200
    assert "Access-Control-Allow-Origin" not in status.headers
    assert status.headers["X-Frame-Options"] == "DENY"


# ------------------------------------------------------------ internal token


def test_internal_token_reaches_device_controls(env, internal):
    client = ws.app.test_client()
    users = call(client, "GET", "/api/users", headers=internal)
    assert users.status_code == 200 and users.get_json()["users"][0]["userId"] == "u1"
    assert call(client, "GET", "/api/admin/wifi/status", headers=internal).status_code == 200
    assert call(client, "GET", "/api/admin/logs", headers=internal).status_code == 200
    assert call(client, "DELETE", "/api/users/u1/face", headers=internal).status_code == 200
    assert not (ws.USERS_DIR / "u1").exists()


def test_internal_token_may_set_password_without_current(env, internal):
    client = ws.app.test_client()
    resp = call(client, "POST", "/api/admin/password", headers=internal,
                json={"new_password": "set by the backend"})
    assert resp.status_code == 200
    assert security.verify_password("set by the backend", security.read_password_hash())


# ------------------------------------------------------------ admin session


def test_no_password_means_no_admin_access(env):
    client = ws.app.test_client()
    page = client.get("/admin", base_url=ORIGIN)
    assert page.status_code == 403 and b"set_admin_password.py" in page.data
    assert client.get("/admin/login", base_url=ORIGIN).status_code == 403
    assert login(client, "").status_code == 403
    # a forged session cookie flag is useless without a password fingerprint
    with client.session_transaction() as sess:
        sess["authenticated"] = True
    assert call(client, "GET", "/api/users").status_code == 401
    # and nobody can claim the portal by setting the first password remotely
    resp = call(client, "POST", "/api/admin/password", json={"new_password": "takeover password"},
                headers={"X-SkyGlass-Request": "1", "Origin": ORIGIN})
    assert resp.status_code == 401
    assert not security.is_password_set()


def test_legacy_password_file_disables_portal(env):
    security.admin_password_path().parent.mkdir(parents=True, exist_ok=True)
    security.admin_password_path().write_text("abcd:" + "0" * 64)
    client = ws.app.test_client()
    page = client.get("/admin", base_url=ORIGIN)
    assert page.status_code == 403 and b"old format" in page.data


def test_admin_session_flow(env):
    security.store_password(PASSWORD)
    client = ws.app.test_client()
    assert client.get("/admin", base_url=ORIGIN).status_code == 302
    assert login(client, "wrong password").status_code == 401
    resp = login(client)
    assert resp.status_code == 302
    cookie = resp.headers["Set-Cookie"]
    assert "HttpOnly" in cookie and "SameSite=Strict" in cookie
    assert client.get("/admin", base_url=ORIGIN).status_code == 200
    assert call(client, "GET", "/api/users").status_code == 200
    # state change needs the CSRF header + same origin
    csrf = {"X-SkyGlass-Request": "1", "Origin": ORIGIN}
    assert call(client, "POST", "/api/admin/wifi/connect", json={"ssid": "home"}).status_code == 403
    assert call(client, "POST", "/api/admin/wifi/connect", json={"ssid": "home"},
                headers={"X-SkyGlass-Request": "1", "Origin": "http://evil.example"}).status_code == 403
    assert call(client, "POST", "/api/admin/wifi/connect", json={"ssid": "home"},
                headers=csrf).status_code == 200
    assert call(client, "DELETE", "/api/users/u1/face", headers={"Origin": ORIGIN}).status_code == 403
    assert (ws.USERS_DIR / "u1").exists()
    assert call(client, "DELETE", "/api/users/u1/face", headers=csrf).status_code == 200
    # an admin session never opens the camera
    assert call(client, "POST", "/api/start", json={"userId": "u2"}, headers=csrf).status_code == 401
    assert client.get("/video_feed", base_url=ORIGIN).status_code == 403
    # logout
    client.post("/admin/logout", base_url=ORIGIN)
    assert call(client, "GET", "/api/users").status_code == 401


def test_password_change_requires_current_and_logs_everyone_out(env):
    security.store_password(PASSWORD)
    a, b = ws.app.test_client(), ws.app.test_client()
    login(a)
    login(b)
    csrf = {"X-SkyGlass-Request": "1", "Origin": ORIGIN}
    bad = call(a, "POST", "/api/admin/password", headers=csrf,
               json={"current_password": "nope", "new_password": "another password"})
    assert bad.status_code == 403
    short = call(a, "POST", "/api/admin/password", headers=csrf,
                 json={"current_password": PASSWORD, "new_password": ""})
    assert short.status_code == 400 and security.is_password_set()
    ok = call(a, "POST", "/api/admin/password", headers=csrf,
              json={"current_password": PASSWORD, "new_password": "another password"})
    assert ok.status_code == 200
    assert call(a, "GET", "/api/users").status_code == 401
    assert call(b, "GET", "/api/users").status_code == 401
    assert login(b, "another password").status_code == 302


def test_login_csrf_and_rate_limit(env):
    security.store_password(PASSWORD)
    client = ws.app.test_client()
    cross = client.post("/admin/login", data={"password": PASSWORD}, base_url=ORIGIN,
                        headers={"Origin": "http://evil.example"}, environ_base=LAN)
    assert cross.status_code == 403
    for _ in range(ap.login_limiter.per_client):
        assert login(client, "wrong password").status_code == 401
    locked = login(client)  # even the right password is refused while locked
    assert locked.status_code == 429 and int(locked.headers["Retry-After"]) > 0
    other = ws.app.test_client()
    assert login(other, environ={"REMOTE_ADDR": "192.168.1.51"}).status_code == 302


def test_wifi_connect_validates_input(env, internal):
    client = ws.app.test_client()
    for body in ({"ssid": ""}, {"ssid": "x" * 33}, {"ssid": "home", "password": "short"},
                 {"ssid": "home", "password": 'abc"\nnetwork={'}):
        assert call(client, "POST", "/api/admin/wifi/connect", headers=internal, json=body).status_code == 400


def test_wpa_psk_matches_wpa_passphrase():
    # wpa_passphrase "IEEE" "password" (IEEE 802.11i test vector)
    assert ap.wpa_psk("IEEE", "password") == \
        "f42c6fc52df0ebef9ebb4b90b38a5f902e83fe1b135a70e23aed762e9710a12e"


# ------------------------------------------------------------ enrollment


def start(client, internal, user="pilot-1"):
    resp = call(client, "POST", "/api/start", headers=internal, json={"userId": user, "name": "Clio"})
    assert resp.status_code == 200
    return resp.get_json()


def test_enrollment_token_lifecycle(env, internal):
    client = ws.app.test_client()
    body = start(client, internal)
    token = body["enrollmentToken"]
    assert len(token) >= 40 and body["ttlSeconds"] == 600 and body["expiresAt"] > 0
    assert not any(ep == "start" for ep, _ in env)  # the backend shows the overlay itself

    # header for API calls
    enroll = {security.ENROLLMENT_HEADER: token}
    assert call(client, "POST", "/api/capture", headers=enroll).status_code == 200
    assert call(client, "POST", "/api/capture",
                headers={security.ENROLLMENT_HEADER: token[:-1] + "x"}).status_code == 403

    # query param for the MJPEG <img>; refused without it
    assert client.get("/video_feed").status_code == 403
    assert client.get("/video_feed?token=nope").status_code == 403
    stream = client.get(f"/video_feed?token={token}", buffered=False)
    assert stream.status_code == 200
    assert stream.mimetype == "multipart/x-mixed-replace"
    chunks = iter(stream.response)
    assert next(chunks).startswith(b"--frame")

    # ending the session closes the open stream and invalidates the token
    assert call(client, "POST", "/api/reset", headers=enroll).status_code == 200
    with pytest.raises(StopIteration):
        for _ in range(5):
            next(chunks)
    stream.close()
    assert client.get(f"/video_feed?token={token}").status_code == 403
    assert call(client, "POST", "/api/capture", headers=enroll).status_code == 403
    assert ("cancel", {"source": "presence-server"}) in env


def test_new_session_invalidates_old_token(env, internal):
    client = ws.app.test_client()
    old = start(client, internal)["enrollmentToken"]
    new = start(client, internal, "pilot-2")["enrollmentToken"]
    assert client.get(f"/video_feed?token={old}").status_code == 403
    resp = client.get(f"/video_feed?token={new}", buffered=False)
    assert resp.status_code == 200
    resp.close()


def test_enrollment_token_expires(env, internal, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(ws, "enrollment_gate",
                        security.EnrollmentGate(ttl=600, clock=lambda: clock[0]))
    client = ws.app.test_client()
    token = start(client, internal)["enrollmentToken"]
    clock[0] += 599
    resp = client.get(f"/video_feed?token={token}", buffered=False)
    assert resp.status_code == 200
    resp.close()
    clock[0] += 2
    assert client.get(f"/video_feed?token={token}").status_code == 403
    assert client.get("/api/status").get_json()["registration_active"] is False
    assert ("cancel", {"source": "presence-server"}) in env


def test_completed_enrollment_closes_session(env, internal, monkeypatch):
    monkeypatch.setattr(ws, "detect_faces", lambda _f: [(250, 170, 140, 140)])
    monkeypatch.setattr(ws, "FR_AVAILABLE", False)
    client = ws.app.test_client()
    token = start(client, internal)["enrollmentToken"]
    for i in range(5):
        body = call(client, "POST", "/api/capture", headers=internal).get_json()
        assert body["success"] and body["samples_captured"] == i + 1
    assert body["complete"] is True
    assert client.get(f"/video_feed?token={token}").status_code == 403
    assert ("complete", {}) in env


def test_video_stream_cap(env, internal):
    client = ws.app.test_client()
    token = start(client, internal)["enrollmentToken"]
    open_streams = [client.get(f"/video_feed?token={token}", buffered=False)
                    for _ in range(ws.MAX_VIDEO_STREAMS)]
    assert all(r.status_code == 200 for r in open_streams)
    assert client.get(f"/video_feed?token={token}").status_code == 503
    open_streams[0].close()
    again = client.get(f"/video_feed?token={token}", buffered=False)
    assert again.status_code == 200
    for r in open_streams[1:] + [again]:
        r.close()
