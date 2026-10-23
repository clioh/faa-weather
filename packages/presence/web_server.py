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

import rotation
import security
from admin_portal import admin
from auth import device_auth_required, enrollment_required

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
camera: Optional[cv2.VideoCapture] = None
camera_index = 0
registration_state = {
    "active": False,
    "user_id": None,     # app profile id, required by /api/start
    "user_name": None,
    "samples_needed": 5,
    "samples_captured": 0,
    "encodings": [],
}


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


def init_camera(index: int = 0) -> bool:
    """Initialize the camera."""
    global camera, camera_index
    camera_index = index

    with camera_lock:
        if camera is not None:
            camera.release()

        camera = cv2.VideoCapture(index)
        if not camera.isOpened():
            print(f"Failed to open camera {index}")
            return False

        camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        camera.set(cv2.CAP_PROP_FPS, 30)
        print(f"Camera {index} initialized")
        return True


def release_camera():
    """Release the camera."""
    global camera
    with camera_lock:
        if camera is not None:
            camera.release()
            camera = None

# Follows display.orientation (presence.camera_rotation overrides it).
upright = rotation.CameraRotation()


def get_frame():
    """Get a frame from the camera."""
    with camera_lock:
        if camera is None or not camera.isOpened():
            return None
        ret, frame = camera.read()
        if not ret:
            return None
        # Upright on a portrait mount, for the captures and the mirror's feed alike.
        return upright.apply(frame)


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
    """Detect faces; returns a list of (x, y, w, h) boxes."""
    return get_face_detector().detect(frame)


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
    was_active = registration_state["active"]
    registration_state["active"] = False
    registration_state["samples_captured"] = 0
    registration_state["encodings"] = []
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

            # Detect faces
            faces = detect_faces(frame)

            # Draw face rectangles
            h, w_frame = frame.shape[:2]
            center_x, center_y = w_frame // 2, h // 2

            # Draw center guide box
            guide_size = 120
            cv2.rectangle(
                frame,
                (center_x - guide_size, center_y - guide_size),
                (center_x + guide_size, center_y + guide_size),
                (100, 100, 100),
                2,
            )

            for (x, y, w, h) in faces:
                face_center_x = x + w // 2
                face_center_y = y + h // 2

                # Check if face is centered and large enough
                dx = abs(face_center_x - center_x)
                dy = abs(face_center_y - center_y)

                if dx < 80 and dy < 80 and w > 120:
                    color = (0, 255, 0)  # Green - ready
                else:
                    color = (0, 165, 255)  # Orange - not ready

                cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)

            # Add status overlay
            if registration_state["active"]:
                status_text = f"Sample {registration_state['samples_captured'] + 1}/{registration_state['samples_needed']}"
                cv2.putText(frame, status_text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

            # Encode frame as JPEG
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
    """Quick health check endpoint."""
    return jsonify({
        "status": "ok" if camera is not None and camera.isOpened() else "degraded",
        "timestamp": int(time.time() * 1000),
    })


@app.route('/api/status')
def api_status():
    """Get detailed server status."""
    return jsonify({
        "status": "healthy" if camera is not None and camera.isOpened() else "degraded",
        "camera_ready": camera is not None and camera.isOpened(),
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

    registration_state["active"] = True
    registration_state["user_id"] = user_id
    registration_state["user_name"] = name if isinstance(name, str) and name.strip() else "Unknown"
    registration_state["samples_captured"] = 0
    registration_state["encodings"] = []
    token, expires_at = open_enrollment()

    return jsonify({
        "success": True,
        "enrollmentToken": token,
        "expiresAt": int(expires_at * 1000),
        "ttlSeconds": int(enrollment_gate.ttl),
    })


@app.route('/api/capture', methods=['POST'])
@enrollment_required(_get_gate, allow_internal=True)
def api_capture():
    """Capture a face sample (backend with the internal token, or the
    enrollment token in X-SkyGlass-Enrollment)."""
    if not enrollment_active():
        return jsonify({"success": False, "message": "Registration not active"})

    frame = get_frame()
    if frame is None:
        return jsonify({"success": False, "message": "Camera not available"})

    # Detect faces
    faces = detect_faces(frame)

    if len(faces) != 1:
        return jsonify({
            "success": False,
            "message": "Need exactly one face visible"
        })

    x, y, w, h = faces[0]

    # Check if face is centered and large enough
    frame_h, frame_w = frame.shape[:2]
    center_x, center_y = frame_w // 2, frame_h // 2
    face_center_x = x + w // 2
    face_center_y = y + h // 2

    dx = abs(face_center_x - center_x)
    dy = abs(face_center_y - center_y)

    if dx > 80 or dy > 80 or w < 120:
        return jsonify({
            "success": False,
            "message": "Center your face in the box"
        })

    # Encode the face YuNet found, exactly as detector.py does when matching.
    # A sample that cannot be encoded is not counted: every registration must
    # end with one encoding per sample or the detector cannot recognise them.
    if FR_AVAILABLE:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        encodings = face_recognition.face_encodings(rgb, dlib_locations([faces[0]]))
        if not encodings:
            return jsonify({
                "success": False,
                "message": "Hold still and face the mirror"
            })
        registration_state["encodings"].append(encodings[0])

    registration_state["samples_captured"] += 1

    # Notify backend of progress
    notify_backend("progress", {
        "samplesCollected": registration_state["samples_captured"],
        "samplesNeeded": registration_state["samples_needed"],
    })

    # Check if complete
    complete = registration_state["samples_captured"] >= registration_state["samples_needed"]

    captured = registration_state["samples_captured"]
    if complete:
        save_registration()
        end_enrollment(notify=False)
        notify_backend("complete", {})

    return jsonify({
        "success": True,
        "samples_captured": captured,
        "samples_needed": registration_state["samples_needed"],
        "complete": complete,
    })


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
    parser.add_argument("--camera", "-c", type=int, default=0, help="Camera index (default: 0)")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to (default: 0.0.0.0)")

    args = parser.parse_args()

    # Initialize camera
    if not init_camera(args.camera):
        print("Failed to initialize camera. Exiting.")
        return

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
