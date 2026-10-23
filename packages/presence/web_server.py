#!/usr/bin/env python3
"""
SkyGlass presence/admin server (port 5000).

Camera side of face enrollment, driven by the phone app through the backend
(/api/registration/*): /api/start + /api/capture write
face_data/users/<userId>/, /video_feed streams the camera preview, /api/users
lists and deletes enrolled faces. Also hosts the slim admin portal blueprint
(admin_portal.py: WiFi API, logs).

Access control (docs/SECURITY.md): device controls need the internal service
token (the backend) or an admin session; the camera (/video_feed, capture)
needs the token of the active enrollment session, which only the backend can
open and which the mirror always shows as a full-screen overlay.

The camera is opened only while an enrollment session is open. The detector
holds it the rest of the time and lets go when this server claims it
(cameras.claim_camera): only one process can stream a camera on a Pi.

Production: gunicorn -c gunicorn.conf.py wsgi:app
Development: python web_server.py [--port 5000] [--camera 0]
"""

import argparse
import json
import pickle
import re
import shutil
import threading
import time
from pathlib import Path
from typing import Optional

import requests

import cv2
from flask import Flask, Response, jsonify, request

import auto_capture
import cameras
import rotation
import security
from admin_portal import admin
from auth import device_auth_required, enrollment_required
from detector import ConfigError, resolve_settings

from face_detect import FaceDetector, dlib_locations

# Check for face_recognition
try:
    import face_recognition
    FR_AVAILABLE = True
except ImportError:
    FR_AVAILABLE = False

FACE_DATA_DIR = Path(__file__).parent / "face_data"
USERS_DIR = FACE_DATA_DIR / "users"

# User ids come from URL path parameters and are joined into filesystem paths,
# so they must be restricted to a safe charset (UUIDs, slugs).
USER_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def safe_user_dir(user_id: str, base_dir: Optional[Path] = None) -> Path:
    """Return the face-data directory for ``user_id``.

    Raises ValueError unless ``user_id`` matches USER_ID_PATTERN and the
    resolved path is strictly inside ``base_dir`` (default USERS_DIR). Every
    request-supplied user id must go through this before touching the
    filesystem.
    """
    if not isinstance(user_id, str) or not USER_ID_PATTERN.fullmatch(user_id):
        raise ValueError("invalid user id")
    base = (base_dir if base_dir is not None else USERS_DIR).resolve()
    candidate = (base / user_id).resolve()
    if candidate == base or base not in candidate.parents:
        raise ValueError("invalid user id")
    return candidate


app = Flask(__name__)


@app.before_request
def _validate_user_id_param():
    """Reject any route whose <user_id> path parameter is not a safe id."""
    view_args = request.view_args or {}
    if "user_id" in view_args:
        try:
            safe_user_dir(view_args["user_id"])
        except ValueError:
            return jsonify({"success": False, "message": "Invalid user id"}), 400
    return None


# Admin portal sessions. The signing key persists in data/ (0600) so sessions
# survive restarts; HttpOnly + SameSite=Strict keep the cookie away from page
# scripts and cross-site requests (state changes are CSRF-checked as well).
app.secret_key = security.get_session_secret()
app.config.update(
    SESSION_COOKIE_NAME="skyglass_admin",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Strict",
    PERMANENT_SESSION_LIFETIME=12 * 3600,
    MAX_CONTENT_LENGTH=64 * 1024,
)


@app.after_request
def _security_headers(response):
    """No CORS headers are ever sent, so browsers refuse cross-origin reads
    and every preflight (custom headers, JSON bodies)."""
    for header in [h for h in response.headers.keys() if h.lower().startswith("access-control-")]:
        del response.headers[header]
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    # Keeps the enrollment token (/video_feed?token=...) out of Referer headers.
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers.setdefault("Cache-Control", "no-store")
    return response


app.register_blueprint(admin)

# Configuration
BACKEND_URL = "http://localhost:3001"

# Global state
# The single enrollment session. Its token is the only key to the camera.
enrollment_gate = security.EnrollmentGate()
_expiry_timer: Optional[threading.Timer] = None
# Each MJPEG viewer holds a server thread; cap them so API calls keep working.
MAX_VIDEO_STREAMS = 3
_stream_slots = threading.BoundedSemaphore(MAX_VIDEO_STREAMS)

