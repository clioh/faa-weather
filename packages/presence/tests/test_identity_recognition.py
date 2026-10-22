"""PresenceDetector must recognise *which* enrolled user is in view, not just
"a face".

The YuNet face detector and face_recognition (dlib) are replaced by stubs
whose "camera" shows whatever 128-d encodings the test puts in the scene. face_distance is the real formula
(Euclidean distance), and users are enrolled through web_server's own writer,
so these tests cover the enrollment record -> loading -> matching -> state
machine -> backend report path without a camera or dlib.

Encodings are built so that samples of one person sit ~0.2 apart and
different people ~0.9 apart, roughly how dlib's embeddings behave (the
library's own same-person cut-off is 0.6).
"""

import types

import numpy as np
import pytest

import detector as det
from face_detect import Face
import web_server as ws

DIM = 128


class Person:
    """A synthetic identity: a base embedding plus per-sample jitter."""

    def __init__(self, seed: int):
        self.rng = np.random.default_rng(seed)
        base = self.rng.normal(size=DIM)
        self.base = base * (0.65 / np.linalg.norm(base))

    def sample(self, jitter: float = 0.1) -> np.ndarray:
        noise = self.rng.normal(size=DIM)
        return self.base + noise * (jitter / np.linalg.norm(noise))


ALICE, BOB, STRANGER = Person(1), Person(2), Person(3)


class FakeFaceRecognition(types.ModuleType):
    """Stand-in for the face_recognition module driven by `scene`."""

    def __init__(self):
        super().__init__("face_recognition")
        self.scene: list = []  # encodings of the faces currently in view

    def face_encodings(self, _rgb, locations):
        assert len(locations) == len(self.scene)
        return list(self.scene)

    @staticmethod
    def face_distance(known, encoding):
        if len(known) == 0:
            return np.empty(0)
        return np.linalg.norm(np.asarray(known) - encoding, axis=1)


class FakeFaceDetector:
    """Stand-in for face_detect.FaceDetector: one box per face in the scene."""

    min_size = 80

    def __init__(self, fr: FakeFaceRecognition):
        self.fr = fr
        self.last_rejected = []

    def detect_faces(self, _frame):
        return [
            Face(box=(10 + 100 * i, 10, 90, 90), right_eye=(0, 0), left_eye=(0, 0),
                 nose=(0, 0), mouth_right=(0, 0), mouth_left=(0, 0), score=0.95)
            for i in range(len(self.fr.scene))
        ]


FRAME = np.zeros((120, 160, 3), dtype=np.uint8)


@pytest.fixture
def fr(monkeypatch, tmp_path):
    users = tmp_path / "face_data" / "users"
    users.mkdir(parents=True)
    monkeypatch.setattr(ws, "USERS_DIR", users)
    monkeypatch.setattr(det, "USERS_DIR", users)

    stub = FakeFaceRecognition()
    monkeypatch.setattr(det, "face_recognition", stub, raising=False)
    return stub


def enroll(user_id: str, name: str, person: Person, samples: int = 5) -> None:
    """Enroll through the same writer the phone registration flow uses."""
    encodings = [person.sample() for _ in range(samples)]
    ws.save_user_face_data(user_id, name, encodings, samples)


def make_detector(monkeypatch, **kwargs) -> det.PresenceDetector:
    d = det.PresenceDetector(min_frames=3, timeout=5, **kwargs)
    d.face_detector = FakeFaceDetector(det.face_recognition)
    posts = []
    monkeypatch.setattr(
        d, "report_presence", lambda confidence=0.0: posts.append(d.reported_presence())
    )
    d.posts = posts
    return d


def identify(d: det.PresenceDetector, *faces: np.ndarray):
    """Run one analysed frame with `faces` in view; returns (user_id, name, conf)."""
    det.face_recognition.scene = list(faces)
    return d._recognize_multi_user(FRAME)


def run_frames(d: det.PresenceDetector, n: int, *faces: np.ndarray) -> None:
    det.face_recognition.scene = list(faces)
    for _ in range(n):
        d.process_frame(FRAME)


# --- Matching -------------------------------------------------------------


def test_synthetic_identities_are_separated_like_real_embeddings():
    # Guard the fixture itself: if these drift the other tests prove nothing.
    same = np.linalg.norm(ALICE.sample() - ALICE.sample())
    different = np.linalg.norm(ALICE.sample() - BOB.sample())
    assert same < 0.35
    assert different > 0.75


def test_enrolled_user_is_identified_by_id_and_name(fr, monkeypatch):
    enroll("alice-id", "Alice", ALICE)
    d = make_detector(monkeypatch)

    user_id, name, confidence = identify(d, ALICE.sample())

    assert (user_id, name) == ("alice-id", "Alice")
    assert confidence > 0.6


def test_each_enrolled_user_maps_to_their_own_record(fr, monkeypatch):
    enroll("alice-id", "Alice", ALICE)
    enroll("bob-id", "Bob", BOB)
    d = make_detector(monkeypatch)

    for _ in range(10):
        assert identify(d, ALICE.sample())[0] == "alice-id"
        assert identify(d, BOB.sample())[0] == "bob-id"


