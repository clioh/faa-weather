"""Camera selection (cameras.py) and handing the camera between the detector and the admin server."""

import json
import os
import subprocess
import sys
import time

import pytest

import cameras
import detector
import security
import web_server as ws

REAL_OPEN_CAMERA = cameras.open_camera  # conftest replaces it with a fake for every test


# --- USB webcam discovery ---------------------------------------------------------


def _v4l_node(sysfs, drivers, name, driver, index="0"):
    node = sysfs / name
    (node / "device").mkdir(parents=True)
    (drivers / driver).mkdir(exist_ok=True)
    os.symlink(drivers / driver, node / "device" / "driver")
    (node / "index").write_text(index + "\n")


def test_usb_cameras_lists_uvc_capture_nodes_only(tmp_path):
    sysfs, drivers = tmp_path / "video4linux", tmp_path / "drivers"
    sysfs.mkdir()
    drivers.mkdir()
    _v4l_node(sysfs, drivers, "video0", "rp1-cfe")        # Pi 5 camera front end
    _v4l_node(sysfs, drivers, "video19", "pispbe")        # Pi 5 ISP
    _v4l_node(sysfs, drivers, "video10", "uvcvideo")      # second webcam, capture
    _v4l_node(sysfs, drivers, "video8", "uvcvideo")       # first webcam, capture
    _v4l_node(sysfs, drivers, "video9", "uvcvideo", "1")  # first webcam, metadata
    assert cameras.usb_cameras(sysfs) == ["/dev/video8", "/dev/video10"]


def test_usb_cameras_empty_without_sysfs(tmp_path):
    assert cameras.usb_cameras(tmp_path / "missing") == []


# --- Choosing a camera --------------------------------------------------------------


@pytest.fixture
def opened(monkeypatch):
    """Record which opener open_camera picks instead of touching hardware."""
    calls = []
    monkeypatch.setattr(cameras, "_open_pi_camera", lambda info: calls.append(("pi", info["Model"])) or "pi")
    monkeypatch.setattr(cameras, "_open_opencv", lambda target, name: calls.append(("opencv", target)) or "cv")
    return calls


def test_pi_camera_wins(monkeypatch, opened):
    monkeypatch.setattr(cameras, "pi_cameras", lambda: [{"Model": "imx708", "Num": 0}])
    monkeypatch.setattr(cameras, "usb_cameras", lambda: ["/dev/video8"])
    assert REAL_OPEN_CAMERA(0) == "pi"
    assert opened == [("pi", "imx708")]


def test_index_past_the_pi_cameras_fails(monkeypatch, opened):
    monkeypatch.setattr(cameras, "pi_cameras", lambda: [{"Model": "imx708", "Num": 0}])
    assert REAL_OPEN_CAMERA(1) is None
    assert opened == []


def test_usb_camera_by_position(monkeypatch, opened):
    monkeypatch.setattr(cameras, "pi_cameras", lambda: [])
    monkeypatch.setattr(cameras, "usb_cameras", lambda: ["/dev/video8", "/dev/video10"])
    assert REAL_OPEN_CAMERA(1) == "cv"
    assert opened == [("opencv", "/dev/video10")]
    assert REAL_OPEN_CAMERA(2) is None


def test_plain_index_off_linux(monkeypatch, opened):
    monkeypatch.setattr(cameras, "pi_cameras", lambda: [])
    monkeypatch.setattr(cameras, "usb_cameras", lambda: [])
    assert REAL_OPEN_CAMERA(0) == "cv"
    assert opened == [("opencv", 0)]


def test_pi_cameras_skips_usb_entries(monkeypatch):
    class FakePicamera2:
        @staticmethod
        def global_camera_info():
            return [
                {"Model": "uvcvideo", "Id": "/base/axi/pcie@120000/rp1/usb@200000-1:1.0-046d:0825"},
                {"Model": "imx708", "Id": "/base/axi/pcie@120000/rp1/i2c@88000/imx708@1a"},
            ]

    monkeypatch.setattr(cameras, "_picamera2", lambda: FakePicamera2)
    assert [(c["Model"], c["Num"]) for c in cameras.pi_cameras()] == [("imx708", 1)]


def test_pi_cameras_without_picamera2(monkeypatch):
    monkeypatch.setattr(cameras, "_picamera2", lambda: None)
    assert cameras.pi_cameras() == []


# --- Claims ---------------------------------------------------------------------------


