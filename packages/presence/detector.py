#!/usr/bin/env python3
"""
Presence detection for SkyGlass.
Detects and recognizes a specific face using camera and reports to backend.
Only activates for the enrolled user, ignoring other faces.

Detection modes:
- face_recognition: Best accuracy, requires dlib (pip install face_recognition)
- opencv: Basic detection using OpenCV's bundled YuNet model (no extra install)

Settings come from the `presence:` block of config/config.yaml layered over
config/default.yaml (same merge as the backend); CLI flags override them.

Features:
- Face detection/recognition
- Gesture recognition (swipe to sleep, wave to dismiss)
"""

import argparse
import json
import logging
import os
import pickle
import time
import sys
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Optional
import requests
import yaml

import rotation

# Import gesture detection
try:
    from gesture import GestureDetector
    GESTURE_AVAILABLE = True
except ImportError:
    GESTURE_AVAILABLE = False

# Conditional imports
try:
    import cv2
    import numpy as np
    from face_detect import Face, FaceDetector, dlib_locations
    import cameras
    CV_AVAILABLE = True
except ImportError:
    CV_AVAILABLE = False
    print("OpenCV not available. Use --simulate mode.")

try:
    import face_recognition
    FR_AVAILABLE = True
except ImportError:
    FR_AVAILABLE = False

# Determine best available detection method (what `auto` resolves to)
if FR_AVAILABLE:
    DEFAULT_METHOD = "face_recognition"
elif CV_AVAILABLE:
    DEFAULT_METHOD = "opencv"
else:
    DEFAULT_METHOD = None

log = logging.getLogger("skyglass.detector")
TRACE = 5  # below DEBUG: one line per camera frame
logging.addLevelName(TRACE, "TRACE")

FACE_DATA_DIR = Path(__file__).parent / "face_data"
USERS_DIR = FACE_DATA_DIR / "users"  # Multi-user directory

# ---------------------------------------------------------------------------
# Settings: config.yaml `presence:` block, overridden by explicit CLI flags
# ---------------------------------------------------------------------------

CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "config"
DETECTION_METHODS = ("face_recognition", "opencv", "auto")

# YAML key -> (built-in default, parser). Keep in sync with the `presence:`
# block of config/default.yaml and the presence type in
# packages/backend/src/config/index.ts.
PRESENCE_SETTINGS = {
    "detection_method": ("auto", str),
    "camera_index": (0, int),
    "camera_rotation": ("auto", str),  # see rotation.py
    "tolerance": (0.6, float),
    "min_detection_frames": (3, int),
    "timeout": (5.0, float),
}

# argparse dest -> YAML key
CLI_TO_SETTING = {
    "method": "detection_method",
    "camera": "camera_index",
    "tolerance": "tolerance",
    "min_frames": "min_detection_frames",
    "timeout": "timeout",
}


class ConfigError(ValueError):
    """Invalid presence settings (bad YAML, unknown method, out-of-range value)."""


