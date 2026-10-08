#!/usr/bin/env python3
"""
Presence detection for SkyGlass.
Detects and recognizes a specific face using camera and reports to backend.
Only activates for the enrolled user, ignoring other faces.

Detection modes:
- face_recognition: Best accuracy, requires dlib (pip install face_recognition)
- haar: Basic detection using OpenCV Haar cascades (no extra install)
- mediapipe: Good accuracy, lighter weight (pip install mediapipe)

Features:
- Face detection/recognition
- Gesture recognition (swipe to sleep, wave to dismiss)
"""

import argparse
import os
import pickle
import time
import sys
from enum import Enum
from pathlib import Path
from typing import Optional
import requests

# Import gesture detection
try:
    from gesture import GestureDetector, GestureType
    GESTURE_AVAILABLE = True
except ImportError:
    GESTURE_AVAILABLE = False

# Conditional imports
try:
    import cv2
    import numpy as np
    CV_AVAILABLE = True
except ImportError:
    CV_AVAILABLE = False
    print("OpenCV not available. Use --simulate mode.")

try:
    import face_recognition
    FR_AVAILABLE = True
except ImportError:
    FR_AVAILABLE = False

try:
    import mediapipe as mp
    MP_AVAILABLE = True
except ImportError:
    MP_AVAILABLE = False

# Determine best available detection method
if FR_AVAILABLE:
    DEFAULT_METHOD = "face_recognition"
elif MP_AVAILABLE:
    DEFAULT_METHOD = "mediapipe"
elif CV_AVAILABLE:
    DEFAULT_METHOD = "haar"
else:
    DEFAULT_METHOD = None

import json

FACE_DATA_DIR = Path(__file__).parent / "face_data"
FACE_ENCODING_FILE = FACE_DATA_DIR / "enrolled_face.pkl"  # Legacy single-user file
USERS_DIR = FACE_DATA_DIR / "users"  # Multi-user directory


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