camera_lock = threading.Lock()
camera: Optional[cameras.Camera] = None
# --camera in development; otherwise presence.camera_index from config.yaml,
# read at each session so it always matches the detector.
camera_index: Optional[int] = None
# The detector checks for a claim every CameraOwner.CLAIM_POLL_SECONDS and
# needs a moment to close the camera; the backend gives /api/start 5 s.
CAMERA_OPEN_TIMEOUT = 3.5
registration_state = {
    "active": False,
    "user_id": None,     # app profile id, required by /api/start
    "user_name": None,
    "samples_needed": 5,
    "samples_captured": 0,
    "encodings": [],
}
# Guards registration_state and the session's AutoCapture: request threads
# (manual capture, reset), the analysis thread and the expiry timer all touch
# them. Never held across a backend call or a thread join.
registration_lock = threading.RLock()


def internal_headers() -> dict:
    """Credentials for the backend's internal-only endpoints."""
    try:
        return {security.INTERNAL_HEADER: security.get_internal_token()}
    except (OSError, RuntimeError) as e:
        print(f"Internal token unavailable: {e}")
        return {}


def notify_backend(endpoint: str, data: dict) -> bool:
    """Notify the main backend about registration state changes."""
    try:
        response = requests.post(
            f"{BACKEND_URL}/api/registration/{endpoint}", json=data,
            headers=internal_headers(), timeout=2,
        )
        return response.status_code == 200
    except requests.exceptions.RequestException as e:
        print(f"Failed to notify backend: {e}")
        return False


def configured_camera_index() -> int:
    if camera_index is not None:
        return camera_index
    try:
        settings, _ = resolve_settings(argparse.Namespace())
    except ConfigError as e:
        print(f"Invalid presence settings ({e}); using camera 0")
        return 0
    return settings["camera_index"]


def acquire_camera() -> bool:
    """Take the camera from the detector and open it for an enrollment session."""
    global camera
    cameras.claim_camera(enrollment_gate.ttl + 5)
    with camera_lock:
        if camera is not None:
            return True
        index = configured_camera_index()
        deadline = time.monotonic() + CAMERA_OPEN_TIMEOUT
        while True:
            camera = cameras.open_camera(index)
            if camera is not None:
                print(f"Camera {index} opened: {camera.description}")
                return True
            if time.monotonic() >= deadline:
                break
            time.sleep(0.25)
    cameras.release_claim()
    print(f"Failed to open camera {index}")
    return False


def release_camera():
    """Close the camera and hand it back to the detector."""
    global camera
    with camera_lock:
        if camera is not None:
            camera.release()
            camera = None
    cameras.release_claim()


# Follows display.orientation (presence.camera_rotation overrides it).
upright = rotation.CameraRotation()


def read_camera():
    """Read one upright frame straight from the camera (None if closed or failed)."""
    with camera_lock:
        if camera is None:
            return None
        ret, frame = camera.read()
        if not ret:
            return None
    # Upright on a portrait mount, for the captures and the mirror's feed alike.
    return upright.apply(frame)


def get_frame():
    """A copy of the latest frame. During a session the CaptureLoop thread is
    the only camera reader, shared by the feed, manual and auto capture."""
    loop = _capture_loop
    if loop is None:
        return read_camera()
    return loop.latest()


# One detector shared by the MJPEG stream thread and the capture endpoints
# (FaceDetector locks internally). Loaded lazily so importing this module in
# tests does not require the model file.
_face_detector: Optional[FaceDetector] = None
_face_detector_lock = threading.Lock()


def get_face_detector() -> FaceDetector:
    global _face_detector
    with _face_detector_lock:
        if _face_detector is None:
            _face_detector = FaceDetector(min_size=100)
        return _face_detector


def detect_faces(frame):
    """Detect faces; returns face_detect.Face records (box + landmarks)."""
    return get_face_detector().detect_faces(frame)


def detect_for_auto_capture(frame):
    """The analysis thread's detector call (separate so tests can stub it)."""
    return get_face_detector().detect_faces(frame)


