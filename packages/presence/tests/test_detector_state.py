"""Unit tests for the PresenceDetector state machine (no camera, no dlib)."""

import pytest

import detector as det


class FakeClock:
    def __init__(self, start: float = 1000.0):
        self.now = start

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch):
    c = FakeClock()
    monkeypatch.setattr(det.time, "time", c)
    return c


@pytest.fixture
def presence(monkeypatch, tmp_path, clock):
    # Point face data at an empty temp dir so __init__ loads nothing real.
    monkeypatch.setattr(det, "USERS_DIR", tmp_path / "users")
    monkeypatch.setattr(det, "FACE_ENCODING_FILE", tmp_path / "enrolled_face.pkl")

    d = det.PresenceDetector(min_frames=3, timeout=5)
    d.users = {"u1": det.UserFaceData("u1", "Alice", [object()])}

    # Mocked recognition: the test flips `face_visible` to simulate the scene.
    d.face_visible = False

    def fake_recognize(_frame):
        if d.face_visible:
            return "u1", "Alice", 0.9
        return None, None, 0.0

    monkeypatch.setattr(d, "_recognize_multi_user", fake_recognize)

    posts = []
    monkeypatch.setattr(d, "report_presence", lambda confidence=0.0: posts.append(d.reported_presence()))
    d.posts = posts
    return d


def run_frames(d, clock, n, dt=0.033):
    sent = 0
    for _ in range(n):
        clock.now += dt
        if d.process_frame(frame=None):
            sent += 1
    return sent


def test_arrival_steady_and_departure(presence, clock):
    d = presence

    # Nobody there: no POSTs at all.
    assert run_frames(d, clock, 30) == 0
    assert d.state == det.PresenceState.ABSENT

    # User arrives: exactly one "present" POST.
    d.face_visible = True
    run_frames(d, clock, 30)
    assert d.state == det.PresenceState.PRESENT
    assert d.posts == [(True, "u1")]

    # Steady state for a long time: no further POSTs.
    assert run_frames(d, clock, 600) == 0
    assert d.posts == [(True, "u1")]

    # User leaves. Before the timeout we are LEAVING and nothing is posted,
    # and skipped frames must not flip us back to PRESENT.
    d.face_visible = False
    # (Up to 2 skipped frames may still carry the last analysed "present"
    # result; once LEAVING is entered it must not flap back to PRESENT.)
    left_at = clock.now
    states = []
    while clock.now - left_at < d.timeout - 0.5:
        clock.now += 0.033
        d.process_frame(frame=None)
        states.append(d.state)
    first_leaving = states.index(det.PresenceState.LEAVING)
    assert first_leaving <= 2
    assert set(states[first_leaving:]) == {det.PresenceState.LEAVING}
    assert d.posts == [(True, "u1")]

    # After the timeout: ABSENT reached and exactly one "absent" POST.
    run_frames(d, clock, 60)
    assert d.state == det.PresenceState.ABSENT
    assert d.current_user_id is None
    assert d.posts == [(True, "u1"), (False, None)]

    # Empty room afterwards stays quiet.
    assert run_frames(d, clock, 300) == 0
    assert d.posts == [(True, "u1"), (False, None)]


def test_skipped_frames_do_not_refresh_detection(presence, clock):
    d = presence
    d.face_visible = True
    run_frames(d, clock, 30)
    assert d.state == det.PresenceState.PRESENT

    d.face_visible = False
    run_frames(d, clock, 3)  # guarantees one analysed frame with no face
    last_seen = d.last_detection_time
    run_frames(d, clock, 20)
    assert d.last_detection_time == last_seen
    assert d.state == det.PresenceState.LEAVING


def test_skipped_frames_carry_forward_last_result(presence, clock):
    d = presence
    d.face_visible = True
    # Frames 1,2 are skipped (nothing processed yet), frame 3 is analysed.
    assert d.recognize_user(None) == (None, None, 0.0)
    assert d.last_result_fresh is False
    d.recognize_user(None)
    assert d.recognize_user(None) == ("u1", "Alice", 0.9)
    assert d.last_result_fresh is True

    # Face disappears; skipped frames still report the last analysed result
    # but flagged as not fresh.
    d.face_visible = False
    assert d.recognize_user(None) == ("u1", "Alice", 0.9)
    assert d.last_result_fresh is False
    d.recognize_user(None)
    assert d.recognize_user(None) == (None, None, 0.0)
    assert d.last_result_fresh is True


def test_brief_false_positive_never_posts(presence, clock):
    d = presence
    d.face_visible = True
    run_frames(d, clock, 3)  # one analysed detection -> DETECTING
    assert d.state == det.PresenceState.DETECTING
    d.face_visible = False
    run_frames(d, clock, 30)
    assert d.state == det.PresenceState.ABSENT
    assert d.posts == []


def test_return_during_leaving_does_not_repost(presence, clock):
    d = presence
    d.face_visible = True
    run_frames(d, clock, 30)
    d.face_visible = False
    run_frames(d, clock, 30)  # ~1s, still within timeout
    assert d.state == det.PresenceState.LEAVING
    d.face_visible = True
    run_frames(d, clock, 30)
    assert d.state == det.PresenceState.PRESENT
    assert d.posts == [(True, "u1")]
