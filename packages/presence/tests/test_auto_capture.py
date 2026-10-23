"""Hands-free enrollment capture: pose, framing, the step machine and the
web server's per-session capture thread."""

import time

import pytest

import auto_capture as ac
import security
import web_server as ws
from face_detect import Face

FRAME = (480, 640, 3)
EYE = 60  # eye distance of the synthetic faces, px


def face(yaw=0.0, pitch=0.5, mouth=0.8, centre=(320, 240), width=160, roll=False):
    """Synthetic YuNet face: landmarks built from the wanted pose values."""
    cx, cy = centre
    eye_y = cy - 20
    mouth_y = eye_y + 70
    pts = {
        "right_eye": (cx - EYE / 2, eye_y),
        "left_eye": (cx + EYE / 2, eye_y),
        "nose": (cx + yaw * EYE, eye_y + pitch * (mouth_y - eye_y)),
        "mouth_right": (cx - mouth * EYE / 2, mouth_y),
        "mouth_left": (cx + mouth * EYE / 2, mouth_y),
    }
    if roll:  # head tilted sideways by 90 degrees about the eye midpoint
        ox, oy = cx, eye_y
        pts = {k: (ox - (y - oy), oy + (x - ox)) for k, (x, y) in pts.items()}
    return Face(box=(int(cx - width / 2), int(cy - width / 2), width, width), score=0.9,
                **{k: (int(round(x)), int(round(y))) for k, (x, y) in pts.items()})


# ------------------------------------------------------------ pose + framing


def test_estimate_pose_frontal():
    p = ac.estimate_pose(face())
    assert p.yaw == pytest.approx(0, abs=0.02)
    assert p.pitch == pytest.approx(0.5, abs=0.02)
    assert p.mouth == pytest.approx(0.8, abs=0.04)


def test_estimate_pose_signs_and_roll_invariance():
    assert ac.estimate_pose(face(yaw=0.3)).yaw == pytest.approx(0.3, abs=0.02)
    assert ac.estimate_pose(face(yaw=-0.3)).yaw == pytest.approx(-0.3, abs=0.02)
    assert ac.estimate_pose(face(pitch=0.35)).pitch < ac.estimate_pose(face()).pitch
    rolled = ac.estimate_pose(face(yaw=0.3, pitch=0.4, roll=True))
    assert rolled.yaw == pytest.approx(0.3, abs=0.03)
    assert rolled.pitch == pytest.approx(0.4, abs=0.03)


def test_estimate_pose_without_landmarks():
    assert ac.estimate_pose((250, 170, 140, 140)) is None
    degenerate = face()
    degenerate.left_eye = degenerate.right_eye
    assert ac.estimate_pose(degenerate) is None


@pytest.mark.parametrize("faces,reason", [
    ([], ac.NO_FACE),
    ([face(), face(centre=(100, 100))], ac.MULTIPLE),
    ([face(width=110)], ac.TOO_FAR),
    ([face(centre=(420, 240))], ac.OFF_CENTRE),
    ([face(centre=(320, 340))], ac.OFF_CENTRE),
    ([face(centre=(395, 310))], None),
    ([(250, 170, 140, 140)], None),  # plain boxes work too
    ([(250, 170, 119, 140)], ac.TOO_FAR),
])
def test_assess_framing(faces, reason):
    assert ac.assess_framing(faces, FRAME) == reason


# ------------------------------------------------------------ step machine


class Clock:
    def __init__(self):
        self.t = 100.0

    def tick(self, s=0.1):
        self.t += s
        return self.t


def run(auto, clock, f, seconds, step=0.1):
    """Feed the same face for ``seconds``; returns the decisions."""
    out = []
    for _ in range(int(round(seconds / step))):
        out.append(auto.update([f], FRAME, clock.tick(step)))
    return out


def take(auto, clock, f):
    """Hold ``f`` until a capture decision, store it, wait out the cooldown."""
    for d in run(auto, clock, f, ac.HOLD_SECONDS + 0.3):
        if d.capture:
            auto.captured(clock.t, f)
            run(auto, clock, f, ac.COOLDOWN + 0.1)
            return d
    raise AssertionError(f"no capture at step {auto.step}")


def test_step0_captures_after_a_steady_hold_and_records_the_baseline():
    auto, clock = ac.AutoCapture(), Clock()
    decisions = run(auto, clock, face(yaw=0.05, pitch=0.55), ac.HOLD_SECONDS + 0.2)
    assert decisions[0].reason == ac.HOLD and decisions[0].hold_restarted
    assert decisions[0].hold_ms == int(ac.HOLD_SECONDS * 1000)
    first = next(i for i, d in enumerate(decisions) if d.capture)
    assert first >= int(ac.HOLD_SECONDS * 10) - 1  # ~1 s at 10 fps, give or take float rounding
    auto.captured(clock.t, face(yaw=0.05, pitch=0.55))
    assert auto.step == 1
    assert auto.baseline.yaw == pytest.approx(0.05, abs=0.02)
    assert auto.update([face()], FRAME, clock.tick()).reason == ac.COOLDOWN_REASON