class CaptureLoop:
    """One enrollment session's camera reader and hands-free capture.

    The reader thread keeps the latest frame; the analysis thread runs face
    detection at auto_capture.ANALYSIS_FPS, steps the session's AutoCapture,
    stores samples and sends guidance to the backend (only from this thread,
    so a slow backend never stalls frame reading).
    """

    READ_INTERVAL = 1 / 60   # paces cameras that return instantly
    STALE_SECONDS = 1.0      # get_frame() returns None for older frames

    def __init__(self, samples_needed: int):
        self.auto = auto_capture.AutoCapture(samples_needed)
        self._stop = threading.Event()
        self._frame_cond = threading.Condition()
        self._frame = None
        self._frame_at = 0.0
        self._seq = 0
        self._paused = 0  # open manual captures; guarded by registration_lock
        # Guidance reason last sent to the backend (store_sample sets cooldown).
        self.last_guidance: Optional[str] = None
        self._threads = [
            threading.Thread(target=self._read_loop, name="enroll-camera", daemon=True),
            threading.Thread(target=self._analyse_loop, name="enroll-analyse", daemon=True),
        ]

    def start(self) -> None:
        for t in self._threads:
            t.start()

    def stop(self) -> None:
        """Stop both threads; safe to call from either of them."""
        self._stop.set()
        with self._frame_cond:
            self._frame_cond.notify_all()
        for t in self._threads:
            if t.is_alive() and t is not threading.current_thread():
                t.join(timeout=3)

    @property
    def running(self) -> bool:
        return any(t.is_alive() for t in self._threads)

    def latest(self, wait: float = 1.0):
        """Copy of the newest frame, waiting up to ``wait`` s for a first one."""
        with self._frame_cond:
            if self._frame is None and not self._stop.is_set():
                self._frame_cond.wait(wait)
            if self._frame is None or time.monotonic() - self._frame_at > self.STALE_SECONDS:
                return None
            return self._frame.copy()

    def pause(self) -> None:
        with registration_lock:
            self._paused += 1

    def resume(self) -> None:
        with registration_lock:
            self._paused = max(0, self._paused - 1)
            if not self._paused:
                self.auto.reset_hold()

    def _read_loop(self) -> None:
        while not self._stop.is_set():
            started = time.monotonic()
            frame = read_camera()
            if frame is None:
                self._stop.wait(0.05)
                continue
            with self._frame_cond:
                self._frame = frame
                self._frame_at = time.monotonic()
                self._seq += 1
                self._frame_cond.notify_all()
            self._stop.wait(max(0.0, self.READ_INTERVAL - (time.monotonic() - started)))

    def _analyse_loop(self) -> None:
        interval = 1.0 / auto_capture.ANALYSIS_FPS
        last_seq = 0
        failed = False
        while not self._stop.is_set():
            started = time.monotonic()
            with self._frame_cond:
                frame, seq = self._frame, self._seq
            if frame is not None and seq != last_seq:
                last_seq = seq
                try:
                    self._analyse(frame)
                    failed = False
                except Exception as e:  # keep the session alive; manual capture still works
                    if not failed:
                        print(f"[Enrollment] Auto capture error: {e}")
                    failed = True
            self._stop.wait(max(0.0, interval - (time.monotonic() - started)))

    def _analyse(self, frame) -> None:
        """One analysis step: decide, send guidance on change, capture."""
        faces = detect_for_auto_capture(frame)
        with registration_lock:
            if self._paused or self._stop.is_set() or not registration_state["active"]:
                return
            decision = self.auto.update(faces, frame.shape, time.monotonic())

        if decision.reason != self.last_guidance or decision.hold_restarted:
            send_guidance(decision.reason)

        if decision.capture:
            result = store_sample(frame, faces[0])
            if result["success"]:
                print(f"[Enrollment] Auto capture {result['samples_captured']}/{result['samples_needed']}")
            else:
                with registration_lock:
                    self.auto.capture_failed()


def send_guidance(reason: str) -> None:
    """POST /api/registration/guidance; the backend keeps the last one."""
    loop = _capture_loop
    if loop is not None:
        loop.last_guidance = reason
    hold_ms = int(auto_capture.HOLD_SECONDS * 1000) if reason == auto_capture.HOLD else 0
    notify_backend("guidance", {"reason": reason, "holdMs": hold_ms})


# The open session's CaptureLoop (None outside a session).
_capture_loop: Optional[CaptureLoop] = None
_capture_loop_lock = threading.Lock()


def start_capture_loop() -> None:
    global _capture_loop
    stop_capture_loop()
    loop = CaptureLoop(registration_state["samples_needed"])
    with _capture_loop_lock:
        _capture_loop = loop
    loop.start()


def stop_capture_loop() -> None:
    global _capture_loop
    with _capture_loop_lock:
        loop, _capture_loop = _capture_loop, None
    if loop is not None:
        loop.stop()