def test_unenrolled_face_is_not_recognised(fr, monkeypatch):
    enroll("alice-id", "Alice", ALICE)
    enroll("bob-id", "Bob", BOB)
    d = make_detector(monkeypatch)

    assert identify(d, STRANGER.sample()) == (None, None, 0.0)


def test_unknown_face_reports_its_nearest_miss(fr, monkeypatch):
    # The detector logs how close an unknown face came, to tune tolerance.
    enroll("alice-id", "Alice", ALICE)
    d = make_detector(monkeypatch)

    identify(d, STRANGER.sample())

    [m] = d.last_matches
    assert not m.matched
    assert m.name == "Alice"
    assert m.distance > d.tolerance


def test_no_face_is_not_recognised(fr, monkeypatch):
    enroll("alice-id", "Alice", ALICE)
    d = make_detector(monkeypatch)

    assert identify(d) == (None, None, 0.0)


def test_enrolled_user_is_found_next_to_a_stranger(fr, monkeypatch):
    enroll("bob-id", "Bob", BOB)
    d = make_detector(monkeypatch)

    assert identify(d, STRANGER.sample(), BOB.sample())[0] == "bob-id"
    assert identify(d, BOB.sample(), STRANGER.sample())[0] == "bob-id"


def test_closest_user_wins_when_two_are_within_tolerance(fr, monkeypatch):
    enroll("alice-id", "Alice", ALICE)
    enroll("bob-id", "Bob", BOB)
    # Loose tolerance so a face between the two matches both records.
    d = make_detector(monkeypatch, tolerance=1.0)

    mostly_bob = 0.3 * ALICE.base + 0.7 * BOB.base
    assert identify(d, mostly_bob)[0] == "bob-id"
    mostly_alice = 0.7 * ALICE.base + 0.3 * BOB.base
    assert identify(d, mostly_alice)[0] == "alice-id"


def test_tolerance_is_the_match_cut_off(fr, monkeypatch):
    enroll("alice-id", "Alice", ALICE)
    probe = ALICE.sample(jitter=0.45)  # a poor-quality look at Alice
    d = make_detector(monkeypatch, tolerance=0.6)
    assert identify(d, probe)[0] == "alice-id"

    d.tolerance = 0.2
    assert identify(d, probe)[0] is None


def test_user_enrolled_without_encodings_matches_nobody(fr, monkeypatch):
    # What web_server writes when face_recognition was missing at enrollment.
    ws.save_user_face_data("no-enc", "Clio", [], 5)
    d = make_detector(monkeypatch)

    assert d.users == {}
    assert d.recognize_user(FRAME) == (None, None, 0.0)


# --- Through the state machine to the backend report ----------------------


def test_stranger_never_wakes_the_mirror(fr, monkeypatch):
    enroll("alice-id", "Alice", ALICE)
    d = make_detector(monkeypatch)

    run_frames(d, 60, STRANGER.sample())

    assert d.state == det.PresenceState.ABSENT
    assert d.posts == []


def test_enrolled_user_wakes_the_mirror_as_themselves(fr, monkeypatch):
    enroll("alice-id", "Alice", ALICE)
    enroll("bob-id", "Bob", BOB)
    d = make_detector(monkeypatch)

    run_frames(d, 12, BOB.sample())

    assert d.state == det.PresenceState.PRESENT
    assert d.posts == [(True, "bob-id")]
    assert d.current_user_name == "Bob"


def test_report_switches_identity_when_another_user_steps_in(fr, monkeypatch):
    enroll("alice-id", "Alice", ALICE)
    enroll("bob-id", "Bob", BOB)
    d = make_detector(monkeypatch)

    run_frames(d, 12, ALICE.sample())
    run_frames(d, 3, BOB.sample())

    assert d.posts == [(True, "alice-id"), (True, "bob-id")]


# --- Registrations made while the detector runs --------------------------


def test_registration_is_picked_up_without_restart(fr, monkeypatch):
    d = make_detector(monkeypatch)
    assert d.users == {}
    assert not d.maybe_reload_users()

    enroll("alice-id", "Alice", ALICE)

    assert d.maybe_reload_users()
    assert identify(d, ALICE.sample())[0] == "alice-id"


def test_reregistration_replaces_encodings(fr, monkeypatch):
    # Same user id registered again (e.g. after enrolling without encodings).
    ws.save_user_face_data("clio-id", "Clio", [], 5)
    d = make_detector(monkeypatch)
    assert d.users == {}

    enroll("clio-id", "Clio", ALICE)

    assert d.maybe_reload_users()
    assert identify(d, ALICE.sample())[0] == "clio-id"


def test_deleted_user_is_no_longer_recognised(fr, monkeypatch):
    enroll("alice-id", "Alice", ALICE)
    d = make_detector(monkeypatch)
    assert identify(d, ALICE.sample())[0] == "alice-id"

    assert ws.delete_user_face_data("alice-id")

    assert d.maybe_reload_users()
    assert identify(d, ALICE.sample()) == (None, None, 0.0)
