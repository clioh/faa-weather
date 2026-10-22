"""Identity recognition with the real face_recognition (dlib) model.

The stubbed tests in test_identity_recognition.py prove the matching logic;
this one proves the real pipeline (YuNet locates, dlib encodes, tolerance
0.6 decides) tells real people apart. It needs face_recognition
installed and labelled photos (see tests/fixtures/faces/README.md), and is
skipped otherwise.
"""

import os
from pathlib import Path

import pytest

import detector as det
import web_server as ws
from face_detect import FaceDetector, dlib_locations

face_recognition = pytest.importorskip("face_recognition")
cv2 = pytest.importorskip("cv2")

FIXTURES = Path(
    os.environ.get("SKYGLASS_FACE_FIXTURES", Path(__file__).parent / "fixtures" / "faces")
)
CAMERA_WIDTH = 640  # photos are scaled to what the mirror camera delivers
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def _load_people() -> dict:
    people = {}
    if FIXTURES.is_dir():
        for person_dir in sorted(p for p in FIXTURES.iterdir() if p.is_dir()):
            photos = sorted(p for p in person_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
            if photos:
                people[person_dir.name] = photos
    return people


PEOPLE = _load_people()
pytestmark = pytest.mark.skipif(
    len(PEOPLE) < 2 or not any(len(p) >= 2 for p in PEOPLE.values()),
    reason=f"needs photos of 2+ people, one with 2+ photos, in {FIXTURES}",
)


def camera_frame(path: Path):
    img = cv2.imread(str(path))
    assert img is not None, f"unreadable image {path}"
    h, w = img.shape[:2]
    if w != CAMERA_WIDTH:
        img = cv2.resize(img, (CAMERA_WIDTH, round(h * CAMERA_WIDTH / w)))
    return img


def encode(path: Path):
    """Encode a photo the way web_server's registration capture does."""
    frame = camera_frame(path)
    faces = FaceDetector().detect(frame)
    assert len(faces) == 1, f"{path} should show exactly one face, found {len(faces)}"
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    [encoding] = face_recognition.face_encodings(rgb, dlib_locations(faces))
    return encoding


@pytest.fixture
def users_dir(monkeypatch, tmp_path):
    users = tmp_path / "face_data" / "users"
    users.mkdir(parents=True)
    monkeypatch.setattr(ws, "USERS_DIR", users)
    monkeypatch.setattr(det, "USERS_DIR", users)
    return users


def enroll(people: dict) -> None:
    for name, photos in people.items():
        ws.save_user_face_data(name, name, [encode(p) for p in photos], len(photos))


def held_out_split():
    """Enrol every photo but the last of each multi-photo person; probe with the last."""
    enrolled, probes = {}, {}
    for name, photos in PEOPLE.items():
        if len(photos) >= 2:
            enrolled[name], probes[name] = photos[:-1], photos[-1]
        else:
            enrolled[name] = photos
    return enrolled, probes


def test_held_out_photo_is_identified_as_the_right_person(users_dir):
    enrolled, probes = held_out_split()
    enroll(enrolled)
    d = det.PresenceDetector()

    for name, probe in probes.items():
        user_id, _, confidence = d._recognize_multi_user(camera_frame(probe))
        assert user_id == name, f"{probe} identified as {user_id!r} ({confidence:.2f})"


@pytest.mark.parametrize("outsider", sorted(PEOPLE))
def test_person_who_is_not_enrolled_is_not_recognised(users_dir, outsider):
    enroll({name: photos for name, photos in PEOPLE.items() if name != outsider})
    d = det.PresenceDetector()

    for photo in PEOPLE[outsider]:
        user_id, _, confidence = d._recognize_multi_user(camera_frame(photo))
        assert user_id is None, f"{outsider} ({photo.name}) matched {user_id!r} ({confidence:.2f})"