def _get_gate() -> security.EnrollmentGate:
    return enrollment_gate


def open_enrollment() -> tuple:
    """Open a session; returns (token, expires_at epoch seconds)."""
    global _expiry_timer
    token, expires_at = enrollment_gate.open()
    if _expiry_timer is not None:
        _expiry_timer.cancel()
    _expiry_timer = threading.Timer(enrollment_gate.ttl + 0.5, _expire_enrollment, args=(token,))
    _expiry_timer.daemon = True
    _expiry_timer.start()
    return token, expires_at


def end_enrollment(notify: bool) -> None:
    """Close the session: its token stops working and open /video_feed
    streams end within one frame."""
    global _expiry_timer
    enrollment_gate.close()
    if _expiry_timer is not None:
        _expiry_timer.cancel()
        _expiry_timer = None
    # Before release_camera: the loop's reader is the camera's only user.
    stop_capture_loop()
    with registration_lock:
        was_active = registration_state["active"]
        registration_state["active"] = False
        registration_state["samples_captured"] = 0
        registration_state["encodings"] = []
    release_camera()
    if notify and was_active:
        # Hide the mirror overlay. source=presence-server stops the backend
        # from calling /api/reset back.
        notify_backend("cancel", {"source": "presence-server"})


def _expire_enrollment(token: str) -> None:
    if registration_state["active"] and not enrollment_gate.check(token):
        print("[Enrollment] Session expired")
        end_enrollment(notify=True)


def enrollment_active() -> bool:
    """True while the session is open; ends one whose token has expired."""
    if registration_state["active"] and not enrollment_gate.is_open():
        end_enrollment(notify=True)
    return registration_state["active"]


def generate_frames(token: str):
    """MJPEG stream; ends as soon as the enrollment session does."""
    try:
        while enrollment_gate.check(token):
            frame = get_frame()
            if frame is None:
                time.sleep(0.1)
                continue

            # Plain frames: the mirror UI draws its own outline and hints.
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            frame_bytes = buffer.tobytes()

            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

            time.sleep(0.033)  # ~30 FPS
    finally:
        print("[Enrollment] Camera stream closed")


@app.route('/video_feed')
@enrollment_required(_get_gate, allow_query=True)
def video_feed():
    """MJPEG stream, only during an enrollment session (?token=<enrollment token>)."""
    token = request.headers.get(security.ENROLLMENT_HEADER) or request.args.get("token")
    if not _stream_slots.acquire(blocking=False):
        return jsonify({"success": False, "error": "Too many open camera streams"}), 503
    released = threading.Event()

    def release_slot():
        if not released.is_set():
            released.set()
            _stream_slots.release()

    response = Response(
        generate_frames(token),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )
    response.call_on_close(release_slot)
    return response


@app.route('/api/health')
def api_health():
    """Quick health check endpoint. The camera is closed outside face
    registrations, so it does not count."""
    return jsonify({
        "status": "ok",
        "timestamp": int(time.time() * 1000),
    })


@app.route('/api/status')
def api_status():
    """Get detailed server status."""
    return jsonify({
        "status": "healthy",
        "camera_open": camera is not None,  # only during a face registration
        "face_recognition_available": FR_AVAILABLE,
        "registration_active": enrollment_active(),
        "samples_captured": registration_state["samples_captured"],
        "samples_needed": registration_state["samples_needed"],
        "timestamp": int(time.time() * 1000),
    })


@app.route('/api/start', methods=['POST'])
def api_start():
    """Open an enrollment session. Internal token only: the backend calls this
    from /api/registration/start and shows the registration overlay on the
    mirror, so the camera can never be opened without the mirror showing it.

    Body (JSON): {"userId": <app profile id, required>, "name": <display name>}.
    The captured face is stored under face_data/users/<userId>/.
    Returns {"success", "enrollmentToken", "expiresAt" (ms epoch), "ttlSeconds"}.
    """
    if not security.has_internal_token(request):
        return jsonify({"success": False, "error": "Internal token required"}), 401
    data = request.get_json(silent=True) or {}
    user_id = data.get("userId")
    try:
        safe_user_dir(user_id)
    except ValueError:
        return jsonify({"success": False, "message": "A valid userId is required"}), 400
    name = data.get("name") or data.get("userName")
    if not acquire_camera():
        return jsonify({"success": False, "message": "Camera not available"}), 503

    with registration_lock:
        registration_state["active"] = True
        registration_state["user_id"] = user_id
        registration_state["user_name"] = name if isinstance(name, str) and name.strip() else "Unknown"
        registration_state["samples_captured"] = 0
        registration_state["encodings"] = []
    token, expires_at = open_enrollment()
    # Hands-free capture (auto_capture.py) watches the camera from here on.
    start_capture_loop()

    return jsonify({
        "success": True,
        "enrollmentToken": token,
        "expiresAt": int(expires_at * 1000),
        "ttlSeconds": int(enrollment_gate.ttl),
    })