def test_framing_reasons_reset_the_hold():
    auto, clock = ac.AutoCapture(), Clock()
    run(auto, clock, face(), 0.8)
    assert auto.update([], FRAME, clock.tick()).reason == ac.NO_FACE
    d = auto.update([face()], FRAME, clock.tick())
    assert d.reason == ac.HOLD and d.hold_restarted and not d.capture


def test_moving_face_restarts_the_hold():
    auto, clock = ac.AutoCapture(), Clock()
    run(auto, clock, face(), 0.8)
    d = auto.update([face(centre=(320 + ac.STILL_PX + 4, 240))], FRAME, clock.tick())
    assert d.hold_restarted and d.hold_ms > 900
    # small jitter keeps the hold
    run(auto, clock, face(centre=(336, 240)), 0.5)
    assert any(d.capture for d in run(auto, clock, face(centre=(330, 242)), 0.6))


def test_turn_steps_need_a_turn_and_then_the_opposite_side():
    auto, clock = ac.AutoCapture(), Clock()
    take(auto, clock, face())
    # step 1: a small turn is not enough, either side is fine
    assert run(auto, clock, face(yaw=0.08), 0.3)[-1].reason == ac.TURN_MORE
    take(auto, clock, face(yaw=-0.25))
    assert auto.first_turn == -1
    # step 2: the same side again is refused, the other side is taken
    assert run(auto, clock, face(yaw=-0.25), 0.3)[-1].reason == ac.OTHER_WAY
    assert run(auto, clock, face(yaw=0.1), 0.3)[-1].reason == ac.TURN_MORE
    take(auto, clock, face(yaw=0.25))
    assert auto.step == 3


def test_tilt_and_smile_steps():
    auto, clock = ac.AutoCapture(), Clock()
    take(auto, clock, face(pitch=0.5, mouth=0.8))
    take(auto, clock, face(yaw=0.3))
    take(auto, clock, face(yaw=-0.3))
    assert run(auto, clock, face(pitch=0.47), 0.3)[-1].reason == ac.TURN_MORE
    assert run(auto, clock, face(pitch=0.55), 0.3)[-1].reason == ac.TURN_MORE  # tilted down
    take(auto, clock, face(pitch=0.4))
    assert run(auto, clock, face(mouth=0.82), 0.3)[-1].reason == ac.TURN_MORE
    assert run(auto, clock, face(mouth=0.95, yaw=0.3), 0.3)[-1].reason == ac.TURN_MORE  # not frontal
    take(auto, clock, face(mouth=0.95))
    assert auto.done


def test_patience_drops_the_pose_rule():
    auto, clock = ac.AutoCapture(), Clock()
    take(auto, clock, face())
    decisions = run(auto, clock, face(yaw=0.02), ac.POSE_PATIENCE + ac.HOLD_SECONDS + 0.3)
    assert decisions[0].reason == ac.TURN_MORE
    assert any(d.capture for d in decisions)
    auto.captured(clock.t, face(yaw=0.02))
    assert auto.first_turn == 0  # too small to tell: step 2 accepts either side


def test_patience_only_counts_framed_time():
    auto, clock = ac.AutoCapture(), Clock()
    take(auto, clock, face())
    for _ in range(int(ac.POSE_PATIENCE * 10) + 20):
        auto.update([], FRAME, clock.tick())
    assert auto.update([face(yaw=0.02)], FRAME, clock.tick()).reason == ac.TURN_MORE
    # one long gap between updates counts for at most half a second
    assert auto.update([face(yaw=0.02)], FRAME, clock.tick(60)).reason == ac.TURN_MORE


def test_cooldown_after_a_capture():
    auto, clock = ac.AutoCapture(), Clock()
    for d in run(auto, clock, face(), 1.3):
        if d.capture:
            break
    auto.captured(clock.t, face())
    assert run(auto, clock, face(yaw=0.3), ac.COOLDOWN - 0.2)[-1].reason == ac.COOLDOWN_REASON
    assert run(auto, clock, face(yaw=0.3), 0.3)[-1].reason == ac.HOLD


def test_failed_encoding_keeps_the_step():
    auto, clock = ac.AutoCapture(), Clock()
    assert any(d.capture for d in run(auto, clock, face(), 1.2))
    auto.capture_failed()
    assert auto.step == 0
    d = auto.update([face()], FRAME, clock.tick())
    assert d.reason == ac.HOLD and d.hold_restarted and not d.capture
    take(auto, clock, face())
    assert auto.step == 1


def test_manual_capture_without_landmarks_adopts_a_baseline():
    auto, clock = ac.AutoCapture(), Clock()
    auto.captured(clock.t, (250, 170, 140, 140))  # manual step 0, box only
    run(auto, clock, face(), ac.COOLDOWN + 0.1)
    assert auto.baseline is not None
    take(auto, clock, face(yaw=0.3))
    assert auto.step == 2 and auto.first_turn == 1