def _read_presence_block(path: Path) -> dict:
    try:
        with open(path) as f:
            data = yaml.safe_load(f) or {}
    except yaml.YAMLError as exc:
        raise ConfigError(f"{path}: invalid YAML: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError(f"{path}: expected a mapping at the top level")
    block = data.get("presence") or {}
    if not isinstance(block, dict):
        raise ConfigError(f"{path}: `presence` must be a mapping")
    for key in block:
        if key not in PRESENCE_SETTINGS:
            log.warning("%s: ignoring unknown presence key %r", path, key)
    return block


def _coerce(key: str, value, source: str):
    default, parse = PRESENCE_SETTINGS[key]
    try:
        value = parse(value)
    except (TypeError, ValueError):
        raise ConfigError(f"presence.{key} from {source}: {value!r} is not a valid {parse.__name__}") from None
    if key == "detection_method" and value not in DETECTION_METHODS:
        raise ConfigError(
            f"presence.detection_method from {source}: unknown method {value!r}; "
            f"expected one of: {', '.join(DETECTION_METHODS)}"
        )
    if key == "tolerance" and not 0 < value <= 1:
        raise ConfigError(f"presence.tolerance from {source}: {value} must be in (0, 1]")
    if key in ("min_detection_frames", "timeout") and value <= 0:
        raise ConfigError(f"presence.{key} from {source}: {value} must be positive")
    if key == "camera_rotation":
        try:
            rotation.parse_rotation(value)
        except ValueError as exc:
            raise ConfigError(f"presence.camera_rotation from {source}: {exc}") from None
    if key == "camera_index" and value < 0:
        raise ConfigError(f"presence.camera_index from {source}: {value} must be >= 0")
    return value


def resolve_settings(args: argparse.Namespace, config_dir: Path = CONFIG_DIR) -> tuple[dict, dict]:
    """Effective presence settings and where each came from.

    Layers, lowest first: built-in defaults, config/default.yaml,
    config/config.yaml, then CLI flags that were given explicitly (their
    argparse default is None). Missing files are skipped.
    """
    settings = {key: default for key, (default, _) in PRESENCE_SETTINGS.items()}
    sources = {key: "built-in default" for key in PRESENCE_SETTINGS}

    for name in ("default.yaml", "config.yaml"):
        path = Path(config_dir) / name
        if not path.is_file():
            continue
        for key, value in _read_presence_block(path).items():
            if key in PRESENCE_SETTINGS and value is not None:
                settings[key] = _coerce(key, value, str(path))
                sources[key] = str(path)

    for dest, key in CLI_TO_SETTING.items():
        value = getattr(args, dest, None)
        if value is not None:
            flag = "--" + dest.replace("_", "-")
            settings[key] = _coerce(key, value, flag)
            sources[key] = flag

    return settings, sources


class CameraOwner:
    """Opens the camera and lends it to a face registration.

    The presence/admin server claims the camera while the phone app registers
    a face (cameras.claim_camera). Only one process can stream a camera on a
    Pi, so the detector releases it until the claim ends, then reopens it.
    """

    CLAIM_POLL_SECONDS = 0.5
    REOPEN_RETRY_SECONDS = 2.0

    camera_index: int
    cap: Optional["cameras.Camera"]
    _claim_checked_at = 0.0

    def start_camera(self) -> bool:
        """Open camera `camera_index` (Raspberry Pi camera, USB webcam or OpenCV device)."""
        if not CV_AVAILABLE:
            return False
        self.cap = cameras.open_camera(self.camera_index)
        if self.cap is None:
            log.error("Failed to open camera %d", self.camera_index)
            return False
        log.info("Camera %d opened: %s", self.camera_index, self.cap.description)
        return True

    def stop_camera(self) -> None:
        """Release camera resources."""
        if self.cap:
            self.cap.release()
            self.cap = None

    def lend_camera_if_claimed(self) -> None:
        """While a face registration holds the camera, release it and wait; then reopen it."""
        now = time.monotonic()
        if now - self._claim_checked_at < self.CLAIM_POLL_SECONDS:
            return
        self._claim_checked_at = now
        if not cameras.camera_claimed():
            return
        log.info("Camera lent to face registration")
        self.stop_camera()
        while cameras.camera_claimed():
            time.sleep(self.CLAIM_POLL_SECONDS)
        while not self.start_camera():
            time.sleep(self.REOPEN_RETRY_SECONDS)
        log.info("Camera back from face registration")


class PresenceState(Enum):
    ABSENT = "absent"
    DETECTING = "detecting"
    PRESENT = "present"
    LEAVING = "leaving"


class UserFaceData:
    """Holds face encoding data for a single user."""
    def __init__(self, user_id: str, name: str, encodings: list):
        self.user_id = user_id
        self.name = name
        self.encodings = encodings


@dataclass
class FaceMatch:
    """One face in a frame and how close it came to an enrolled user."""

    face: "Face"
    user_id: Optional[str]  # enrolled user within tolerance, else None (unknown face)
    name: Optional[str]  # closest enrolled user, matched or not
    distance: float  # dlib distance to that user; lower = more alike, inf if nobody enrolled

    @property
    def matched(self) -> bool:
        return self.user_id is not None


class PresenceDetector(CameraOwner):
    """Recognises enrolled users with face_recognition (dlib) and reports who is present.

    Faces are located with the YuNet detector shared with the opencv mode and
    the enrollment flow (face_detect.py), encoded with dlib, and matched
    against every enrolled user's encodings. Only a face within `tolerance`
    of an enrolled user counts; anyone else is an unknown face and never wakes
    the mirror.

    face_data/users is re-scanned while running, so a registration made from
    the app is picked up without restarting the detector.
    """

    HEARTBEAT_SECONDS = 10.0
    DUMP_INTERVAL_SECONDS = 5.0
    USERS_POLL_SECONDS = 2.0
    ANALYSE_EVERY = 3  # dlib encoding is the slow part; analyse every Nth frame

    def __init__(
        self,
        backend_url: str = "http://localhost:3001",
        camera_index: int = 0,
        tolerance: float = 0.6,
        min_frames: int = 3,
        timeout: float = 5,
        min_face_size: int = 80,
        score_threshold: float = 0.8,
        dump_dir: Optional[Path] = None,
    ):
        self.backend_url = backend_url
        self.camera_index = camera_index
        self.tolerance = tolerance  # Lower = stricter matching
        self.min_frames = min_frames
        self.timeout = timeout
        self.dump_dir = dump_dir

        self.state = PresenceState.ABSENT
        self.detection_count = 0
        self.last_detection_time: Optional[float] = None
        self.last_transition_reason = ""
        self.report_successes = 0
        self.report_failures = 0
        self.cap: Optional["cameras.Camera"] = None
        self.frame_count = 0

        self.face_detector = FaceDetector(min_size=min_face_size, score_threshold=score_threshold)

        # userId -> UserFaceData, from face_data/users/<id>/ (written by
        # web_server.py when someone registers from the app)
        self.users: dict[str, UserFaceData] = {}
        self.current_user_id: Optional[str] = None
        self.current_user_name: Optional[str] = None

        # Result of the most recent frame that was actually analysed. Skipped
        # frames (see recognize_user) carry this forward instead of re-using
        # current_user_id, which would masquerade as a fresh detection.
        self.last_result: tuple[Optional[str], Optional[str], float] = (None, None, 0.0)
        self.last_result_fresh = False
        # Every face in the last analysed frame, matched or not (diagnostics).
        self.last_matches: list[FaceMatch] = []

        # Last (present, userId) actually POSTed to the backend, so we only
        # report on externally visible transitions, not on every frame.
        self._last_reported: Optional[tuple[bool, Optional[str]]] = None

        self._users_signature: tuple = ()
        self._load_all_users()

    # --- Enrolled users ----------------------------------------------------

    def _load_all_users(self) -> None:
        """Load face encodings for all registered users."""
        self.users = {}

        if USERS_DIR.exists():
            for user_dir in sorted(USERS_DIR.iterdir()):
                encodings_file = user_dir / "encodings.pkl"
                if not user_dir.is_dir() or not encodings_file.exists():
                    continue
                user_id = user_dir.name
                try:
                    with open(encodings_file, "rb") as f:
                        encodings = pickle.load(f)
                    name = "Unknown"
                    metadata_file = user_dir / "metadata.json"
                    if metadata_file.exists():
                        with open(metadata_file, "r") as f:
                            name = json.load(f).get("name", "Unknown")
                except Exception as e:
                    # Usually a registration still being written; the next
                    # rescan picks it up once the files settle.
                    log.warning("Failed to load user %s: %s", user_id, e)
                    continue

                if not encodings:
                    log.warning(
                        "User %s (%s...) has no face encodings (registered without "
                        "face_recognition installed); register again from the app to be recognised",
                        name, user_id[:8],
                    )
                    continue
                self.users[user_id] = UserFaceData(user_id, name, list(encodings))
                log.info("Loaded user %s (%s...): %d encodings", name, user_id[:8], len(encodings))

        if not self.users:
            log.warning(
                "No enrolled faces with encodings: the mirror will not wake until someone "
                "registers from the app (watching %s)", USERS_DIR,
            )
        self._users_signature = self._scan_users_signature()

    @staticmethod
    def _scan_users_signature() -> tuple:
        """Paths, mtimes and sizes of every face data file, to notice registrations."""
        files = []
        if USERS_DIR.exists():
            files += USERS_DIR.glob("*/encodings.pkl")
            files += USERS_DIR.glob("*/metadata.json")
        signature = []
        for path in sorted(files):
            try:
                st = path.stat()
            except OSError:
                continue
            signature.append((str(path), st.st_mtime_ns, st.st_size))
        return tuple(signature)

    def reload_users(self) -> None:
        """Reload all user face data (call after new enrollment)."""
        log.info("Reloading user face data")
        self._load_all_users()

    def maybe_reload_users(self) -> bool:
        """Reload if a registration was added, changed or deleted since the last load."""
        if self._scan_users_signature() == self._users_signature:
            return False
        log.info("Face data changed on disk; reloading users")
        self._load_all_users()
        return True

    # --- Recognition ---------------------------------------------------------

    def recognize_user(self, frame: np.ndarray) -> tuple[Optional[str], Optional[str], float]:
        """
        Identify which registered user (if any) is in the frame.
        Returns (user_id, user_name, confidence) or (None, None, 0.0) if no match.

        Only every ANALYSE_EVERY-th frame is analysed. On skipped frames the
        result of the last analysed frame is returned and
        ``self.last_result_fresh`` is set to False so the state machine does
        not treat it as a new detection.
        """
        self.frame_count += 1
        if self.frame_count % self.ANALYSE_EVERY != 0:
            self.last_result_fresh = False
            return self.last_result

        result: tuple[Optional[str], Optional[str], float] = (None, None, 0.0)
        if self.users:
            result = self._recognize_multi_user(frame)
        else:
            self.last_matches = []

        self.last_result = result
        self.last_result_fresh = True
        return result

    def _recognize_multi_user(self, frame: np.ndarray) -> tuple[Optional[str], Optional[str], float]:
        """The closest enrolled user within tolerance among all faces in the frame."""
        self.last_matches = self._match_faces(frame)
        best = min(
            (m for m in self.last_matches if m.matched), key=lambda m: m.distance, default=None
        )
        if best is None:
            return None, None, 0.0
        return best.user_id, best.name, max(0.0, 1.0 - best.distance)

    def _match_faces(self, frame: np.ndarray) -> list[FaceMatch]:
        """Locate, encode and match every face in the frame."""
        faces = self.face_detector.detect_faces(frame)
        if not faces:
            return []
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        encodings = face_recognition.face_encodings(rgb, dlib_locations(faces))

        matches = []
        for face, encoding in zip(faces, encodings):
            closest_id, closest_name, closest = None, None, float("inf")
            for user_id, user in self.users.items():
                distance = float(min(face_recognition.face_distance(user.encodings, encoding)))
                if distance < closest:
                    closest_id, closest_name, closest = user_id, user.name, distance
            matched_id = closest_id if closest <= self.tolerance else None
            matches.append(FaceMatch(face, matched_id, closest_name, closest))
        return matches

    # --- State machine and reporting ----------------------------------------

    def update_state(
        self,
        user_id: Optional[str],
        user_name: Optional[str],
        confidence: float,
        fresh: bool = True,
    ) -> bool:
        """Update presence state machine. Returns True if state or user changed.

        ``fresh`` is False when the result was carried forward from an earlier
        analysed frame. A carried-forward detection must not refresh
        ``last_detection_time`` or count toward ``min_frames``; a carried-forward
        non-detection still lets the time-based LEAVING -> ABSENT timeout fire.

        The reason for the last change is kept in last_transition_reason.
        """
        current_time = time.time()
        old_state = self.state
        old_user = self.current_user_id
        user_detected = user_id is not None
        reason = ""

        if user_detected and not fresh:
            return False

        if user_detected:
            self.last_detection_time = current_time
            self.detection_count += 1
            self.current_user_id = user_id
            self.current_user_name = user_name

            if self.state == PresenceState.ABSENT:
                self.state = PresenceState.DETECTING
                reason = f"{user_name} recognised, need {self.min_frames} analysed frames"
            elif self.state == PresenceState.DETECTING:
                if self.detection_count >= self.min_frames:
                    self.state = PresenceState.PRESENT
                    reason = f"{user_name} recognised in {self.detection_count} analysed frames"
                    self.detection_count = 0
            elif self.state == PresenceState.LEAVING:
                self.state = PresenceState.PRESENT
                reason = f"{user_name} recognised again before timeout"
            if not reason and old_user != user_id:
                reason = f"now {user_name}"
        else:
            self.detection_count = 0

            if self.state == PresenceState.PRESENT:
                self.state = PresenceState.LEAVING
                reason = f"no enrolled face, absent after {self.timeout}s without one"
            elif self.state == PresenceState.LEAVING:
                if (
                    self.last_detection_time
                    and current_time - self.last_detection_time > self.timeout
                ):
                    self.state = PresenceState.ABSENT
                    reason = f"no enrolled face for {current_time - self.last_detection_time:.1f}s"
                    self.current_user_id = None
                    self.current_user_name = None
            elif self.state == PresenceState.DETECTING:
                self.state = PresenceState.ABSENT
                reason = "lost before confirmation"
                self.current_user_id = None
                self.current_user_name = None

        changed = old_state != self.state or old_user != self.current_user_id
        if changed:
            self.last_transition_reason = reason
        return changed

    def reported_presence(self) -> tuple[bool, Optional[str]]:
        """The (present, userId) pair the backend should see for the current state.

        DETECTING is not yet confirmed, and LEAVING is still within the grace
        timeout, so the backend only sees present on PRESENT/LEAVING and absent
        once the timeout has elapsed (ABSENT).
        """
        is_present = self.state in (PresenceState.PRESENT, PresenceState.LEAVING)
        return is_present, (self.current_user_id if is_present else None)

    def maybe_report_presence(self, confidence: float = 0.0) -> bool:
        """POST to the backend only if the externally visible presence changed."""
        current = self.reported_presence()
        if current == self._last_reported:
            return False
        if self._last_reported is None and not current[0]:
            # Backend already assumes absent at startup; nothing to report.
            self._last_reported = current
            return False
        self._last_reported = current
        self.report_presence(confidence)
        return True

    def report_presence(self, confidence: float = 0.0) -> None:
        """Report presence state to backend with user identity."""
        is_present, _ = self.reported_presence()
        payload = {
            "present": is_present,
            "confidence": confidence,
            "state": self.state.value,
            "userId": self.current_user_id,
            "userName": self.current_user_name,
            "method": "face_recognition",
        }
        try:
            response = requests.post(f"{self.backend_url}/api/presence", json=payload, timeout=2)
            if response.status_code != 200:
                log.warning(
                    "Backend %s rejected presence report: HTTP %d %s",
                    self.backend_url, response.status_code, response.text[:200],
                )
                self.report_failures += 1
                return
            log.debug("Backend accepted presence: %s", response.text[:200])
            self.report_successes += 1
        except requests.exceptions.RequestException as e:
            log.warning("Failed to report presence to %s: %s", self.backend_url, e)
            self.report_failures += 1

    def process_frame(self, frame) -> bool:
        """Run one frame through recognition, the state machine and reporting.

        Returns True if a presence POST was sent for this frame.
        """
        user_id, user_name, confidence = self.recognize_user(frame)
        if self.update_state(user_id, user_name, confidence, fresh=self.last_result_fresh):
            who = f" - {self.current_user_name}" if self.current_user_id else ""
            log.info("State -> %s%s (%s)", self.state.value, who, self.last_transition_reason)
        return self.maybe_report_presence(confidence)

    # --- Diagnostics -----------------------------------------------------------

    @staticmethod
    def _label(m: FaceMatch) -> str:
        if m.matched:
            return f"{m.name} {m.distance:.2f}"
        if m.name is None:
            return "unknown"
        return f"unknown (closest {m.name} {m.distance:.2f})"

    def _describe(self, matches: list[FaceMatch], rejected, analyse_ms: float) -> str:
        """One-line picture of an analysed frame for the debug/trace log."""
        if not self.users:
            return f"no enrolled users with encodings, recognition idle, state={self.state.value}"
        parts = [f"faces={len(matches)}"]
        for m in matches:
            parts.append(f"[{m.face.w}px {self._label(m)}]")
        if rejected:
            parts.append(
                "too_small=" + ",".join(f"{f.w}px" for f in rejected)
                + f" (min {self.face_detector.min_size}px)"
            )
        parts.append(f"tolerance={self.tolerance:.2f}")
        parts.append(f"analyse={analyse_ms:.1f}ms")
        parts.append(f"state={self.state.value}")
        if self.state == PresenceState.DETECTING:
            parts.append(f"streak={self.detection_count}/{self.min_frames}")
        return " ".join(parts)

    def _draw(self, frame: np.ndarray, matches: list[FaceMatch], rejected) -> np.ndarray:
        """Matched faces green with name, unknown faces red, too-small faces orange."""
        for m in matches:
            f = m.face
            color = (0, 255, 0) if m.matched else (0, 0, 255)
            cv2.rectangle(frame, (f.x, f.y), (f.x + f.w, f.y + f.h), color, 2)
            cv2.putText(frame, self._label(m), (f.x, max(14, f.y - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
        for f in rejected:
            cv2.rectangle(frame, (f.x, f.y), (f.x + f.w, f.y + f.h), (0, 165, 255), 2)
            cv2.putText(frame, f"{f.w}px", (f.x, max(14, f.y - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 165, 255), 1)
        return frame

    def _dump_frame(self, frame: np.ndarray, matches: list[FaceMatch], rejected, tag: str) -> None:
        """Save the raw frame plus an annotated copy for offline inspection."""
        assert self.dump_dir is not None
        self.dump_dir.mkdir(parents=True, exist_ok=True)
        stem = self.dump_dir / f"{time.strftime('%Y%m%d-%H%M%S')}-{tag}"
        raw = stem.with_name(stem.name + ".jpg")
        cv2.imwrite(str(raw), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
        cv2.imwrite(str(stem.with_name(stem.name + "-annotated.jpg")), self._draw(frame.copy(), matches, rejected))
        log.info(
            "Saved frame %s (%s: %s). To test it offline, copy the raw frame into "
            "tests/fixtures/faces/<person>/ and run tests/test_identity_real_model.py",
            raw.name, tag, ", ".join(self._label(m) for m in matches) or "no faces",
        )

    # --- Main loop ---------------------------------------------------------

    def run(self, show_preview: bool = False) -> None:
        """Main detection loop."""
        if not FR_AVAILABLE:
            log.error("face_recognition library not available")
            return

        if not self.start_camera():
            log.error("Failed to start camera")
            return

        log.info(
            "Presence detection: face_recognition, %d enrolled user(s), tolerance %.2f, "
            "min face %dpx, %d analysed frames to confirm, absent after %gs, backend %s",
            len(self.users), self.tolerance, self.face_detector.min_size,
            self.min_frames, self.timeout, self.backend_url,
        )
        if self.dump_dir:
            log.info("Dumping frames with unknown faces (and periodic samples) to %s", self.dump_dir)
        log.info("Press 'q' to quit" if show_preview else "Press Ctrl+C to quit")

        hb_started = time.time()
        hb_frames = hb_analysed = hb_face_frames = hb_matched = hb_unknown = hb_read_failures = 0
        hb_analyse_ms = 0.0
        hb_closest: Optional[FaceMatch] = None  # nearest miss among unknown faces
        last_debug = last_dump = last_users_poll = 0.0
        trace = log.isEnabledFor(TRACE)
        upright = rotation.CameraRotation()
        debug = log.isEnabledFor(logging.DEBUG)

        try:
            while True:
                self.lend_camera_if_claimed()
                ret, frame = self.cap.read()
                if not ret:
                    hb_read_failures += 1
                    if hb_read_failures in (1, 10, 100) or hb_read_failures % 1000 == 0:
                        log.warning("Camera read failed (%d so far)", hb_read_failures)
                    time.sleep(0.1)
                    continue
                frame = upright.apply(frame)  # portrait mounts turn the camera too

                now = time.time()
                if now - last_users_poll >= self.USERS_POLL_SECONDS:
                    self.maybe_reload_users()
                    last_users_poll = now

                t0 = time.perf_counter()
                self.process_frame(frame)
                analyse_ms = (time.perf_counter() - t0) * 1000
                hb_frames += 1

                if self.last_result_fresh:
                    matches = self.last_matches
                    rejected = self.face_detector.last_rejected if self.users else []
                    hb_analysed += 1
                    hb_analyse_ms += analyse_ms
                    if matches:
                        hb_face_frames += 1
                    if any(m.matched for m in matches):
                        hb_matched += 1
                    elif matches:
                        hb_unknown += 1
                        nearest = min(matches, key=lambda m: m.distance)
                        if hb_closest is None or nearest.distance < hb_closest.distance:
                            hb_closest = nearest

                    if trace or (debug and now - last_debug >= 1.0):
                        log.log(TRACE if trace else logging.DEBUG, self._describe(matches, rejected, analyse_ms))
                        last_debug = now

                    if self.dump_dir and now - last_dump >= self.DUMP_INTERVAL_SECONDS:
                        if matches and not any(m.matched for m in matches):
                            self._dump_frame(frame, matches, rejected, "unknown")
                            last_dump = now
                        elif now - last_dump >= 6 * self.DUMP_INTERVAL_SECONDS:
                            self._dump_frame(frame, matches, rejected, "sample")
                            last_dump = now

                if now - hb_started >= self.HEARTBEAT_SECONDS:
                    elapsed = now - hb_started
                    unknown = ""
                    if hb_unknown:
                        unknown = f", unknown face in {hb_unknown}"
                        if hb_closest is not None and hb_closest.name is not None:
                            unknown += (
                                f" (nearest miss {hb_closest.name} at {hb_closest.distance:.2f}"
                                f" > tolerance {self.tolerance:.2f})"
                            )
                    who = f" ({self.current_user_name})" if self.current_user_id else ""
                    log.info(
                        "%.0fs: %d frames (%.1f fps), %d analysed (%.0f ms avg), face in %d, "
                        "enrolled user in %d%s, %d read failures, state %s%s, backend ok %d / failed %d",
                        elapsed, hb_frames, hb_frames / elapsed, hb_analysed,
                        hb_analyse_ms / max(1, hb_analysed), hb_face_frames, hb_matched, unknown,
                        hb_read_failures, self.state.value, who,
                        self.report_successes, self.report_failures,
                    )
                    hb_started = now
                    hb_frames = hb_analysed = hb_face_frames = hb_matched = hb_unknown = hb_read_failures = 0
                    hb_analyse_ms = 0.0
                    hb_closest = None

                if show_preview:
                    color = (0, 255, 0) if self.current_user_id else (0, 0, 255)
                    who = f" - {self.current_user_name}" if self.current_user_id else ""
                    cv2.putText(
                        frame, f"State: {self.state.value}{who}", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2,
                    )
                    if not self.users:
                        cv2.putText(
                            frame, "No enrolled faces - register from the app", (10, 60),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2,
                        )
                    self._draw(frame, self.last_matches, self.face_detector.last_rejected if self.users else [])
                    cv2.imshow("Presence Detection (face_recognition)", frame)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break

                time.sleep(0.033)  # ~30 FPS

        except KeyboardInterrupt:
            log.info("Stopping...")
        finally:
            self.stop_camera()
            if show_preview:
                cv2.destroyAllWindows()


class OpenCVFaceDetector(CameraOwner):
    """
    Simple face detection using OpenCV's bundled YuNet model (see face_detect.py).
    Detects ANY face (no enrollment/recognition) - good for testing.
    Includes gesture recognition for dismiss/sleep functionality.
    """

    HEARTBEAT_SECONDS = 10.0
    DUMP_INTERVAL_SECONDS = 5.0

    def __init__(
        self,
        backend_url: str = "http://localhost:3001",
        camera_index: int = 0,
        min_frames: int = 3,
        timeout: float = 5,
        enable_gestures: bool = True,
        min_face_size: int = 80,
        score_threshold: float = 0.8,
        dump_dir: Optional[Path] = None,
    ):
        self.backend_url = backend_url
        self.camera_index = camera_index
        self.min_frames = min_frames
        self.timeout = timeout
        self.enable_gestures = enable_gestures and GESTURE_AVAILABLE
        self.dump_dir = dump_dir

        self.state = PresenceState.ABSENT
        self.detection_count = 0
        self.last_detection_time: Optional[float] = None
        self.last_transition_reason = ""
        self.report_successes = 0
        self.report_failures = 0
        self.cap: Optional["cameras.Camera"] = None

        # Faces narrower than min_face_size px are too far away to count as present
        self.face_detector = FaceDetector(min_size=min_face_size, score_threshold=score_threshold)

        # Initialize gesture detector if enabled
        self.gesture_detector = None
        if self.enable_gestures:
            self.gesture_detector = GestureDetector()
            log.info("Gesture detection enabled (swipe to sleep)")

    def detect_face(self, frame: np.ndarray) -> bool:
        """Detect any face in the frame."""
        return len(self.face_detector.detect(frame)) > 0

    def update_state(self, face_detected: bool) -> bool:
        """Update presence state machine. Returns True if state changed.

        The reason for the last transition is kept in last_transition_reason
        for the log line that announces it.
        """
        current_time = time.time()
        old_state = self.state
        reason = ""

        if face_detected:
            self.last_detection_time = current_time
            self.detection_count += 1

            if self.state == PresenceState.ABSENT:
                self.state = PresenceState.DETECTING
                reason = f"face seen, need {self.min_frames} consecutive frames"
            elif self.state == PresenceState.DETECTING:
                if self.detection_count >= self.min_frames:
                    self.state = PresenceState.PRESENT
                    reason = f"face in {self.detection_count} consecutive frames"
                    self.detection_count = 0
            elif self.state == PresenceState.LEAVING:
                self.state = PresenceState.PRESENT
                reason = "face seen again before timeout"
        else:
            self.detection_count = 0

            if self.state == PresenceState.PRESENT:
                self.state = PresenceState.LEAVING
                reason = f"no face, absent after {self.timeout}s without one"
            elif self.state == PresenceState.LEAVING:
                if (
                    self.last_detection_time
                    and current_time - self.last_detection_time > self.timeout
                ):
                    self.state = PresenceState.ABSENT
                    reason = f"no face for {current_time - self.last_detection_time:.1f}s"
            elif self.state == PresenceState.DETECTING:
                self.state = PresenceState.ABSENT
                reason = "face lost before confirmation"

        changed = old_state != self.state
        if changed:
            self.last_transition_reason = reason
        return changed

    def report_presence(self) -> None:
        """Report presence state to backend."""
        is_present = self.state in (PresenceState.PRESENT, PresenceState.DETECTING)
        try:
            response = requests.post(
                f"{self.backend_url}/api/presence",
                json={
                    "present": is_present,
                    "confidence": 0.8 if is_present else 0.0,
                    "state": self.state.value,
                    "method": "opencv",
                },
                timeout=2,
            )
            if response.status_code != 200:
                log.warning(
                    "Backend %s rejected presence report: HTTP %d %s",
                    self.backend_url, response.status_code, response.text[:200],
                )
                self.report_failures += 1
                return
            log.debug("Backend accepted presence: %s", response.text[:200])
            self.report_successes += 1
        except requests.exceptions.RequestException as e:
            log.warning("Failed to report presence to %s: %s", self.backend_url, e)
            self.report_failures += 1

    def report_gesture(self, gesture_type: str, confidence: float) -> None:
        """Report detected gesture to backend."""
        try:
            response = requests.post(
                f"{self.backend_url}/api/gesture",
                json={
                    "gesture": gesture_type,
                    "confidence": confidence,
                },
                timeout=2,
            )
            if response.status_code != 200:
                log.warning("Gesture report failed: HTTP %d", response.status_code)
        except requests.exceptions.RequestException as e:
            log.warning("Failed to report gesture: %s", e)

    def _describe(self, faces, rejected, detect_ms: float) -> str:
        """One-line picture of a frame for the debug/trace log."""
        parts = [f"faces={len(faces)}"]
        if faces:
            parts.append("accepted=" + ",".join(f"{f.w}x{f.h}@{f.score:.2f}" for f in faces))
        if rejected:
            parts.append(
                "too_small=" + ",".join(f"{f.w}x{f.h}@{f.score:.2f}" for f in rejected)
                + f" (min {self.face_detector.min_size}px)"
            )
        parts.append(f"detect={detect_ms:.1f}ms")
        parts.append(f"state={self.state.value}")
        if self.state == PresenceState.DETECTING:
            parts.append(f"streak={self.detection_count}/{self.min_frames}")
        return " ".join(parts)

    def _dump_frame(self, frame: np.ndarray, faces, rejected, tag: str) -> None:
        """Save an annotated copy of the frame for offline inspection."""
        assert self.dump_dir is not None
        self.dump_dir.mkdir(parents=True, exist_ok=True)
        img = frame.copy()
        for f in faces:
            cv2.rectangle(img, (f.x, f.y), (f.x + f.w, f.y + f.h), (0, 255, 0), 2)
        for f in rejected:
            cv2.rectangle(img, (f.x, f.y), (f.x + f.w, f.y + f.h), (0, 165, 255), 2)
            cv2.putText(img, f"{f.w}px", (f.x, max(12, f.y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 165, 255), 1)
        path = self.dump_dir / f"{time.strftime('%Y%m%d-%H%M%S')}-{tag}.jpg"
        cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        log.info("Saved frame %s (%s); check it with: python face_detect.py %s", path.name, tag, path)

    def run(self, show_preview: bool = False) -> None:
        """Main detection loop."""
        if not CV_AVAILABLE:
            log.error("OpenCV not available")
            return

        if not self.start_camera():
            log.error("Failed to start camera")
            return

        log.info(
            "Presence detection: OpenCV YuNet (any face), min face %dpx, score >= %.2f, "
            "%d frames to confirm, absent after %gs, backend %s, opencv %s",
            self.face_detector.min_size, self.face_detector.score_threshold,
            self.min_frames, self.timeout, self.backend_url, cv2.__version__,
        )
        log.info("NOTE: this mode detects any face, not just enrolled users")
        if self.enable_gestures:
            log.info("Gestures enabled: swipe left/right or wave to dismiss")
        if self.dump_dir:
            log.info("Dumping frames with rejected faces (and periodic samples) to %s", self.dump_dir)
        log.info("Press 'q' to quit" if show_preview else "Press Ctrl+C to quit")

        last_gesture_text = ""
        gesture_display_until = 0

        # Heartbeat counters
        hb_started = time.time()
        hb_frames = hb_face_frames = hb_rejected_frames = hb_read_failures = 0
        hb_detect_ms = 0.0
        hb_max_rejected_w = 0
        last_debug = 0.0
        last_dump = 0.0
        trace = log.isEnabledFor(TRACE)
        upright = rotation.CameraRotation()
        debug = log.isEnabledFor(logging.DEBUG)

        try:
            while True:
                self.lend_camera_if_claimed()
                ret, frame = self.cap.read()
                if not ret:
                    hb_read_failures += 1
                    if hb_read_failures in (1, 10, 100) or hb_read_failures % 1000 == 0:
                        log.warning("Camera read failed (%d so far)", hb_read_failures)
                    time.sleep(0.1)
                    continue
                frame = upright.apply(frame)  # portrait mounts turn the camera too

                t0 = time.perf_counter()
                faces = self.face_detector.detect_faces(frame)
                detect_ms = (time.perf_counter() - t0) * 1000
                rejected = self.face_detector.last_rejected
                face_detected = bool(faces)
                state_changed = self.update_state(face_detected)

                now = time.time()
                hb_frames += 1
                hb_detect_ms += detect_ms
                if face_detected:
                    hb_face_frames += 1
                if rejected and not face_detected:
                    hb_rejected_frames += 1
                    hb_max_rejected_w = max(hb_max_rejected_w, max(f.w for f in rejected))

                if trace or (debug and now - last_debug >= 1.0):
                    log.log(TRACE if trace else logging.DEBUG, self._describe(faces, rejected, detect_ms))
                    last_debug = now

                if state_changed:
                    log.info("State -> %s (%s)", self.state.value, self.last_transition_reason)
                    self.report_presence()

                if self.dump_dir and now - last_dump >= self.DUMP_INTERVAL_SECONDS:
                    if rejected and not face_detected:
                        self._dump_frame(frame, faces, rejected, "rejected")
                        last_dump = now
                    elif now - last_dump >= 6 * self.DUMP_INTERVAL_SECONDS:
                        self._dump_frame(frame, faces, rejected, "sample")
                        last_dump = now

                if now - hb_started >= self.HEARTBEAT_SECONDS:
                    elapsed = now - hb_started
                    small = (
                        f", {hb_rejected_frames} with only too-small faces (largest {hb_max_rejected_w}px"
                        f" < {self.face_detector.min_size}px)"
                        if hb_rejected_frames else ""
                    )
                    log.info(
                        "%.0fs: %d frames (%.1f fps), face in %d (%.0f%%)%s, detect %.1f ms avg, "
                        "%d read failures, state %s, backend ok %d / failed %d",
                        elapsed, hb_frames, hb_frames / elapsed,
                        hb_face_frames, 100.0 * hb_face_frames / max(1, hb_frames), small,
                        hb_detect_ms / max(1, hb_frames), hb_read_failures, self.state.value,
                        self.report_successes, self.report_failures,
                    )
                    hb_started = now
                    hb_frames = hb_face_frames = hb_rejected_frames = hb_read_failures = 0
                    hb_detect_ms = 0.0
                    hb_max_rejected_w = 0

                # Check for gestures
                if self.gesture_detector and self.state == PresenceState.PRESENT:
                    gesture = self.gesture_detector.detect(frame)
                    if gesture:
                        log.info("Gesture: %s (%.0f%%)", gesture.type.value, gesture.confidence * 100)
                        self.report_gesture(gesture.type.value, gesture.confidence)
                        last_gesture_text = f"GESTURE: {gesture.type.value.upper()}"
                        gesture_display_until = time.time() + 2.0

                if show_preview:
                    # Draw detection status
                    color = (0, 255, 0) if face_detected else (0, 0, 255)
                    label = "FACE DETECTED" if face_detected else "Scanning..."
                    if rejected and not face_detected:
                        label = f"Face too small: {max(f.w for f in rejected)}px < {self.face_detector.min_size}px"

                    cv2.putText(
                        frame,
                        f"State: {self.state.value}",
                        (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.8,
                        color,
                        2,
                    )
                    cv2.putText(
                        frame,
                        label,
                        (10, 60),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.6,
                        color,
                        2,
                    )

                    # Draw gesture notification
                    if time.time() < gesture_display_until:
                        cv2.putText(
                            frame,
                            last_gesture_text,
                            (10, 90),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.7,
                            (255, 165, 0),
                            2,
                        )

                    # Accepted faces green, too-small faces orange
                    for f in faces:
                        cv2.rectangle(frame, (f.x, f.y), (f.x + f.w, f.y + f.h), (0, 255, 0), 2)
                    for f in rejected:
                        cv2.rectangle(frame, (f.x, f.y), (f.x + f.w, f.y + f.h), (0, 165, 255), 2)

                    cv2.imshow("Presence Detection (OpenCV)", frame)

                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break

                time.sleep(0.033)  # ~30 FPS

        except KeyboardInterrupt:
            log.info("Stopping...")
        finally:
            self.stop_camera()
            if show_preview:
                cv2.destroyAllWindows()


class SimulatedDetector:
    """Simulated detector for development without camera."""

    def __init__(self, backend_url: str = "http://localhost:3001"):
        self.backend_url = backend_url
        self.is_present = False

    def report_presence(self, present: bool) -> None:
        """Report presence state to backend."""
        state = "present" if present else "absent"
        try:
            response = requests.post(
                f"{self.backend_url}/api/presence",
                json={
                    "present": present,
                    "confidence": 1.0 if present else 0.0,
                    "state": state,
                },
                timeout=2,
            )
            print(f"Reported: {state.upper()} -> {response.status_code}")
        except requests.exceptions.RequestException as e:
            print(f"Failed to report presence: {e}")

    def run(self) -> None:
        """Interactive simulation mode."""
        print("Presence Detection - Simulation Mode")
        print("Commands:")
        print("  p - Toggle presence (currently: ABSENT)")
        print("  1 - Set PRESENT")
        print("  0 - Set ABSENT")
        print("  q - Quit")
        print()

        try:
            while True:
                cmd = input("> ").strip().lower()
                if cmd == "q":
                    break
                elif cmd == "p":
                    self.is_present = not self.is_present
                    self.report_presence(self.is_present)
                elif cmd == "1":
                    self.is_present = True
                    self.report_presence(True)
                elif cmd == "0":
                    self.is_present = False
                    self.report_presence(False)
                else:
                    print("Unknown command. Use p/1/0/q")
        except (KeyboardInterrupt, EOFError):
            print("\nExiting...")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="SkyGlass presence detection",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Detection methods:
  face_recognition  Best accuracy, recognizes enrolled users only
                    Requires: pip install face_recognition (includes dlib)
  opencv            Basic detection using OpenCV's YuNet model, detects ANY face
                    No extra install needed (model ships with SkyGlass)
  auto              face_recognition if installed, else opencv

Current best available method: %(default_method)s

Settings:
  --method, --camera, --tolerance, --min-frames and --timeout default to the
  presence block of %(config_dir)s/config.yaml (layered over default.yaml);
  a flag given on the command line overrides the YAML value.
        """ % {"default_method": DEFAULT_METHOD or "none (use --simulate)", "config_dir": CONFIG_DIR},
    )
    parser.add_argument(
        "--method",
        choices=DETECTION_METHODS,
        default=None,
        help="Detection method (default: presence.detection_method, else auto)",
    )
    parser.add_argument(
        "--simulate",
        action="store_true",
        help="Run in simulation mode (no camera required)",
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Show camera preview window",
    )
    parser.add_argument(
        "--backend",
        default="http://localhost:3001",
        help="Backend URL (default: http://localhost:3001)",
    )
    parser.add_argument(
        "--camera",
        type=int,
        default=None,
        help="Camera index (default: presence.camera_index, else 0)",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=None,
        help="Face match tolerance 0-1, lower=stricter (default: presence.tolerance, else 0.6)",
    )
    parser.add_argument(
        "--min-frames",
        type=int,
        default=None,
        help="Consecutive detections needed to confirm presence (default: presence.min_detection_frames, else 3)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=None,
        help="Seconds without a face before marking absent (default: presence.timeout, else 5)",
    )
    parser.add_argument(
        "--no-gestures",
        action="store_true",
        help="Disable gesture detection (swipe to sleep)",
    )
    diag = parser.add_argument_group("diagnostics (opencv method)")
    diag.add_argument(
        "--log-level",
        choices=["info", "debug", "trace"],
        default=os.environ.get("SKYGLASS_DETECTOR_LOG", "info"),
        help="info: transitions + 10s heartbeat; debug: one frame summary per second; "
             "trace: every frame (default: info, or $SKYGLASS_DETECTOR_LOG)",
    )
    diag.add_argument(
        "--min-face-size",
        type=int,
        default=80,
        help="Smallest face (px) that counts as present; smaller ones are logged as too small (default: 80)",
    )
    diag.add_argument(
        "--score-threshold",
        type=float,
        default=0.8,
        help="YuNet confidence threshold 0-1, lower finds more faces (default: 0.8)",
    )
    diag.add_argument(
        "--dump-frames",
        metavar="DIR",
        help="Save frames here for offline tuning: too-small faces (opencv; check with face_detect.py) "
        "or unknown faces (face_recognition; check with tests/test_identity_real_model.py), plus periodic samples",
    )
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    level = {"info": logging.INFO, "debug": logging.DEBUG, "trace": TRACE}[args.log_level]
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)-5s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("urllib3").setLevel(logging.WARNING)  # our own lines cover each backend call

    try:
        settings, sources = resolve_settings(args)
    except ConfigError as exc:
        log.error("Invalid presence settings: %s", exc)
        sys.exit(2)
    for key, value in settings.items():
        log.info("Setting %s = %s (from %s)", key, value, sources[key])

    # Determine which method to use
    method = settings["detection_method"]
    if method == "auto":
        method = DEFAULT_METHOD
        if method != "face_recognition":
            log.warning(
                "face_recognition is not installed, so auto picked %s: the mirror wakes for ANY "
                "face, not just enrolled users. Install it with: pip install -r requirements.txt",
                method,
            )

    if args.simulate:
        detector = SimulatedDetector(backend_url=args.backend)
        detector.run()
    elif method == "opencv":
        if not CV_AVAILABLE:
            print("Error: OpenCV required")
            print("Install with: pip install opencv-python")
            sys.exit(1)
        print("Using OpenCV YuNet detection (detects any face)")
        detector = OpenCVFaceDetector(
            backend_url=args.backend,
            camera_index=settings["camera_index"],
            min_frames=settings["min_detection_frames"],
            timeout=settings["timeout"],
            enable_gestures=not args.no_gestures,
            min_face_size=args.min_face_size,
            score_threshold=args.score_threshold,
            dump_dir=Path(args.dump_frames) if args.dump_frames else None,
        )
        detector.run(show_preview=args.preview)
    elif method == "face_recognition":
        if not CV_AVAILABLE or not FR_AVAILABLE:
            print("Error: OpenCV and face_recognition required")
            print("Install with: pip install opencv-python face_recognition")
            print("Or run with --method opencv for basic detection")
            sys.exit(1)
        detector = PresenceDetector(
            backend_url=args.backend,
            camera_index=settings["camera_index"],
            tolerance=settings["tolerance"],
            min_frames=settings["min_detection_frames"],
            timeout=settings["timeout"],
            min_face_size=args.min_face_size,
            score_threshold=args.score_threshold,
            dump_dir=Path(args.dump_frames) if args.dump_frames else None,
        )
        detector.run(show_preview=args.preview)
    else:
        print("No detection method available!")
        print("Install opencv-python or use --simulate mode")
        sys.exit(1)


if __name__ == "__main__":
    main()