MAX_CAPTURE_DELAY = 5


@app.route('/api/capture', methods=['POST'])
@enrollment_required(_get_gate, allow_internal=True)
def api_capture():
    """Capture a face sample now (backend with the internal token, or the
    enrollment token in X-SkyGlass-Enrollment): the manual fallback to the
    hands-free capture.

    Optional JSON {"delay": seconds, 0-5}: auto capture is paused, the server
    waits that long (the mirror's 3-2-1 countdown), then captures the latest
    frame with the framing check only.
    """
    data = request.get_json(silent=True)
    delay = data.get("delay", 0) if isinstance(data, dict) else 0
    if (isinstance(delay, bool) or not isinstance(delay, (int, float))
            or not 0 <= delay <= MAX_CAPTURE_DELAY):
        return jsonify({"success": False, "message": f"delay must be 0-{MAX_CAPTURE_DELAY} seconds"}), 400

    if not enrollment_active():
        return jsonify({"success": False, "message": "Registration not active"})

    loop = _capture_loop
    if loop is not None:
        loop.pause()
    try:
        if delay:
            time.sleep(delay)
            if not enrollment_active():
                return jsonify({"success": False, "message": "Registration not active"})
        return jsonify(capture_now())
    finally:
        if loop is not None:
            loop.resume()


def capture_now() -> dict:
    """Manual capture of the latest frame: framing check, then store_sample."""
    frame = get_frame()
    if frame is None:
        return {"success": False, "message": "Camera not available"}

    faces = detect_faces(frame)
    reason = auto_capture.assess_framing(faces, frame.shape)
    if reason in (auto_capture.NO_FACE, auto_capture.MULTIPLE):
        return {"success": False, "message": "Need exactly one face visible"}
    if reason is not None:
        return {"success": False, "message": "Center your face in the box"}
    return store_sample(frame, faces[0])


def store_sample(frame, face) -> dict:
    """Encode and count one sample (manual and auto capture alike), notify
    the backend, and finish the registration after the last one.

    Returns the /api/capture response body.
    """
    # Encode the face YuNet found, exactly as detector.py does when matching.
    # A sample that cannot be encoded is not counted: every registration must
    # end with one encoding per sample or the detector cannot recognise them.
    encoding = None
    if FR_AVAILABLE:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        encodings = face_recognition.face_encodings(rgb, dlib_locations([face]))
        if not encodings:
            return {"success": False, "message": "Hold still and face the mirror"}
        encoding = encodings[0]

    with registration_lock:
        needed = registration_state["samples_needed"]
        if not registration_state["active"] or registration_state["samples_captured"] >= needed:
            return {"success": False, "message": "Registration not active"}
        if encoding is not None:
            registration_state["encodings"].append(encoding)
        registration_state["samples_captured"] += 1
        captured = registration_state["samples_captured"]
        complete = captured >= needed
        loop = _capture_loop
        if loop is not None:
            # Manual samples advance the hands-free steps too.
            loop.auto.captured(time.monotonic(), face)
        if complete:
            save_registration()

    # Drop "Hold still" on the mirror and phone at once, then report progress.
    send_guidance(auto_capture.COOLDOWN_REASON)
    notify_backend("progress", {"samplesCollected": captured, "samplesNeeded": needed})
    if complete:
        end_enrollment(notify=False)
        notify_backend("complete", {})

    return {
        "success": True,
        "samples_captured": captured,
        "samples_needed": needed,
        "complete": complete,
    }


@app.route('/api/reset', methods=['POST'])
@enrollment_required(_get_gate, allow_internal=True)
def api_reset():
    """End the enrollment session (camera stream stops)."""
    end_enrollment(notify=True)
    return jsonify({"success": True})


