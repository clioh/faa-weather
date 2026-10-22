"""The phone/CLI registration session must always end in a user record."""

import json
import pickle

import pytest

import security
import web_server as ws


def _client():
    """Test client that authenticates like the backend (internal token)."""
    c = ws.app.test_client()
    c.environ_base["HTTP_X_SKYGLASS_INTERNAL"] = security.get_internal_token()
    return c


@pytest.fixture
def users_dir(monkeypatch, tmp_path):
    d = tmp_path / "face_data" / "users"
    d.mkdir(parents=True)
    monkeypatch.setattr(ws, "USERS_DIR", d)
    # Never talk to a real backend from tests.
    monkeypatch.setattr(ws, "notify_backend", lambda *a, **k: True)
    return d


def _reset_state():
    ws.registration_state.update(
        active=False, user_id=None, user_name=None, samples_captured=0, encodings=[]
    )


def test_start_records_user_and_name(users_dir):
    _reset_state()
    client = _client()
    resp = client.post("/api/start", json={"userId": "pilot-1", "name": "Clio"})
    assert resp.status_code == 200
    assert ws.registration_state["active"] is True
    assert ws.registration_state["user_id"] == "pilot-1"
    assert ws.registration_state["user_name"] == "Clio"


def test_start_without_name_uses_unknown(users_dir):
    _reset_state()
    client = _client()
    assert client.post("/api/start", json={"userId": "pilot-1"}).status_code == 200
    assert ws.registration_state["user_name"] == "Unknown"


@pytest.mark.parametrize("body", [None, {}, {"name": "Clio"}, {"userId": ""}, {"userId": 42}])
def test_start_requires_user_id(users_dir, body):
    _reset_state()
    client = _client()
    resp = client.post("/api/start", json=body) if body is not None else client.post("/api/start")
    assert resp.status_code == 400
    assert ws.registration_state["active"] is False
    assert ws.registration_state["user_id"] is None


def test_start_rejects_bad_user_id(users_dir):
    _reset_state()
    client = _client()
    resp = client.post("/api/start", json={"userId": "../x"})
    assert resp.status_code == 400
    assert ws.registration_state["active"] is False


def test_save_registration_writes_record_without_encodings(users_dir):
    _reset_state()
    ws.registration_state.update(user_id="pilot-1", user_name="Clio", samples_captured=5, encodings=[])
    ws.save_registration()

    user_dir = users_dir / "pilot-1"
    assert pickle.loads((user_dir / "encodings.pkl").read_bytes()) == []
    meta = json.loads((user_dir / "metadata.json").read_text())
    assert meta["name"] == "Clio"
    assert meta["samples"] == 5
    assert meta["encodings"] == 0
    assert meta["enrolled_at"].endswith("Z")

    # ...and the record is visible to the app
    client = _client()
    users = client.get("/api/users").get_json()["users"]
    assert [u["userId"] for u in users] == ["pilot-1"]
    assert users[0]["name"] == "Clio"
    status = client.get("/api/users/pilot-1/face").get_json()
    assert status["enrolled"] is True and status["samples"] == 5


def test_save_registration_keeps_encodings(users_dir):
    _reset_state()
    ws.registration_state.update(user_id="pilot-2", user_name="Sam", samples_captured=3, encodings=[[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]])
    ws.save_registration()
    assert len(pickle.loads((users_dir / "pilot-2" / "encodings.pkl").read_bytes())) == 3
    assert json.loads((users_dir / "pilot-2" / "metadata.json").read_text())["encodings"] == 3


class _FakeFR:
    """face_recognition stand-in; `result` is what face_encodings returns."""

    def __init__(self, result):
        self.result = result
        self.locations = None

    def face_encodings(self, _rgb, locations):
        self.locations = locations
        return self.result


@pytest.fixture
def capture(users_dir, monkeypatch):
    import numpy as np

    _reset_state()
    ws.registration_state.update(active=True, user_id="pilot-1", user_name="Clio")
    ws.open_enrollment()
    monkeypatch.setattr(ws, "get_frame", lambda: np.zeros((480, 640, 3), dtype=np.uint8))
    # One centred 140 px face, as YuNet would report it.
    monkeypatch.setattr(ws, "detect_faces", lambda _frame: [(250, 170, 140, 140)])
    monkeypatch.setattr(ws, "FR_AVAILABLE", True)
    yield _client()
    _reset_state()


def test_capture_encodes_the_detected_face(capture, monkeypatch):
    fr = _FakeFR([[0.1] * 128])
    monkeypatch.setattr(ws, "face_recognition", fr, raising=False)

    body = capture.post("/api/capture").get_json()

    assert body["success"] is True
    assert ws.registration_state["samples_captured"] == 1
    assert len(ws.registration_state["encodings"]) == 1
    # The YuNet box, converted to dlib's (top, right, bottom, left).
    assert fr.locations == [(170, 390, 310, 250)]


def test_capture_without_an_encoding_does_not_count(capture, monkeypatch):
    monkeypatch.setattr(ws, "face_recognition", _FakeFR([]), raising=False)

    body = capture.post("/api/capture").get_json()

    assert body["success"] is False
    assert ws.registration_state["samples_captured"] == 0
    assert ws.registration_state["encodings"] == []
