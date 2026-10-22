"""Tests for face_detect.FaceDetector (OpenCV YuNet wrapper)."""

import numpy as np
import pytest

import face_detect


@pytest.fixture(scope="module")
def detector():
    return face_detect.FaceDetector(min_size=80)


def test_model_file_is_vendored():
    assert face_detect.MODEL_PATH.is_file(), "YuNet model must ship in packages/presence/models/"


def test_missing_model_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        face_detect.FaceDetector(model_path=tmp_path / "nope.onnx")


def test_blank_frames_have_no_faces(detector):
    assert detector.detect(np.zeros((480, 640, 3), np.uint8)) == []
    assert detector.detect_faces(np.full((480, 640, 3), 255, np.uint8)) == []


def test_accepts_grayscale_and_bgra_and_large_frames(detector):
    # Exercises the colour conversion paths and the >640 px downscale path.
    assert detector.detect(np.zeros((480, 640), np.uint8)) == []
    assert detector.detect(np.zeros((480, 640, 4), np.uint8)) == []
    assert detector.detect(np.zeros((1080, 1920, 3), np.uint8)) == []


def test_empty_frame(detector):
    assert detector.detect(None) == []
    assert detector.detect(np.zeros((0, 0, 3), np.uint8)) == []


def test_input_size_follows_frame(detector):
    detector.detect(np.zeros((480, 640, 3), np.uint8))
    assert detector._input_size == (640, 480)
    detector.detect(np.zeros((240, 320, 3), np.uint8))
    assert detector._input_size == (320, 240)


def _draw_face(size=(640, 480), center=(320, 240)):
    """Cartoon face that YuNet reliably detects (score ~0.9)."""
    import cv2

    w, h = size
    cx, cy = center
    img = np.full((h, w, 3), 235, np.uint8)
    skin = (170, 190, 225)
    cv2.ellipse(img, (cx, cy), (95, 125), 0, 0, 360, skin, -1)
    cv2.ellipse(img, (cx, cy - 115), (100, 55), 0, 180, 360, (40, 30, 20), -1)  # hair
    for ex in (cx - 38, cx + 38):
        cv2.ellipse(img, (ex, cy - 30), (18, 10), 0, 0, 360, (255, 255, 255), -1)
        cv2.circle(img, (ex, cy - 30), 7, (60, 40, 20), -1)
        cv2.circle(img, (ex, cy - 30), 3, (0, 0, 0), -1)
        cv2.ellipse(img, (ex, cy - 52), (22, 6), 0, 0, 180, (40, 30, 20), 3)  # brow
    cv2.line(img, (cx, cy - 25), (cx - 10, cy + 25), (120, 140, 180), 3)  # nose
    cv2.line(img, (cx - 10, cy + 25), (cx + 8, cy + 25), (120, 140, 180), 3)
    cv2.ellipse(img, (cx, cy + 65), (32, 12), 0, 0, 180, (70, 50, 160), -1)  # mouth
    for ex in (cx - 60, cx + 60):
        cv2.ellipse(img, (ex, cy + 20), (14, 10), 0, 0, 360, (150, 160, 230), -1)  # ears
    return cv2.GaussianBlur(img, (5, 5), 0)


def test_detects_synthetic_face(detector):
    """Full path: detect, clamp, min_size filter, landmarks."""
    faces = detector.detect_faces(_draw_face())
    assert len(faces) == 1
    f = faces[0]
    x, y, w, h = f.box
    assert 0 <= x < x + w <= 640 and 0 <= y < y + h <= 480
    assert abs((x + w // 2) - 320) < 60 and abs((y + h // 2) - 240) < 80
    assert f.score > 0.8
    # Eyes sit in the upper half of the box, right eye left of left eye in image coords
    for ex, ey in f.eyes:
        assert x <= ex <= x + w and y <= ey <= y + h // 2
    assert f.right_eye[0] < f.left_eye[0]


def test_large_frame_boxes_are_scaled_back(detector):
    """A 1920x1080 frame is detected at 640 px wide; boxes must come back in
    original pixels."""
    import cv2

    img = cv2.resize(_draw_face(), (1920, 1080), interpolation=cv2.INTER_LINEAR)
    faces = detector.detect(img)
    assert len(faces) == 1
    x, y, w, h = faces[0]
    assert 200 < w < 700 and 300 < h < 900
    assert abs((x + w // 2) - 960) < 150 and abs((y + h // 2) - 540) < 150


def test_min_size_filters_small_faces():
    small = face_detect.FaceDetector(min_size=80)
    strict = face_detect.FaceDetector(min_size=400)
    img = _draw_face()
    assert len(small.detect(img)) == 1
    assert strict.detect(img) == []