def save_registration():
    """Persist the finished registration session as a user record."""
    save_user_face_data(
        registration_state["user_id"],
        registration_state["user_name"],
        registration_state["encodings"],
        samples=registration_state["samples_captured"],
    )


def save_user_face_data(user_id: str, user_name: str, encodings: list, samples: int) -> None:
    """Write face_data/users/<user_id>/{encodings.pkl,metadata.json}.

    ``encodings`` is empty when face_recognition is not installed: the samples
    were validated by the face detector but nothing could be encoded. The
    record is still written so the app can list and delete it, and so the
    opencv detector (which needs no encodings) count the mirror as
    enrolled.
    """
    user_dir = safe_user_dir(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    with open(user_dir / "encodings.pkl", "wb") as f:
        pickle.dump(list(encodings), f)

    metadata = {
        "name": user_name,
        "samples": samples,
        "encodings": len(encodings),
        "enrolled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(user_dir / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    print(
        f"[Enrollment] Saved user {user_name} ({user_id}): "
        f"{samples} samples, {len(encodings)} encodings"
    )


def delete_user_face_data(user_id: str) -> bool:
    """Delete face data for a specific user."""
    user_dir = safe_user_dir(user_id)
    if not user_dir.is_dir():
        return False

    # Remove all files in user directory
    shutil.rmtree(user_dir)
    print(f"[Enrollment] Deleted face data for user {user_id}")
    return True


# ============================================================
# PER-USER ENROLLMENT ENDPOINTS
# ============================================================

@app.route('/api/users/<user_id>/face', methods=['DELETE'])
@device_auth_required
def api_user_face_delete(user_id: str):
    """Delete face data for a user."""
    try:
        deleted = delete_user_face_data(user_id)
    except ValueError:
        return jsonify({"success": False, "message": "Invalid user id"}), 400

    if deleted:
        return jsonify({"success": True, "message": "Face data deleted"})
    else:
        return jsonify({"success": False, "message": "No face data found"}), 404


@app.route('/api/users/<user_id>/face', methods=['GET'])
@device_auth_required
def api_user_face_status(user_id: str):
    """Check if a user has face data enrolled."""
    user_dir = safe_user_dir(user_id)
    encodings_file = user_dir / "encodings.pkl"
    metadata_file = user_dir / "metadata.json"

    if not encodings_file.exists():
        return jsonify({
            "enrolled": False,
            "samples": 0,
        })

    metadata = {}
    if metadata_file.exists():
        with open(metadata_file, "r") as f:
            metadata = json.load(f)

    return jsonify({
        "enrolled": True,
        "samples": metadata.get("samples", 0),
        "enrolledAt": metadata.get("enrolled_at"),
        "name": metadata.get("name"),
    })


@app.route('/api/users', methods=['GET'])
@device_auth_required
def api_list_enrolled_users():
    """List all users with face data enrolled on this mirror."""
    users = []

    if USERS_DIR.exists():
        for user_dir in USERS_DIR.iterdir():
            if not user_dir.is_dir():
                continue

            user_id = user_dir.name
            encodings_file = user_dir / "encodings.pkl"
            metadata_file = user_dir / "metadata.json"

            if not encodings_file.exists():
                continue

            metadata = {}
            if metadata_file.exists():
                with open(metadata_file, "r") as f:
                    metadata = json.load(f)

            users.append({
                "userId": user_id,
                "name": metadata.get("name", "Unknown"),
                "samples": metadata.get("samples", 0),
                "enrolledAt": metadata.get("enrolled_at"),
            })

    return jsonify({"users": users})


def main():
    parser = argparse.ArgumentParser(description="SkyGlass presence/admin server (development)")
    parser.add_argument("--port", "-p", type=int, default=5000, help="Port to run on (default: 5000)")
    parser.add_argument("--camera", "-c", type=int,
                        help="Camera index (default: presence.camera_index from config.yaml)")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to (default: 0.0.0.0)")

    args = parser.parse_args()

    global camera_index
    camera_index = args.camera

    print(f"SkyGlass presence/admin server on http://{args.host}:{args.port} (admin portal at /admin)")
    print("Face enrollment is driven by the phone app.")
    if not FR_AVAILABLE:
        print("NOTE: face_recognition not installed; registration works but stores no face encodings.")

    try:
        app.run(host=args.host, port=args.port, threaded=True)
    finally:
        release_camera()


if __name__ == "__main__":
    main()