class FaceEnroller:
    """Handles face enrollment for the authorized user."""

    def __init__(self, camera_index: int = 0):
        self.camera_index = camera_index
        self.encodings: list = []

    def enroll(self, num_samples: int = 5) -> bool:
        """Capture face samples and save encoding."""
        if not CV_AVAILABLE or not FR_AVAILABLE:
            print("Error: OpenCV and face_recognition required for enrollment")
            return False

        cap = cv2.VideoCapture(self.camera_index)
        if not cap.isOpened():
            print(f"Failed to open camera {self.camera_index}")
            return False

        print(f"\n{'='*50}")
        print("FACE ENROLLMENT")
        print(f"{'='*50}")
        print(f"We will capture {num_samples} samples of your face.")
        print("Please look at the camera and move slightly between captures.")
        print("Press SPACE to capture, Q to quit.")
        print(f"{'='*50}\n")

        self.encodings = []
        samples_captured = 0

        try:
            while samples_captured < num_samples:
                ret, frame = cap.read()
                if not ret:
                    continue

                # Detect faces in frame
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                face_locations = face_recognition.face_locations(rgb_frame)

                # Draw rectangles around faces
                display_frame = frame.copy()
                for top, right, bottom, left in face_locations:
                    cv2.rectangle(display_frame, (left, top), (right, bottom), (0, 255, 0), 2)

                # Show status
                status = f"Samples: {samples_captured}/{num_samples}"
                if len(face_locations) == 0:
                    status += " - No face detected"
                elif len(face_locations) > 1:
                    status += " - Multiple faces! Only you should be visible"
                else:
                    status += " - Press SPACE to capture"

                cv2.putText(display_frame, status, (10, 30),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                cv2.imshow("Face Enrollment", display_frame)

                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    print("\nEnrollment cancelled.")
                    break
                elif key == ord(" ") and len(face_locations) == 1:
                    # Capture encoding
                    encodings = face_recognition.face_encodings(rgb_frame, face_locations)
                    if encodings:
                        self.encodings.append(encodings[0])
                        samples_captured += 1
                        print(f"Captured sample {samples_captured}/{num_samples}")
                        time.sleep(0.5)  # Brief pause between captures

        finally:
            cap.release()
            cv2.destroyAllWindows()

        if samples_captured < num_samples:
            print(f"\nOnly captured {samples_captured} samples. Enrollment incomplete.")
            return False

        # Save encodings
        self._save_encodings()
        print(f"\nEnrollment complete! {num_samples} face samples saved.")
        return True

    def _save_encodings(self) -> None:
        """Save face encodings to file."""
        FACE_DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(FACE_ENCODING_FILE, "wb") as f:
            pickle.dump(self.encodings, f)
        print(f"Face data saved to {FACE_ENCODING_FILE}")


class PresenceDetector:
    """Handles presence detection using camera and face recognition.
    Supports multiple registered users - identifies which user is present.
    """

    def __init__(
        self,
        backend_url: str = "http://localhost:3001",
        camera_index: int = 0,
        tolerance: float = 0.6,
        min_frames: int = 3,
        timeout: int = 5,
    ):
        self.backend_url = backend_url
        self.camera_index = camera_index
        self.tolerance = tolerance  # Lower = stricter matching
        self.min_frames = min_frames
        self.timeout = timeout

        self.state = PresenceState.ABSENT
        self.detection_count = 0
        self.last_detection_time: Optional[float] = None
        self.cap: Optional[cv2.VideoCapture] = None
        self.frame_count = 0

        # Multi-user support
        self.users: dict[str, UserFaceData] = {}  # userId -> UserFaceData
        self.current_user_id: Optional[str] = None
        self.current_user_name: Optional[str] = None

        # Result of the most recent frame that was actually analysed. Skipped
        # frames (see recognize_user) carry this forward instead of re-using
        # current_user_id, which would masquerade as a fresh detection.
        self.last_result: tuple[Optional[str], Optional[str], float] = (None, None, 0.0)
        self.last_result_fresh = False

        # Last (present, userId) actually POSTed to the backend, so we only
        # report on externally visible transitions, not on every frame.
        self._last_reported: Optional[tuple[bool, Optional[str]]] = None

        # Legacy single-user support
        self.enrolled_encodings: list = []

        # Load all users
        self._load_all_users()

    def _load_all_users(self) -> None:
        """Load face encodings for all registered users."""
        self.users = {}

        # First, try multi-user directory
        if USERS_DIR.exists():
            for user_dir in USERS_DIR.iterdir():
                if not user_dir.is_dir():
                    continue

                user_id = user_dir.name
                encodings_file = user_dir / "encodings.pkl"
                metadata_file = user_dir / "metadata.json"

                if not encodings_file.exists():
                    continue

                try:
                    with open(encodings_file, "rb") as f:
                        encodings = pickle.load(f)

                    # Load metadata for user name
                    name = "Unknown"
                    if metadata_file.exists():
                        with open(metadata_file, "r") as f:
                            metadata = json.load(f)
                            name = metadata.get("name", "Unknown")

                    self.users[user_id] = UserFaceData(user_id, name, encodings)
                    print(f"Loaded user: {name} ({user_id[:8]}...) - {len(encodings)} samples")
                except Exception as e:
                    print(f"Failed to load user {user_id}: {e}")

        # Fall back to legacy single-user file if no multi-user data
        if not self.users and FACE_ENCODING_FILE.exists():
            print("Loading legacy single-user face data...")
            with open(FACE_ENCODING_FILE, "rb") as f:
                self.enrolled_encodings = pickle.load(f)
            print(f"Loaded {len(self.enrolled_encodings)} enrolled face samples (legacy mode)")
        elif not self.users:
            print("WARNING: No enrolled faces found!")
            print("Use the mobile app to register users")

        print(f"Total users loaded: {len(self.users)}")

    def reload_users(self) -> None:
        """Reload all user face data (call after new enrollment)."""
        print("Reloading user face data...")
        self._load_all_users()

    def start_camera(self) -> bool:
        """Initialize camera capture."""
        if not CV_AVAILABLE:
            return False

        self.cap = cv2.VideoCapture(self.camera_index)
        if not self.cap.isOpened():
            print(f"Failed to open camera {self.camera_index}")
            return False

        # Set camera resolution
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        print(f"Camera {self.camera_index} opened successfully")
        return True

    def stop_camera(self) -> None:
        """Release camera resources."""
        if self.cap:
            self.cap.release()
            self.cap = None

    def recognize_user(self, frame: np.ndarray) -> tuple[Optional[str], Optional[str], float]:
        """
        Identify which registered user (if any) is in the frame.
        Returns (user_id, user_name, confidence) or (None, None, 0.0) if no match.

        Only every 3rd frame is analysed. On skipped frames the result of the
        last analysed frame is returned and ``self.last_result_fresh`` is set to
        False so the state machine does not treat it as a new detection.
        """
        # Only process every 3rd frame for performance
        self.frame_count += 1
        if self.frame_count % 3 != 0:
            self.last_result_fresh = False
            return self.last_result

        result: tuple[Optional[str], Optional[str], float] = (None, None, 0.0)
        if self.users:
            # Multi-user mode
            result = self._recognize_multi_user(frame)
        elif self.enrolled_encodings:
            # Legacy single-user mode
            is_present, confidence = self._recognize_legacy(frame)
            if is_present:
                result = ("legacy", "User", confidence)

        self.last_result = result
        self.last_result_fresh = True
        return result

    def _recognize_multi_user(self, frame: np.ndarray) -> tuple[Optional[str], Optional[str], float]:
        """Multi-user recognition - identify which user is present."""
        # Scale down frame for faster processing
        small_frame = cv2.resize(frame, (0, 0), fx=0.5, fy=0.5)
        rgb_frame = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)

        # Find faces
        face_locations = face_recognition.face_locations(rgb_frame)
        if not face_locations:
            return None, None, 0.0

        # Get encodings for detected faces
        face_encodings = face_recognition.face_encodings(rgb_frame, face_locations)

        best_match_id = None
        best_match_name = None
        best_confidence = 0.0

        for encoding in face_encodings:
            # Compare against all registered users
            for user_id, user_data in self.users.items():
                distances = face_recognition.face_distance(user_data.encodings, encoding)
                min_distance = min(distances)
                confidence = max(0, 1 - min_distance)

                if min_distance <= self.tolerance and confidence > best_confidence:
                    best_match_id = user_id
                    best_match_name = user_data.name
                    best_confidence = confidence

        return best_match_id, best_match_name, best_confidence

    def _recognize_legacy(self, frame: np.ndarray) -> tuple[bool, float]:
        """Legacy single-user recognition."""
        small_frame = cv2.resize(frame, (0, 0), fx=0.5, fy=0.5)
        rgb_frame = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)

        face_locations = face_recognition.face_locations(rgb_frame)
        if not face_locations:
            return False, 0.0

        face_encodings = face_recognition.face_encodings(rgb_frame, face_locations)

        for encoding in face_encodings:
            distances = face_recognition.face_distance(self.enrolled_encodings, encoding)
            min_distance = min(distances)
            confidence = max(0, 1 - min_distance)

            if min_distance <= self.tolerance:
                return True, confidence

        return False, 0.0

    def update_state(
        self,
        user_id: Optional[str],
        user_name: Optional[str],
        confidence: float,
        fresh: bool = True,
    ) -> bool:
        """Update presence state machine. Returns True if state changed.

        ``fresh`` is False when the result was carried forward from an earlier
        analysed frame. A carried-forward detection must not refresh
        ``last_detection_time`` or count toward ``min_frames``; a carried-forward
        non-detection still lets the time-based LEAVING -> ABSENT timeout fire.
        """
        current_time = time.time()
        old_state = self.state
        old_user = self.current_user_id
        user_detected = user_id is not None

        if user_detected and not fresh:
            return False

        if user_detected:
            self.last_detection_time = current_time
            self.detection_count += 1
            self.current_user_id = user_id
            self.current_user_name = user_name

            if self.state == PresenceState.ABSENT:
                self.state = PresenceState.DETECTING
            elif self.state == PresenceState.DETECTING:
                if self.detection_count >= self.min_frames:
                    self.state = PresenceState.PRESENT
                    self.detection_count = 0
            elif self.state == PresenceState.LEAVING:
                self.state = PresenceState.PRESENT
        else:
            self.detection_count = 0

            if self.state == PresenceState.PRESENT:
                self.state = PresenceState.LEAVING
            elif self.state == PresenceState.LEAVING:
                if (
                    self.last_detection_time
                    and current_time - self.last_detection_time > self.timeout
                ):
                    self.state = PresenceState.ABSENT
                    self.current_user_id = None
                    self.current_user_name = None
            elif self.state == PresenceState.DETECTING:
                self.state = PresenceState.ABSENT
                self.current_user_id = None
                self.current_user_name = None

        # State changed if either presence state or user identity changed
        return old_state != self.state or old_user != self.current_user_id

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
        try:
            payload = {
                "present": is_present,
                "confidence": confidence,
                "state": self.state.value,
                "userId": self.current_user_id,
                "userName": self.current_user_name,
            }
            response = requests.post(
                f"{self.backend_url}/api/presence",
                json=payload,
                timeout=2,
            )
            if response.status_code != 200:
                print(f"Backend returned status {response.status_code}")
        except requests.exceptions.RequestException as e:
            print(f"Failed to report presence: {e}")

    def process_frame(self, frame) -> bool:
        """Run one frame through recognition, the state machine and reporting.

        Returns True if a presence POST was sent for this frame.
        """
        user_id, user_name, confidence = self.recognize_user(frame)
        state_changed = self.update_state(
            user_id, user_name, confidence, fresh=self.last_result_fresh
        )

        if state_changed:
            if user_id:
                print(f"State: {self.state.value} - {user_name} ({confidence:.0%})")
            else:
                print(f"State: {self.state.value}")

        return self.maybe_report_presence(confidence)

    def run(self, show_preview: bool = False) -> None:
        """Main detection loop."""
        if not self.users and not self.enrolled_encodings:
            print("ERROR: No faces enrolled. Use the mobile app to register users.")
            return

        if not FR_AVAILABLE:
            print("ERROR: face_recognition library not available")
            return

        if not self.start_camera():
            print("Failed to start camera")
            return

        mode = f"{len(self.users)} user(s)" if self.users else "legacy mode"
        print(f"Starting presence detection ({mode})...")
        print("Press 'q' to quit" if show_preview else "Press Ctrl+C to quit")

        try:
            while True:
                ret, frame = self.cap.read()
                if not ret:
                    print("Failed to read frame")
                    time.sleep(0.1)
                    continue

                self.process_frame(frame)
                user_id, user_name, confidence = self.last_result

                if show_preview:
                    # Draw detection status
                    if user_id:
                        color = (0, 255, 0)
                        label = f"{user_name} ({confidence:.0%})"
                    else:
                        color = (0, 0, 255)
                        label = "Scanning..."

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
                    cv2.imshow("Presence Detection", frame)

                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break

                time.sleep(0.033)  # ~30 FPS

        except KeyboardInterrupt:
            print("\nStopping...")
        finally:
            self.stop_camera()
            if show_preview:
                cv2.destroyAllWindows()