def _write_claim(pid, until):
    path = security.data_dir() / cameras.CLAIM_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"pid": pid, "until": until}))


@pytest.fixture(autouse=True)
def _no_claim():
    yield
    (security.data_dir() / cameras.CLAIM_FILENAME).unlink(missing_ok=True)


def test_claim_from_another_live_process_counts():
    _write_claim(os.getppid(), time.time() + 60)
    assert cameras.camera_claimed() is True


def test_own_expired_or_dead_claims_do_not_count():
    _write_claim(os.getpid(), time.time() + 60)
    assert cameras.camera_claimed() is False
    _write_claim(os.getppid(), time.time() - 1)
    assert cameras.camera_claimed() is False
    dead = subprocess.Popen([sys.executable, "-c", "pass"])
    dead.wait()
    _write_claim(dead.pid, time.time() + 60)
    assert cameras.camera_claimed() is False


def test_release_claim_leaves_other_process_claims_alone():
    _write_claim(os.getppid(), time.time() + 60)
    cameras.release_claim()
    assert cameras.camera_claimed() is True
    cameras.claim_camera(60)
    cameras.release_claim()
    assert not (security.data_dir() / cameras.CLAIM_FILENAME).exists()


# --- Detector side: lend the camera while claimed -----------------------------------------


class _Owner(detector.CameraOwner):
    def __init__(self):
        self.camera_index = 0
        self.cap = None
        self.events = []

    def start_camera(self):
        self.events.append("start")
        return True

    def stop_camera(self):
        self.events.append("stop")


def test_detector_releases_camera_until_claim_ends(monkeypatch):
    claims = iter([True, True, True, False])
    monkeypatch.setattr(cameras, "camera_claimed", lambda: next(claims))
    monkeypatch.setattr(detector.time, "sleep", lambda _s: None)
    owner = _Owner()
    owner.lend_camera_if_claimed()
    assert owner.events == ["stop", "start"]


def test_detector_checks_for_claims_at_most_every_poll_interval(monkeypatch):
    checks = []
    monkeypatch.setattr(cameras, "camera_claimed", lambda: checks.append(1) or False)
    owner = _Owner()
    owner.lend_camera_if_claimed()
    owner.lend_camera_if_claimed()
    assert len(checks) == 1


# --- Admin server side: open per enrollment session ---------------------------------------


def _client():
    c = ws.app.test_client()
    c.environ_base["HTTP_X_SKYGLASS_INTERNAL"] = security.get_internal_token()
    return c


@pytest.fixture
def no_backend(monkeypatch, tmp_path):
    monkeypatch.setattr(ws, "USERS_DIR", tmp_path / "users")
    monkeypatch.setattr(ws, "notify_backend", lambda *a, **k: True)


def test_session_claims_opens_and_returns_the_camera(no_backend, fake_camera):
    client = _client()
    assert client.post("/api/start", json={"userId": "pilot-1"}).status_code == 200
    claim = json.loads((security.data_dir() / cameras.CLAIM_FILENAME).read_text())
    assert claim["pid"] == os.getpid()
    assert len(fake_camera) == 1 and ws.camera is fake_camera[0]

    assert client.post("/api/reset").status_code == 200
    assert fake_camera[0].released
    assert ws.camera is None
    assert not (security.data_dir() / cameras.CLAIM_FILENAME).exists()


def test_start_fails_cleanly_without_a_camera(no_backend, monkeypatch):
    monkeypatch.setattr(cameras, "open_camera", lambda index=0: None)
    monkeypatch.setattr(ws, "CAMERA_OPEN_TIMEOUT", 0)
    resp = _client().post("/api/start", json={"userId": "pilot-1"})
    assert resp.status_code == 503
    assert ws.registration_state["active"] is False
    assert not (security.data_dir() / cameras.CLAIM_FILENAME).exists()


def test_camera_index_comes_from_presence_config(no_backend, monkeypatch):
    seen = []
    real_open = cameras.open_camera  # the conftest fake
    monkeypatch.setattr(cameras, "open_camera", lambda index=0: seen.append(index) or real_open(index))
    monkeypatch.setattr(ws, "resolve_settings", lambda _args: ({"camera_index": 2}, {}))
    monkeypatch.setattr(ws, "camera_index", None)
    assert _client().post("/api/start", json={"userId": "pilot-1"}).status_code == 200
    assert seen == [2]