# ------------------------------------------------------------ web server


@pytest.fixture
def server(monkeypatch, tmp_path):
    """Presence server with no backend, no FR and a stubbed analysis detector."""
    monkeypatch.setattr(ws, "USERS_DIR", tmp_path / "users")
    monkeypatch.setattr(ws, "FR_AVAILABLE", False)
    sent = []
    monkeypatch.setattr(ws, "notify_backend", lambda ep, data: sent.append((ep, data)) or True)
    seen = {"faces": []}
    monkeypatch.setattr(ws, "detect_for_auto_capture", lambda _f: list(seen["faces"]))
    client = ws.app.test_client()
    client.environ_base["HTTP_X_SKYGLASS_INTERNAL"] = security.get_internal_token()
    yield client, sent, seen
    ws.end_enrollment(notify=False)


def wait_for(cond, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if cond():
            return True
        time.sleep(0.02)
    return False


def test_session_starts_and_stops_the_capture_thread(server, fake_camera):
    client, sent, _ = server
    assert client.post("/api/start", json={"userId": "pilot-1"}).status_code == 200
    loop = ws._capture_loop
    assert loop is not None and loop.running
    assert ws.get_frame().shape == (480, 640, 3)
    assert wait_for(lambda: ("guidance", {"reason": "no_face", "holdMs": 0}) in sent)
    # guidance is sent on change only
    time.sleep(0.4)
    assert sum(1 for ep, _ in sent if ep == "guidance") == 1

    assert client.post("/api/reset").status_code == 200
    assert ws._capture_loop is None and not loop.running
    assert fake_camera[0].released


def test_new_session_replaces_the_thread(server):
    client, _, _ = server
    client.post("/api/start", json={"userId": "pilot-1"})
    first = ws._capture_loop
    client.post("/api/start", json={"userId": "pilot-2"})
    assert not first.running and ws._capture_loop.running


def test_hands_free_session_completes(server, monkeypatch):
    client, sent, seen = server
    monkeypatch.setattr(ac, "HOLD_SECONDS", 0.2)
    monkeypatch.setattr(ac, "COOLDOWN", 0.1)
    monkeypatch.setattr(ac, "POSE_PATIENCE", 0.3)  # black frames: any pose will do
    seen["faces"] = [face()]
    client.post("/api/start", json={"userId": "pilot-1", "name": "Clio"})
    loop = ws._capture_loop
    assert wait_for(lambda: ("complete", {}) in sent, timeout=15)
    progress = [d["samplesCollected"] for ep, d in sent if ep == "progress"]
    assert progress == [1, 2, 3, 4, 5]
    assert ("guidance", {"reason": "hold", "holdMs": 200}) in sent
    # every stored sample is announced with cooldown, right before its progress
    for n in range(1, 6):
        i = sent.index(("progress", {"samplesCollected": n, "samplesNeeded": 5}))
        assert sent[i - 1] == ("guidance", {"reason": "cooldown", "holdMs": 0})
    assert all(isinstance(d["holdMs"], int) for ep, d in sent if ep == "guidance")
    assert wait_for(lambda: not loop.running)
    assert ws._capture_loop is None and not ws.registration_state["active"]
    assert (ws.USERS_DIR / "pilot-1" / "metadata.json").exists()


@pytest.mark.parametrize("delay", [-1, 6, "3", True, None])
def test_capture_delay_is_validated(server, delay):
    client, _, _ = server
    client.post("/api/start", json={"userId": "pilot-1"})
    resp = client.post("/api/capture", json={"delay": delay})
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False


def test_manual_capture_with_delay_pauses_auto_capture(server, monkeypatch):
    client, sent, seen = server
    monkeypatch.setattr(ws, "detect_faces", lambda _f: [face()])
    client.post("/api/start", json={"userId": "pilot-1"})
    loop = ws._capture_loop
    paused = []
    real_sleep = time.sleep
    monkeypatch.setattr(ws.time, "sleep", lambda s: paused.append((s, loop._paused)) or real_sleep(0))
    body = client.post("/api/capture", json={"delay": 0.5}).get_json()
    assert body == {"success": True, "samples_captured": 1, "samples_needed": 5, "complete": False}
    assert paused == [(0.5, 1)]
    assert loop._paused == 0
    assert loop.auto.step == 1  # the manual sample advanced the hands-free step
    i = sent.index(("progress", {"samplesCollected": 1, "samplesNeeded": 5}))
    assert sent[i - 1] == ("guidance", {"reason": "cooldown", "holdMs": 0})


def test_manual_capture_framing_failure(server, monkeypatch):
    client, _, _ = server
    monkeypatch.setattr(ws, "detect_faces", lambda _f: [face(width=100)])
    client.post("/api/start", json={"userId": "pilot-1"})
    body = client.post("/api/capture", json={"delay": 0}).get_json()
    assert body == {"success": False, "message": "Center your face in the box"}
    assert ws._capture_loop._paused == 0