class HaarCascadeDetector:
    """
    Simple face detection using OpenCV Haar cascades.
    Detects ANY face (no enrollment/recognition) - good for testing.
    Includes gesture recognition for dismiss/sleep functionality.
    """

    def __init__(
        self,
        backend_url: str = "http://localhost:3001",
        camera_index: int = 0,
        min_frames: int = 3,
        timeout: int = 5,
        enable_gestures: bool = True,
    ):
        self.backend_url = backend_url
        self.camera_index = camera_index
        self.min_frames = min_frames
        self.timeout = timeout
        self.enable_gestures = enable_gestures and GESTURE_AVAILABLE

        self.state = PresenceState.ABSENT
        self.detection_count = 0
        self.last_detection_time: Optional[float] = None
        self.cap: Optional[cv2.VideoCapture] = None

        # Load Haar cascade
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self.face_cascade = cv2.CascadeClassifier(cascade_path)

        # Initialize gesture detector if enabled
        self.gesture_detector = None
        if self.enable_gestures:
            self.gesture_detector = GestureDetector(use_mediapipe=False)
            print("Gesture detection enabled (swipe to sleep)")

    def start_camera(self) -> bool:
        """Initialize camera capture."""
        self.cap = cv2.VideoCapture(self.camera_index)
        if not self.cap.isOpened():
            print(f"Failed to open camera {self.camera_index}")
            return False
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        print(f"Camera {self.camera_index} opened successfully")
        return True

    def stop_camera(self) -> None:
        """Release camera resources."""
        if self.cap:
            self.cap.release()
            self.cap = None

    def detect_face(self, frame: np.ndarray) -> bool:
        """Detect any face in the frame using Haar cascades."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(80, 80),
        )
        return len(faces) > 0

    def update_state(self, face_detected: bool) -> bool:
        """Update presence state machine. Returns True if state changed."""
        current_time = time.time()
        old_state = self.state

        if face_detected:
            self.last_detection_time = current_time
            self.detection_count += 1

            if self.state == PresenceState.ABSENT:
                self.state = PresenceState.DETECTING
            elif self.state == PresenceState.DETECTING:
                if self.detection_count >= self.min_frames:
                    self.state = PresenceState.PRESENT
                    self.detection_count = 0
            elif self.state == PresenceState.LEAVING:
                self.state = PresenceState.PRESENT
        else:
            self.detection_count = 0

            if self.state == PresenceState.PRESENT:
                self.state = PresenceState.LEAVING
            elif self.state == PresenceState.LEAVING:
                if (
                    self.last_detection_time
                    and current_time - self.last_detection_time > self.timeout
                ):
                    self.state = PresenceState.ABSENT
            elif self.state == PresenceState.DETECTING:
                self.state = PresenceState.ABSENT

        return old_state != self.state

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
                    "method": "haar",
                },
                timeout=2,
            )
            if response.status_code != 200:
                print(f"Backend returned status {response.status_code}")
        except requests.exceptions.RequestException as e:
            print(f"Failed to report presence: {e}")

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
                print(f"Gesture report failed: {response.status_code}")
        except requests.exceptions.RequestException as e:
            print(f"Failed to report gesture: {e}")

    def run(self, show_preview: bool = False) -> None:
        """Main detection loop."""
        if not CV_AVAILABLE:
            print("ERROR: OpenCV not available")
            return

        if not self.start_camera():
            print("Failed to start camera")
            return

        print("Starting presence detection (Haar cascade - detects any face)...")
        print("NOTE: This mode detects any face, not just enrolled users")
        if self.enable_gestures:
            print("Gestures enabled: swipe left/right or wave to dismiss")
        print("Press 'q' to quit" if show_preview else "Press Ctrl+C to quit")

        last_gesture_text = ""
        gesture_display_until = 0

        try:
            while True:
                ret, frame = self.cap.read()
                if not ret:
                    print("Failed to read frame")
                    time.sleep(0.1)
                    continue

                face_detected = self.detect_face(frame)
                state_changed = self.update_state(face_detected)

                if state_changed:
                    print(f"State: {self.state.value}")
                    self.report_presence()

                # Check for gestures
                if self.gesture_detector and self.state == PresenceState.PRESENT:
                    gesture = self.gesture_detector.detect(frame)
                    if gesture:
                        print(f"Gesture: {gesture.type.value} ({gesture.confidence:.0%})")
                        self.report_gesture(gesture.type.value, gesture.confidence)
                        last_gesture_text = f"GESTURE: {gesture.type.value.upper()}"
                        gesture_display_until = time.time() + 2.0

                if show_preview:
                    # Draw detection status
                    color = (0, 255, 0) if face_detected else (0, 0, 255)
                    label = "FACE DETECTED" if face_detected else "Scanning..."

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

                    # Draw rectangles around detected faces
                    if face_detected:
                        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                        faces = self.face_cascade.detectMultiScale(
                            gray, scaleFactor=1.1, minNeighbors=5, minSize=(80, 80)
                        )
                        for (x, y, w, h) in faces:
                            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)

                    cv2.imshow("Presence Detection (Haar)", frame)

                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break

                time.sleep(0.033)  # ~30 FPS

        except KeyboardInterrupt:
            print("\nStopping...")
        finally:
            self.stop_camera()
            if self.gesture_detector:
                self.gesture_detector.close()
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


def main():
    parser = argparse.ArgumentParser(
        description="SkyGlass presence detection",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Detection methods:
  face_recognition  Best accuracy, recognizes enrolled user only
                    Requires: pip install face_recognition (includes dlib)
  haar              Basic detection using OpenCV, detects ANY face
                    No extra install needed (built into OpenCV)
  mediapipe         Good accuracy, lighter than face_recognition
                    Requires: pip install mediapipe

Current best available method: %(default_method)s
        """ % {"default_method": DEFAULT_METHOD or "none (use --simulate)"},
    )
    parser.add_argument(
        "--method",
        choices=["face_recognition", "haar", "mediapipe", "auto"],
        default="auto",
        help="Detection method (default: auto - uses best available)",
    )
    parser.add_argument(
        "--enroll",
        action="store_true",
        help="Enroll your face for recognition (requires face_recognition)",
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
        default=0,
        help="Camera index (default: 0)",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=0.6,
        help="Face match tolerance 0-1, lower=stricter (default: 0.6)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=5,
        help="Seconds before marking absent (default: 5)",
    )
    parser.add_argument(
        "--samples",
        type=int,
        default=5,
        help="Number of face samples for enrollment (default: 5)",
    )
    parser.add_argument(
        "--no-gestures",
        action="store_true",
        help="Disable gesture detection (swipe to sleep)",
    )

    args = parser.parse_args()

    # Determine which method to use
    method = args.method
    if method == "auto":
        method = DEFAULT_METHOD

    if args.enroll:
        if not FR_AVAILABLE:
            print("Error: face_recognition required for enrollment")
            print("Install with: pip install face_recognition")
            sys.exit(1)
        enroller = FaceEnroller(camera_index=args.camera)
        success = enroller.enroll(num_samples=args.samples)
        sys.exit(0 if success else 1)
    elif args.simulate:
        detector = SimulatedDetector(backend_url=args.backend)
        detector.run()
    elif method == "haar":
        if not CV_AVAILABLE:
            print("Error: OpenCV required")
            print("Install with: pip install opencv-python")
            sys.exit(1)
        print("Using Haar cascade detection (detects any face)")
        detector = HaarCascadeDetector(
            backend_url=args.backend,
            camera_index=args.camera,
            timeout=args.timeout,
            enable_gestures=not args.no_gestures,
        )
        detector.run(show_preview=args.preview)
    elif method == "face_recognition":
        if not CV_AVAILABLE or not FR_AVAILABLE:
            print("Error: OpenCV and face_recognition required")
            print("Install with: pip install opencv-python face_recognition")
            print("Or run with --method haar for basic detection")
            sys.exit(1)
        print("Using face_recognition (recognizes enrolled user only)")
        detector = PresenceDetector(
            backend_url=args.backend,
            camera_index=args.camera,
            tolerance=args.tolerance,
            timeout=args.timeout,
        )
        detector.run(show_preview=args.preview)
    elif method == "mediapipe":
        print("MediaPipe detection not yet implemented")
        print("Use --method haar or --method face_recognition")
        sys.exit(1)
    else:
        print("No detection method available!")
        print("Install opencv-python or use --simulate mode")
        sys.exit(1)


if __name__ == "__main__":
    main()
