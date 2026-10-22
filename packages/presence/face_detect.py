"""
Face detection shared by detector.py, web_server.py and test_camera.py.

Uses OpenCV's bundled YuNet detector (cv2.FaceDetectorYN). It replaces the
Haar cascades the project used before, which OpenCV 5 removed entirely
(the 5.x wheels ship neither cv2.CascadeClassifier nor the XML files).
YuNet is a small CNN tuned for CPUs: it handles tilted heads, partial
profiles and uneven lighting far better than Haar at a similar frame rate.

The model lives at models/face_detection_yunet_2023mar.onnx and comes from
https://github.com/opencv/opencv_zoo (Apache-2.0). It is vendored so the
presence server never downloads anything at runtime.

Requires opencv-python >= 4.8 (the 2023mar model needs the newer YuNet op set).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_PATH = MODEL_DIR / "face_detection_yunet_2023mar.onnx"

# Frames wider than this are downscaled before detection and the boxes are
# scaled back. Keeps the Pi responsive when a webcam hands us 1280x720.
MAX_DETECT_WIDTH = 640

Box = Tuple[int, int, int, int]  # x, y, w, h in frame pixels
Point = Tuple[int, int]


@dataclass
class Face:
    """One detected face: bounding box, five landmarks and detector confidence."""

    box: Box
    right_eye: Point
    left_eye: Point
    nose: Point
    mouth_right: Point
    mouth_left: Point
    score: float

    @property
    def x(self) -> int:
        return self.box[0]

    @property
    def y(self) -> int:
        return self.box[1]

    @property
    def w(self) -> int:
        return self.box[2]

    @property
    def h(self) -> int:
        return self.box[3]

    @property
    def eyes(self) -> List[Point]:
        return [self.right_eye, self.left_eye]


def dlib_locations(boxes) -> List[Tuple[int, int, int, int]]:
    """(x, y, w, h) boxes or Face records as (top, right, bottom, left).

    That is the order face_recognition.face_encodings() takes known face
    locations in. Encoding the faces YuNet found keeps enrollment and
    recognition on the same detector instead of re-detecting with dlib's HOG
    model, which misses smaller faces.
    """
    out = []
    for b in boxes:
        x, y, w, h = b.box if isinstance(b, Face) else b
        out.append((y, x + w, y + h, x))
    return out


class FaceDetector:
    """
    Thread-safe wrapper around cv2.FaceDetectorYN.

    detect(frame)       -> list of (x, y, w, h) boxes, the shape the old
                           Haar detectMultiScale() call returned.
    detect_faces(frame) -> list of Face with landmarks and scores.

    Args:
        min_size:        Discard faces narrower or shorter than this (pixels,
                         in the original frame). Same role as Haar's minSize.
        score_threshold: Minimum detector confidence, 0-1.
        nms_threshold:   Non-max-suppression IoU threshold for overlapping boxes.
        model_path:      Override the vendored model file.
    """

    def __init__(
        self,
        min_size: int = 80,
        score_threshold: float = 0.8,
        nms_threshold: float = 0.3,
        model_path: Path = MODEL_PATH,
    ):
        model_path = Path(model_path)
        if not model_path.is_file():
            raise FileNotFoundError(
                f"YuNet face model not found at {model_path}. "
                "It ships with the repo in packages/presence/models/; "
                "re-check the checkout or release bundle."
            )
        if not hasattr(cv2, "FaceDetectorYN"):
            raise RuntimeError(
                f"OpenCV {cv2.__version__} has no FaceDetectorYN; "
                "install opencv-python >= 4.8"
            )

        self.min_size = min_size
        self.score_threshold = score_threshold
        # Diagnostics from the most recent detect_faces() call: faces YuNet
        # found that were dropped by the min_size filter. Lets callers log
        # "a face was there but too small" instead of just "no face".
        self.last_rejected: List[Face] = []
        self._lock = threading.Lock()
        self._input_size: Optional[Tuple[int, int]] = None
        self._detector = cv2.FaceDetectorYN.create(
            str(model_path),
            "",
            (320, 320),  # placeholder, reset per frame in _run
            score_threshold,
            nms_threshold,
            5000,
        )

    def detect(self, frame: np.ndarray) -> List[Box]:
        """Return (x, y, w, h) boxes for every face at least min_size wide and tall."""
        return [f.box for f in self.detect_faces(frame)]

    def detect_faces(self, frame: np.ndarray) -> List[Face]:
        """Return Face records (box, landmarks, score) for every detected face."""
        if frame is None or frame.size == 0:
            return []
        if frame.ndim == 2:
            frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
        elif frame.shape[2] == 4:
            frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

        frame_h, frame_w = frame.shape[:2]
        scale = 1.0
        if frame_w > MAX_DETECT_WIDTH:
            scale = MAX_DETECT_WIDTH / frame_w
            frame = cv2.resize(
                frame,
                (MAX_DETECT_WIDTH, max(1, int(round(frame_h * scale)))),
                interpolation=cv2.INTER_AREA,
            )

        rows = self._run(frame)
        self.last_rejected = []
        if rows is None:
            return []

        faces: List[Face] = []
        inv = 1.0 / scale
        for row in rows:
            vals = [float(v) * inv for v in row[:14]]
            x, y, w, h = (int(round(v)) for v in vals[:4])
            # Clamp to the frame; YuNet can return boxes that hang off the edge.
            x = max(0, x)
            y = max(0, y)
            w = min(w, frame_w - x)
            h = min(h, frame_h - y)
            pts = [(int(round(vals[i])), int(round(vals[i + 1]))) for i in range(4, 14, 2)]
            face = Face(
                box=(x, y, w, h),
                right_eye=pts[0],
                left_eye=pts[1],
                nose=pts[2],
                mouth_right=pts[3],
                mouth_left=pts[4],
                score=float(row[14]),
            )
            if w < self.min_size or h < self.min_size:
                self.last_rejected.append(face)
                continue
            faces.append(face)
        return faces

    def _run(self, frame: np.ndarray):
        h, w = frame.shape[:2]
        # FaceDetectorYN is not thread-safe and setInputSize must match the
        # frame; the web server detects from the stream thread and from
        # Flask request threads at the same time.
        with self._lock:
            if self._input_size != (w, h):
                self._detector.setInputSize((w, h))
                self._input_size = (w, h)
            _, rows = self._detector.detect(frame)
        return rows


def _main(argv: List[str]) -> int:
    """Run the detector on image files: python face_detect.py photo.jpg [...]

    Prints every face YuNet found, including ones the size filter would
    reject, so a frame saved by `detector.py --dump-frames` can be checked
    against different --min-size / --score settings without a camera.
    """
    import argparse

    ap = argparse.ArgumentParser(description="Detect faces in image files (offline tuning aid)")
    ap.add_argument("images", nargs="+")
    ap.add_argument("--min-size", type=int, default=80, help="min face width/height in px (default 80)")
    ap.add_argument("--score", type=float, default=0.8, help="YuNet score threshold (default 0.8)")
    ap.add_argument("--out", help="directory to write annotated copies into")
    args = ap.parse_args(argv)

    det = FaceDetector(min_size=args.min_size, score_threshold=args.score)
    for path in args.images:
        img = cv2.imread(path)
        if img is None:
            print(f"{path}: not an image")
            continue
        faces = det.detect_faces(img)
        h, w = img.shape[:2]
        print(f"{path}: {w}x{h}, {len(faces)} accepted, {len(det.last_rejected)} rejected (min {args.min_size}px)")
        for f in faces:
            print(f"  accepted  box={f.box} score={f.score:.2f}")
        for f in det.last_rejected:
            print(f"  too small box={f.box} score={f.score:.2f}")
        if args.out:
            for f in faces:
                cv2.rectangle(img, (f.x, f.y), (f.x + f.w, f.y + f.h), (0, 255, 0), 2)
            for f in det.last_rejected:
                cv2.rectangle(img, (f.x, f.y), (f.x + f.w, f.y + f.h), (0, 165, 255), 2)
            out = Path(args.out) / Path(path).name
            out.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(out), img)
            print(f"  annotated -> {out}")
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(_main(sys.argv[1:]))
