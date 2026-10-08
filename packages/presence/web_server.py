#!/usr/bin/env python3
"""
Web-based Face Registration Server for SkyGlass.

Provides a mobile-friendly web interface for face registration.
Users can access from their phone while standing at the mirror.

Usage:
    python web_server.py [--port 5000] [--camera 0]

Then open http://<pi-ip>:5000 on your phone
"""

import argparse
import io
import json
import os
import pickle
import re
import shutil
import socket
import threading
import time
from pathlib import Path
from typing import Optional

import requests
import secrets

# Try importing optional QR code library
try:
    import qrcode
    QRCODE_AVAILABLE = True
except ImportError:
    QRCODE_AVAILABLE = False

import cv2
import numpy as np
from flask import Flask, Response, jsonify, render_template_string, request

# Check for face_recognition
try:
    import face_recognition
    FR_AVAILABLE = True
except ImportError:
    FR_AVAILABLE = False

FACE_DATA_DIR = Path(__file__).parent / "face_data"
FACE_ENCODING_FILE = FACE_DATA_DIR / "enrolled_face.pkl"
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


# Session configuration for admin portal
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))
app.config['PERMANENT_SESSION_LIFETIME'] = 86400  # 24 hours

# Register admin portal blueprint
try:
    from admin_portal import admin
    app.register_blueprint(admin)
    ADMIN_PORTAL_AVAILABLE = True
except ImportError:
    ADMIN_PORTAL_AVAILABLE = False
    print("Admin portal not available - admin_portal.py not found")

# Configuration
BACKEND_URL = "http://localhost:3001"

# Global state
camera_lock = threading.Lock()
camera: Optional[cv2.VideoCapture] = None
camera_index = 0
registration_state = {
    "active": False,
    "samples_needed": 5,
    "samples_captured": 0,
    "encodings": [],
    "last_frame_faces": [],
    "status": "idle",
    "message": "",
}

# Per-user enrollment state
user_enrollment_state: dict = {
    "active": False,
    "user_id": None,
    "user_name": None,
    "samples_needed": 5,
    "samples_captured": 0,
    "encodings": [],
    "status": "idle",
    "message": "",
}


def notify_backend(endpoint: str, data: dict) -> bool:
    """Notify the main backend about registration state changes."""
    try:
        response = requests.post(f"{BACKEND_URL}/api/registration/{endpoint}", json=data, timeout=2)
        return response.status_code == 200
    except requests.exceptions.RequestException as e:
        print(f"Failed to notify backend: {e}")
        return False


def get_local_ip():
    """Get the local IP address of this machine."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


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


def get_frame():
    """Get a frame from the camera."""
    global camera
    with camera_lock:
        if camera is None or not camera.isOpened():
            return None
        ret, frame = camera.read()
        if not ret:
            return None
        return frame


def detect_faces_haar(frame):
    """Detect faces using Haar cascades."""
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(cascade_path)

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(100, 100),
    )
    return faces


def generate_frames():
    """Generator for MJPEG video stream."""
    face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )

    while True:
        frame = get_frame()
        if frame is None:
            time.sleep(0.1)
            continue

        # Detect faces
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(100, 100)
        )

        # Update global state with face positions
        registration_state["last_frame_faces"] = [
            {"x": int(x), "y": int(y), "w": int(w), "h": int(h)}
            for (x, y, w, h) in faces
        ]

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


# HTML template for the registration page
REGISTRATION_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>SkyGlass Setup</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a2e;
            color: #fff;
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 500px;
            margin: 0 auto;
        }

        h1 {
            text-align: center;
            font-size: 1.5rem;
            font-weight: 300;
            margin-bottom: 20px;
            color: #4ecca3;
        }

        .video-container {
            position: relative;
            width: 100%;
            background: #000;
            border-radius: 12px;
            overflow: hidden;
            margin-bottom: 20px;
        }

        .video-container img {
            width: 100%;
            display: block;
        }

        .status-bar {
            background: rgba(0, 0, 0, 0.8);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            text-align: center;
        }

        .status-message {
            font-size: 1.1rem;
            margin-bottom: 10px;
        }

        .status-message.ready { color: #4ecca3; }
        .status-message.warning { color: #f9a825; }
        .status-message.error { color: #ef5350; }

        .progress-bar {
            background: #333;
            height: 8px;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 10px;
        }

        .progress-fill {
            background: linear-gradient(90deg, #4ecca3, #45b7aa);
            height: 100%;
            transition: width 0.3s ease;
        }

        .btn {
            width: 100%;
            padding: 16px;
            font-size: 1.1rem;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            margin-bottom: 10px;
        }

        .btn-primary {
            background: linear-gradient(135deg, #4ecca3, #45b7aa);
            color: #1a1a2e;
            font-weight: 600;
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(78, 204, 163, 0.4);
        }

        .btn-primary:disabled {
            background: #555;
            color: #999;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }

        .btn-secondary {
            background: transparent;
            color: #fff;
            border: 1px solid #555;
        }

        .btn-capture {
            background: linear-gradient(135deg, #ff6b6b, #ee5a5a);
            color: #fff;
            font-weight: 600;
        }

        .instructions {
            background: rgba(255, 255, 255, 0.05);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }

        .instructions h3 {
            font-size: 0.9rem;
            color: #4ecca3;
            margin-bottom: 10px;
        }

        .instructions ul {
            list-style: none;
            font-size: 0.9rem;
            color: #aaa;
        }

        .instructions li {
            padding: 5px 0;
            padding-left: 20px;
            position: relative;
        }

        .instructions li:before {
            content: "•";
            position: absolute;
            left: 0;
            color: #4ecca3;
        }

        .success-screen {
            text-align: center;
            padding: 40px 20px;
        }

        .success-icon {
            font-size: 4rem;
            margin-bottom: 20px;
        }

        .hidden { display: none; }

        .info-text {
            font-size: 0.85rem;
            color: #666;
            text-align: center;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>SkyGlass Face Setup</h1>

        <div id="setup-screen">
            <div class="video-container">
                <img id="video-stream" src="/video_feed" alt="Camera feed">
            </div>

            <div class="status-bar">
                <div id="status-message" class="status-message">Loading camera...</div>
                <div class="progress-bar">
                    <div id="progress-fill" class="progress-fill" style="width: 0%"></div>
                </div>
            </div>

            <div class="instructions">
                <h3>Instructions</h3>
                <ul>
                    <li>Stand in front of the mirror</li>
                    <li>Position your face in the center box</li>
                    <li>Tap "Capture" when the box turns green</li>
                    <li>Move slightly between captures</li>
                </ul>
            </div>

            <button id="capture-btn" class="btn btn-capture" disabled>
                Capture (0/5)
            </button>

            <button id="start-btn" class="btn btn-primary">
                Start Registration
            </button>

            <button id="reset-btn" class="btn btn-secondary hidden">
                Start Over
            </button>
        </div>

        <div id="success-screen" class="success-screen hidden">
            <div class="success-icon">✓</div>
            <h2>Registration Complete!</h2>
            <p style="color: #aaa; margin: 20px 0;">
                Your face has been registered successfully.<br>
                The mirror will now recognize you.
            </p>
            <button onclick="location.reload()" class="btn btn-primary">
                Done
            </button>
            <button onclick="startOver()" class="btn btn-secondary">
                Register Another Face
            </button>
        </div>

        <p class="info-text" id="fr-status"></p>
    </div>

    <script>
        let isRegistering = false;
        let samplesNeeded = 5;
        let samplesCaptured = 0;
        let canCapture = false;

        const statusMessage = document.getElementById('status-message');
        const progressFill = document.getElementById('progress-fill');
        const captureBtn = document.getElementById('capture-btn');
        const startBtn = document.getElementById('start-btn');
        const resetBtn = document.getElementById('reset-btn');
        const setupScreen = document.getElementById('setup-screen');
        const successScreen = document.getElementById('success-screen');
        const frStatus = document.getElementById('fr-status');

        // Check face_recognition availability
        fetch('/api/status')
            .then(r => r.json())
            .then(data => {
                if (!data.face_recognition_available) {
                    frStatus.textContent = 'Note: face_recognition not installed. Registration will use basic detection.';
                }
            });

        // Poll for face detection status
        function pollStatus() {
            fetch('/api/faces')
                .then(r => r.json())
                .then(data => {
                    const faces = data.faces;

                    if (faces.length === 0) {
                        setStatus('No face detected - move closer', 'warning');
                        canCapture = false;
                    } else if (faces.length > 1) {
                        setStatus('Multiple faces detected', 'error');
                        canCapture = false;
                    } else {
                        // Check if face is centered (based on guide box)
                        const face = faces[0];
                        const frameW = 640, frameH = 480;
                        const centerX = frameW / 2, centerY = frameH / 2;
                        const faceCenterX = face.x + face.w / 2;
                        const faceCenterY = face.y + face.h / 2;
                        const dx = Math.abs(faceCenterX - centerX);
                        const dy = Math.abs(faceCenterY - centerY);

                        if (dx < 80 && dy < 80 && face.w > 120) {
                            setStatus('Ready - Tap Capture!', 'ready');
                            canCapture = true;
                        } else if (face.w < 120) {
                            setStatus('Move closer to camera', 'warning');
                            canCapture = false;
                        } else {
                            setStatus('Center your face in the box', 'warning');
                            canCapture = false;
                        }
                    }

                    captureBtn.disabled = !canCapture || !isRegistering;
                })
                .catch(() => {
                    setStatus('Connection error', 'error');
                });
        }

        function setStatus(message, type) {
            statusMessage.textContent = message;
            statusMessage.className = 'status-message ' + type;
        }

        function updateProgress() {
            const pct = (samplesCaptured / samplesNeeded) * 100;
            progressFill.style.width = pct + '%';
            captureBtn.textContent = `Capture (${samplesCaptured}/${samplesNeeded})`;
        }

        startBtn.addEventListener('click', () => {
            fetch('/api/start', { method: 'POST' })
                .then(r => r.json())
                .then(data => {
                    isRegistering = true;
                    samplesCaptured = 0;
                    updateProgress();
                    startBtn.classList.add('hidden');
                    resetBtn.classList.remove('hidden');
                    setStatus('Position your face in the center box', 'warning');
                });
        });

        captureBtn.addEventListener('click', () => {
            if (!canCapture || !isRegistering) return;

            captureBtn.disabled = true;

            fetch('/api/capture', { method: 'POST' })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        samplesCaptured = data.samples_captured;
                        updateProgress();

                        if (data.complete) {
                            isRegistering = false;
                            setupScreen.classList.add('hidden');
                            successScreen.classList.remove('hidden');
                        } else {
                            setStatus('Great! Move slightly for next capture', 'ready');
                            setTimeout(() => captureBtn.disabled = false, 500);
                        }
                    } else {
                        setStatus(data.message || 'Capture failed, try again', 'error');
                        setTimeout(() => captureBtn.disabled = false, 500);
                    }
                });
        });

        resetBtn.addEventListener('click', startOver);

        function startOver() {
            fetch('/api/reset', { method: 'POST' })
                .then(() => {
                    isRegistering = false;
                    samplesCaptured = 0;
                    updateProgress();
                    startBtn.classList.remove('hidden');
                    resetBtn.classList.add('hidden');
                    setupScreen.classList.remove('hidden');
                    successScreen.classList.add('hidden');
                    setStatus('Tap Start to begin registration', 'warning');
                });
        }

        // Start polling
        setInterval(pollStatus, 200);
        updateProgress();
    </script>
</body>
</html>
"""


@app.route('/')
def index():
    """Serve the registration page."""
    return render_template_string(REGISTRATION_HTML)


@app.route('/video_feed')
def video_feed():
    """MJPEG video stream endpoint."""
    return Response(
        generate_frames(),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )


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
        "qrcode_available": QRCODE_AVAILABLE,
        "yaml_available": YAML_AVAILABLE,
        "admin_portal_available": ADMIN_PORTAL_AVAILABLE,
        "registration_active": registration_state["active"],
        "samples_captured": registration_state["samples_captured"],
        "samples_needed": registration_state["samples_needed"],
        "timestamp": int(time.time() * 1000),
    })


@app.route('/api/faces')
def api_faces():
    """Get current face detection results."""
    return jsonify({
        "faces": registration_state["last_frame_faces"]
    })


@app.route('/api/start', methods=['POST'])
def api_start():
    """Start registration process."""
    registration_state["active"] = True
    registration_state["samples_captured"] = 0
    registration_state["encodings"] = []
    registration_state["status"] = "capturing"
    registration_state["message"] = "Position your face"

    # Notify backend to show registration overlay on mirror
    local_ip = get_local_ip()
    port = request.host.split(':')[1] if ':' in request.host else '5000'
    notify_backend("start", {"presenceServerUrl": f"http://{local_ip}:{port}"})

    return jsonify({"success": True})


@app.route('/api/capture', methods=['POST'])
def api_capture():
    """Capture a face sample."""
    if not registration_state["active"]:
        return jsonify({"success": False, "message": "Registration not active"})

    frame = get_frame()
    if frame is None:
        return jsonify({"success": False, "message": "Camera not available"})

    # Detect faces
    faces = detect_faces_haar(frame)

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

    # If face_recognition available, capture encoding
    if FR_AVAILABLE:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        face_locations = face_recognition.face_locations(rgb)
        if face_locations:
            encodings = face_recognition.face_encodings(rgb, face_locations)
            if encodings:
                registration_state["encodings"].append(encodings[0])

    registration_state["samples_captured"] += 1

    # Notify backend of progress
    notify_backend("progress", {
        "samplesCollected": registration_state["samples_captured"],
        "samplesNeeded": registration_state["samples_needed"],
    })

    # Check if complete
    complete = registration_state["samples_captured"] >= registration_state["samples_needed"]

    if complete:
        # Save the face data
        save_registration()
        registration_state["active"] = False
        # Notify backend of completion
        notify_backend("complete", {})

    return jsonify({
        "success": True,
        "samples_captured": registration_state["samples_captured"],
        "samples_needed": registration_state["samples_needed"],
        "complete": complete,
    })


@app.route('/api/reset', methods=['POST'])
def api_reset():
    """Reset registration process."""
    registration_state["active"] = False
    registration_state["samples_captured"] = 0
    registration_state["encodings"] = []
    registration_state["status"] = "idle"

    # Notify backend to hide registration overlay
    notify_backend("cancel", {})

    return jsonify({"success": True})


def save_registration():
    """Save the registered face data."""
    FACE_DATA_DIR.mkdir(parents=True, exist_ok=True)

    if FR_AVAILABLE and registration_state["encodings"]:
        with open(FACE_ENCODING_FILE, "wb") as f:
            pickle.dump(registration_state["encodings"], f)
        print(f"Saved {len(registration_state['encodings'])} face encodings")
    else:
        # Save a marker file indicating registration completed
        marker_file = FACE_DATA_DIR / "registered.txt"
        with open(marker_file, "w") as f:
            f.write(f"Registered at: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Samples captured: {registration_state['samples_captured']}\n")
        print("Registration marker saved (face_recognition not available)")


def save_user_face_data(user_id: str, user_name: str, encodings: list) -> bool:
    """Save face encodings for a specific user."""
    user_dir = safe_user_dir(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    # Save encodings
    encodings_file = user_dir / "encodings.pkl"
    with open(encodings_file, "wb") as f:
        pickle.dump(encodings, f)

    # Save metadata
    metadata_file = user_dir / "metadata.json"
    metadata = {
        "name": user_name,
        "samples": len(encodings),
        "enrolled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    with open(metadata_file, "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"[Enrollment] Saved {len(encodings)} face encodings for user {user_name} ({user_id})")
    return True


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

@app.route('/api/users/<user_id>/enroll/start', methods=['POST'])
def api_user_enroll_start(user_id: str):
    """Start face enrollment for a specific user."""
    global user_enrollment_state

    data = request.get_json() or {}
    user_name = data.get("name", "Unknown")

    user_enrollment_state = {
        "active": True,
        "user_id": user_id,
        "user_name": user_name,
        "samples_needed": 5,
        "samples_captured": 0,
        "encodings": [],
        "status": "capturing",
        "message": "Position your face",
    }

    # Notify backend to show registration overlay on mirror
    local_ip = get_local_ip()
    port = request.host.split(':')[1] if ':' in request.host else '5000'
    notify_backend("start", {
        "presenceServerUrl": f"http://{local_ip}:{port}",
        "userName": user_name,
    })

    print(f"[Enrollment] Started enrollment for user {user_name} ({user_id})")

    return jsonify({
        "success": True,
        "userId": user_id,
        "userName": user_name,
        "samplesNeeded": user_enrollment_state["samples_needed"],
    })


@app.route('/api/users/<user_id>/enroll/capture', methods=['POST'])
def api_user_enroll_capture(user_id: str):
    """Capture a face sample for a specific user."""
    global user_enrollment_state

    if not user_enrollment_state["active"]:
        return jsonify({"success": False, "message": "Enrollment not active"})

    if user_enrollment_state["user_id"] != user_id:
        return jsonify({"success": False, "message": "Enrollment in progress for different user"})

    frame = get_frame()
    if frame is None:
        return jsonify({"success": False, "message": "Camera not available"})

    # Detect faces
    faces = detect_faces_haar(frame)

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

    # Capture face encoding
    if FR_AVAILABLE:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        face_locations = face_recognition.face_locations(rgb)
        if face_locations:
            encodings = face_recognition.face_encodings(rgb, face_locations)
            if encodings:
                user_enrollment_state["encodings"].append(encodings[0])
            else:
                return jsonify({"success": False, "message": "Could not encode face, try again"})
        else:
            return jsonify({"success": False, "message": "No face found, try again"})
    else:
        return jsonify({"success": False, "message": "face_recognition not available"})

    user_enrollment_state["samples_captured"] += 1

    # Notify backend of progress
    notify_backend("progress", {
        "samplesCollected": user_enrollment_state["samples_captured"],
        "samplesNeeded": user_enrollment_state["samples_needed"],
    })

    # Check if complete
    complete = user_enrollment_state["samples_captured"] >= user_enrollment_state["samples_needed"]

    return jsonify({
        "success": True,
        "samplesCollected": user_enrollment_state["samples_captured"],
        "samplesNeeded": user_enrollment_state["samples_needed"],
        "complete": complete,
    })


@app.route('/api/users/<user_id>/enroll/complete', methods=['POST'])
def api_user_enroll_complete(user_id: str):
    """Complete face enrollment and save encodings for a user."""
    global user_enrollment_state

    if not user_enrollment_state["active"]:
        return jsonify({"success": False, "message": "Enrollment not active"})

    if user_enrollment_state["user_id"] != user_id:
        return jsonify({"success": False, "message": "Enrollment in progress for different user"})

    if not user_enrollment_state["encodings"]:
        return jsonify({"success": False, "message": "No face samples captured"})

    # Save the user's face data
    save_user_face_data(
        user_id,
        user_enrollment_state["user_name"],
        user_enrollment_state["encodings"]
    )

    # Reset enrollment state
    user_enrollment_state = {
        "active": False,
        "user_id": None,
        "user_name": None,
        "samples_needed": 5,
        "samples_captured": 0,
        "encodings": [],
        "status": "idle",
        "message": "",
    }

    # Notify backend of completion
    notify_backend("complete", {})

    return jsonify({
        "success": True,
        "message": "Face enrollment completed",
    })


@app.route('/api/users/<user_id>/enroll/cancel', methods=['POST'])
def api_user_enroll_cancel(user_id: str):
    """Cancel face enrollment for a user."""
    global user_enrollment_state

    if user_enrollment_state["user_id"] == user_id:
        user_enrollment_state = {
            "active": False,
            "user_id": None,
            "user_name": None,
            "samples_needed": 5,
            "samples_captured": 0,
            "encodings": [],
            "status": "idle",
            "message": "",
        }

        # Notify backend to hide registration overlay
        notify_backend("cancel", {})

    return jsonify({"success": True})


@app.route('/api/users/<user_id>/enroll/status', methods=['GET'])
def api_user_enroll_status(user_id: str):
    """Get enrollment status for a user."""
    if user_enrollment_state["user_id"] == user_id:
        return jsonify({
            "active": user_enrollment_state["active"],
            "samplesCollected": user_enrollment_state["samples_captured"],
            "samplesNeeded": user_enrollment_state["samples_needed"],
            "status": user_enrollment_state["status"],
        })
    else:
        # Check if user already has face data
        user_dir = safe_user_dir(user_id)
        has_face_data = (user_dir / "encodings.pkl").exists()
        return jsonify({
            "active": False,
            "enrolled": has_face_data,
            "samplesCollected": 0,
            "samplesNeeded": 5,
        })


@app.route('/api/users/<user_id>/face', methods=['DELETE'])
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


def generate_qr_code(url: str) -> Optional[bytes]:
    """Generate a QR code image for the given URL."""
    if not QRCODE_AVAILABLE:
        return None

    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)

    img = qr.make_image(fill_color="white", back_color="black")

    # Convert to bytes
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    return buffer.getvalue()


@app.route('/qr')
def qr_code():
    """Generate QR code for the setup URL."""
    if not QRCODE_AVAILABLE:
        return "QR code library not installed", 404

    local_ip = get_local_ip()
    port = request.host.split(':')[1] if ':' in request.host else '5000'
    url = f"http://{local_ip}:{port}"

    qr_bytes = generate_qr_code(url)
    if qr_bytes:
        return Response(qr_bytes, mimetype='image/png')
    return "Failed to generate QR code", 500


@app.route('/api/qr-url')
def qr_url():
    """Get the URL that the QR code points to."""
    local_ip = get_local_ip()
    port = request.host.split(':')[1] if ':' in request.host else '5000'
    url = f"http://{local_ip}:{port}"
    return jsonify({"url": url, "ip": local_ip, "port": port})


# ============================================================
# SETTINGS PORTAL
# ============================================================

# Try importing YAML for config management
try:
    import yaml
    YAML_AVAILABLE = True
except ImportError:
    YAML_AVAILABLE = False

import subprocess
import platform

CONFIG_DIR = Path(__file__).parent.parent.parent / "config"
CONFIG_FILE = CONFIG_DIR / "config.yaml"
DEFAULT_CONFIG_FILE = CONFIG_DIR / "default.yaml"


def load_config() -> dict:
    """Load configuration from YAML file."""
    if not YAML_AVAILABLE:
        return {"error": "PyYAML not installed"}

    config_path = CONFIG_FILE if CONFIG_FILE.exists() else DEFAULT_CONFIG_FILE

    if not config_path.exists():
        return {}

    with open(config_path, "r") as f:
        return yaml.safe_load(f) or {}


def save_config(config: dict) -> bool:
    """Save configuration to YAML file."""
    if not YAML_AVAILABLE:
        return False

    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    with open(CONFIG_FILE, "w") as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False)

    return True


def get_system_info() -> dict:
    """Get system information."""
    import shutil

    info = {
        "platform": platform.system(),
        "platform_release": platform.release(),
        "platform_version": platform.version(),
        "architecture": platform.machine(),
        "hostname": platform.node(),
        "python_version": platform.python_version(),
        "local_ip": get_local_ip(),
    }

    # Disk usage
    try:
        total, used, free = shutil.disk_usage("/")
        info["disk_total_gb"] = round(total / (1024**3), 1)
        info["disk_used_gb"] = round(used / (1024**3), 1)
        info["disk_free_gb"] = round(free / (1024**3), 1)
    except Exception:
        pass

    # Check if we're on a Raspberry Pi
    try:
        with open("/proc/device-tree/model", "r") as f:
            info["device_model"] = f.read().strip()
    except Exception:
        info["device_model"] = "Unknown"

    return info


def get_service_status() -> dict:
    """Get status of SkyGlass services."""
    status = {
        "backend": {"running": False, "port": 3001},
        "frontend": {"running": False, "port": 3001},
        "presence": {"running": True, "port": 5000},  # This server
    }

    # Check if backend is running
    try:
        response = requests.get("http://localhost:3001/api/health", timeout=2)
        status["backend"]["running"] = response.status_code == 200
    except Exception:
        pass

    # Check if frontend is running
    try:
        response = requests.get("http://localhost:3001", timeout=2)
        status["frontend"]["running"] = response.status_code == 200
    except Exception:
        pass

    return status


# Settings page HTML
SETTINGS_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SkyGlass Settings</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a2e;
            color: #fff;
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 800px; margin: 0 auto; }
        h1 {
            font-size: 1.8rem;
            font-weight: 300;
            color: #4ecca3;
            margin-bottom: 30px;
            display: flex;
            align-items: center;
            gap: 15px;
        }
        h1 .logo { font-size: 2rem; }
        .nav {
            display: flex;
            gap: 10px;
            margin-bottom: 30px;
            flex-wrap: wrap;
        }
        .nav a {
            padding: 10px 20px;
            background: rgba(255,255,255,0.1);
            color: #fff;
            text-decoration: none;
            border-radius: 6px;
            transition: all 0.2s;
        }
        .nav a:hover, .nav a.active {
            background: #4ecca3;
            color: #1a1a2e;
        }
        .card {
            background: rgba(255,255,255,0.05);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
        }
        .card h2 {
            font-size: 1.1rem;
            font-weight: 500;
            margin-bottom: 15px;
            color: #4ecca3;
        }
        .form-group {
            margin-bottom: 15px;
        }
        .form-group label {
            display: block;
            font-size: 0.85rem;
            color: #aaa;
            margin-bottom: 5px;
        }
        .form-group input, .form-group select {
            width: 100%;
            padding: 10px;
            border: 1px solid #333;
            border-radius: 6px;
            background: #0d0d1a;
            color: #fff;
            font-size: 1rem;
        }
        .form-group input:focus, .form-group select:focus {
            outline: none;
            border-color: #4ecca3;
        }
        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 6px;
            font-size: 1rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-primary {
            background: #4ecca3;
            color: #1a1a2e;
            font-weight: 600;
        }
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(78,204,163,0.3);
        }
        .btn-secondary {
            background: rgba(255,255,255,0.1);
            color: #fff;
        }
        .btn-danger {
            background: #ef5350;
            color: #fff;
        }
        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
        }
        .status-item {
            background: rgba(0,0,0,0.3);
            padding: 15px;
            border-radius: 8px;
            text-align: center;
        }
        .status-item .label {
            font-size: 0.75rem;
            color: #888;
            text-transform: uppercase;
            margin-bottom: 5px;
        }
        .status-item .value {
            font-size: 1.2rem;
            font-weight: 500;
        }
        .status-dot {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            margin-right: 8px;
        }
        .status-dot.online { background: #4ecca3; }
        .status-dot.offline { background: #ef5350; }
        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 15px 25px;
            background: #4ecca3;
            color: #1a1a2e;
            border-radius: 8px;
            font-weight: 500;
            transform: translateY(100px);
            opacity: 0;
            transition: all 0.3s;
        }
        .toast.show {
            transform: translateY(0);
            opacity: 1;
        }
        .toast.error {
            background: #ef5350;
            color: #fff;
        }
        .section { display: none; }
        .section.active { display: block; }
        .info-text {
            font-size: 0.85rem;
            color: #666;
            margin-top: 5px;
        }
        .action-buttons {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1><span class="logo">⚙</span> SkyGlass Settings</h1>

        <nav class="nav">
            <a href="#" data-section="general" class="active">General</a>
            <a href="#" data-section="display">Display</a>
            <a href="#" data-section="aviation">Aviation</a>
            <a href="#" data-section="presence">Presence</a>
            <a href="#" data-section="system">System</a>
        </nav>

        <!-- General Settings -->
        <div id="general" class="section active">
            <div class="card">
                <h2>General Settings</h2>
                <div class="form-group">
                    <label>Primary Airport (ICAO)</label>
                    <input type="text" id="airport" placeholder="KJFK" maxlength="4">
                    <p class="info-text">4-letter ICAO code for METAR/TAF data</p>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Latitude</label>
                        <input type="number" id="latitude" step="0.0001" placeholder="40.6413">
                    </div>
                    <div class="form-group">
                        <label>Longitude</label>
                        <input type="number" id="longitude" step="0.0001" placeholder="-73.7781">
                    </div>
                </div>
                <div class="form-group">
                    <label>Timezone</label>
                    <input type="text" id="timezone" placeholder="America/New_York">
                </div>
            </div>
        </div>

        <!-- Display Settings -->
        <div id="display" class="section">
            <div class="card">
                <h2>Display Settings</h2>
                <div class="form-group">
                    <label>Presence Timeout (seconds)</label>
                    <input type="number" id="presence_timeout" min="10" max="600" placeholder="120">
                    <p class="info-text">Time before display sleeps after you leave</p>
                </div>
                <div class="form-group">
                    <label>Fade Duration (ms)</label>
                    <input type="number" id="fade_duration" min="0" max="5000" placeholder="1000">
                </div>
                <div class="form-group">
                    <label>Brightness (%)</label>
                    <input type="range" id="brightness" min="10" max="100" value="80">
                    <span id="brightness_value">80%</span>
                </div>
            </div>
        </div>

        <!-- Aviation Settings -->
        <div id="aviation" class="section">
            <div class="card">
                <h2>Aviation Data</h2>
                <div class="form-group">
                    <label>FAA NOTAM API Key</label>
                    <input type="password" id="notam_api_key" placeholder="Enter API key">
                    <p class="info-text">Get your free key from api.faa.gov</p>
                </div>
                <div class="form-group">
                    <label>TFR Radius (nm)</label>
                    <input type="number" id="tfr_radius" min="25" max="500" placeholder="100">
                    <p class="info-text">Show TFRs within this distance</p>
                </div>
            </div>
        </div>

        <!-- Presence Settings -->
        <div id="presence" class="section">
            <div class="card">
                <h2>Presence Detection</h2>
                <div class="form-group">
                    <label>Camera Index</label>
                    <input type="number" id="camera_index" min="0" max="10" placeholder="0">
                    <p class="info-text">0 = default camera</p>
                </div>
                <div class="form-group">
                    <label>Detection Method</label>
                    <select id="detection_method">
                        <option value="face">Face Detection</option>
                        <option value="motion">Motion Detection</option>
                        <option value="hybrid">Hybrid (Motion + Face)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Face Match Tolerance</label>
                    <input type="range" id="tolerance" min="0.3" max="0.9" step="0.05" value="0.6">
                    <span id="tolerance_value">0.6</span>
                    <p class="info-text">Lower = stricter matching</p>
                </div>
            </div>

            <div class="card">
                <h2>Face Registration</h2>
                <p style="color: #aaa; margin-bottom: 15px;">
                    Register or re-register your face for presence detection.
                </p>
                <a href="/" class="btn btn-primary">Open Registration</a>
            </div>
        </div>

        <!-- System Settings -->
        <div id="system" class="section">
            <div class="card">
                <h2>System Status</h2>
                <div class="status-grid" id="system-status">
                    <div class="status-item">
                        <div class="label">Backend</div>
                        <div class="value" id="backend-status">
                            <span class="status-dot offline"></span>Checking...
                        </div>
                    </div>
                    <div class="status-item">
                        <div class="label">Frontend</div>
                        <div class="value" id="frontend-status">
                            <span class="status-dot offline"></span>Checking...
                        </div>
                    </div>
                    <div class="status-item">
                        <div class="label">Presence</div>
                        <div class="value" id="presence-status">
                            <span class="status-dot online"></span>Running
                        </div>
                    </div>
                </div>
            </div>

            <div class="card">
                <h2>System Info</h2>
                <div class="status-grid" id="system-info">
                    <div class="status-item">
                        <div class="label">IP Address</div>
                        <div class="value" id="ip-address">-</div>
                    </div>
                    <div class="status-item">
                        <div class="label">Platform</div>
                        <div class="value" id="platform">-</div>
                    </div>
                    <div class="status-item">
                        <div class="label">Disk Free</div>
                        <div class="value" id="disk-free">-</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <h2>Actions</h2>
                <div class="action-buttons">
                    <button class="btn btn-secondary" onclick="restartServices()">Restart Services</button>
                    <button class="btn btn-secondary" onclick="clearCache()">Clear Cache</button>
                    <button class="btn btn-danger" onclick="rebootSystem()">Reboot System</button>
                </div>
            </div>
        </div>

        <!-- Save Button -->
        <div style="margin-top: 30px; display: flex; gap: 15px;">
            <button class="btn btn-primary" onclick="saveSettings()">Save Settings</button>
            <button class="btn btn-secondary" onclick="loadSettings()">Reset</button>
        </div>
    </div>

    <div id="toast" class="toast"></div>

    <script>
        let config = {};

        // Navigation
        document.querySelectorAll('.nav a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = e.target.dataset.section;

                document.querySelectorAll('.nav a').forEach(l => l.classList.remove('active'));
                e.target.classList.add('active');

                document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
                document.getElementById(section).classList.add('active');
            });
        });

        // Toast notifications
        function showToast(message, isError = false) {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.className = 'toast show' + (isError ? ' error' : '');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        // Load settings from server
        async function loadSettings() {
            try {
                const response = await fetch('/api/settings');
                config = await response.json();

                // Populate form fields
                document.getElementById('airport').value = config.airport || '';
                document.getElementById('latitude').value = config.location?.latitude || '';
                document.getElementById('longitude').value = config.location?.longitude || '';
                document.getElementById('timezone').value = config.location?.timezone || '';

                document.getElementById('presence_timeout').value = config.display?.presence_timeout || 120;
                document.getElementById('fade_duration').value = config.display?.fade_duration || 1000;
                document.getElementById('brightness').value = config.display?.brightness || 80;
                document.getElementById('brightness_value').textContent = (config.display?.brightness || 80) + '%';

                document.getElementById('notam_api_key').value = config.notam_api_key || '';

                document.getElementById('camera_index').value = config.presence?.camera_index || 0;
                document.getElementById('detection_method').value = config.presence?.detection_method || 'face';
                document.getElementById('tolerance').value = config.presence?.tolerance || 0.6;
                document.getElementById('tolerance_value').textContent = config.presence?.tolerance || 0.6;

                // Find TFR radius from widgets
                const tfrWidget = config.widgets?.find(w => w.type === 'tfr');
                document.getElementById('tfr_radius').value = tfrWidget?.radius_nm || 100;

            } catch (error) {
                showToast('Failed to load settings', true);
            }
        }

        // Save settings to server
        async function saveSettings() {
            try {
                // Build config object
                config.airport = document.getElementById('airport').value.toUpperCase();
                config.location = {
                    latitude: parseFloat(document.getElementById('latitude').value),
                    longitude: parseFloat(document.getElementById('longitude').value),
                    timezone: document.getElementById('timezone').value,
                };
                config.display = {
                    presence_timeout: parseInt(document.getElementById('presence_timeout').value),
                    fade_duration: parseInt(document.getElementById('fade_duration').value),
                    brightness: parseInt(document.getElementById('brightness').value),
                };
                config.presence = {
                    camera_index: parseInt(document.getElementById('camera_index').value),
                    detection_method: document.getElementById('detection_method').value,
                    tolerance: parseFloat(document.getElementById('tolerance').value),
                    min_detection_frames: config.presence?.min_detection_frames || 3,
                    timeout: config.presence?.timeout || 5,
                };

                const notamKey = document.getElementById('notam_api_key').value;
                if (notamKey && !notamKey.startsWith('$')) {
                    config.notam_api_key = notamKey;
                }

                // Update TFR widget radius
                if (config.widgets) {
                    const tfrWidget = config.widgets.find(w => w.type === 'tfr');
                    if (tfrWidget) {
                        tfrWidget.radius_nm = parseInt(document.getElementById('tfr_radius').value);
                    }
                }

                const response = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config),
                });

                if (response.ok) {
                    showToast('Settings saved successfully');
                } else {
                    throw new Error('Save failed');
                }
            } catch (error) {
                showToast('Failed to save settings', true);
            }
        }

        // Load system status
        async function loadSystemStatus() {
            try {
                const [statusRes, infoRes] = await Promise.all([
                    fetch('/api/settings/status'),
                    fetch('/api/settings/system'),
                ]);

                const status = await statusRes.json();
                const info = await infoRes.json();

                // Update status indicators
                updateStatus('backend-status', status.backend?.running, 'Backend');
                updateStatus('frontend-status', status.frontend?.running, 'Frontend');

                // Update system info
                document.getElementById('ip-address').textContent = info.local_ip || '-';
                document.getElementById('platform').textContent = info.platform || '-';
                document.getElementById('disk-free').textContent = info.disk_free_gb ? `${info.disk_free_gb} GB` : '-';

            } catch (error) {
                console.error('Failed to load system status:', error);
            }
        }

        function updateStatus(elementId, isRunning, label) {
            const el = document.getElementById(elementId);
            const dotClass = isRunning ? 'online' : 'offline';
            const statusText = isRunning ? 'Running' : 'Stopped';
            el.innerHTML = `<span class="status-dot ${dotClass}"></span>${statusText}`;
        }

        // System actions
        async function restartServices() {
            if (!confirm('Restart all SkyGlass services?')) return;
            try {
                await fetch('/api/settings/restart', { method: 'POST' });
                showToast('Restart initiated');
            } catch (error) {
                showToast('Failed to restart', true);
            }
        }

        async function clearCache() {
            if (!confirm('Clear all cached data?')) return;
            try {
                await fetch('/api/settings/clear-cache', { method: 'POST' });
                showToast('Cache cleared');
            } catch (error) {
                showToast('Failed to clear cache', true);
            }
        }

        async function rebootSystem() {
            if (!confirm('Reboot the system? This will temporarily stop the mirror.')) return;
            try {
                await fetch('/api/settings/reboot', { method: 'POST' });
                showToast('Rebooting...');
            } catch (error) {
                showToast('Failed to reboot', true);
            }
        }

        // Range input live updates
        document.getElementById('brightness').addEventListener('input', (e) => {
            document.getElementById('brightness_value').textContent = e.target.value + '%';
        });
        document.getElementById('tolerance').addEventListener('input', (e) => {
            document.getElementById('tolerance_value').textContent = e.target.value;
        });

        // Initial load
        loadSettings();
        loadSystemStatus();
        setInterval(loadSystemStatus, 10000);
    </script>
</body>
</html>
"""


@app.route('/settings')
def settings_page():
    """Serve the settings page."""
    return render_template_string(SETTINGS_HTML)


@app.route('/api/settings', methods=['GET'])
def get_settings():
    """Get current configuration."""
    return jsonify(load_config())


@app.route('/api/settings', methods=['POST'])
def save_settings():
    """Save configuration."""
    try:
        config = request.get_json()
        if save_config(config):
            # Notify backend about config change
            try:
                requests.post(f"{BACKEND_URL}/api/config/reload", timeout=2)
            except Exception:
                pass
            return jsonify({"success": True})
        return jsonify({"success": False, "error": "Failed to save"}), 500
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/settings/status')
def settings_status():
    """Get service status."""
    return jsonify(get_service_status())


@app.route('/api/settings/system')
def settings_system():
    """Get system information."""
    return jsonify(get_system_info())


@app.route('/api/settings/restart', methods=['POST'])
def settings_restart():
    """Restart SkyGlass services."""
    try:
        # Try PM2 first
        subprocess.run(["pm2", "restart", "all"], capture_output=True, timeout=10)
        return jsonify({"success": True})
    except Exception:
        try:
            # Fallback: notify backend to trigger restart
            requests.post(f"{BACKEND_URL}/api/update/apply", timeout=2)
            return jsonify({"success": True})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/settings/clear-cache', methods=['POST'])
def settings_clear_cache():
    """Clear cached data."""
    try:
        # Notify backend to clear cache
        requests.post(f"{BACKEND_URL}/api/cache/clear", timeout=2)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/settings/reboot', methods=['POST'])
def settings_reboot():
    """Reboot the system."""
    try:
        if platform.system() == "Linux":
            subprocess.Popen(["sudo", "reboot"])
            return jsonify({"success": True})
        else:
            return jsonify({"success": False, "error": "Reboot only supported on Linux"}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


def main():
    parser = argparse.ArgumentParser(description="SkyGlass Face Registration Server")
    parser.add_argument("--port", "-p", type=int, default=5000, help="Port to run on (default: 5000)")
    parser.add_argument("--camera", "-c", type=int, default=0, help="Camera index (default: 0)")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to (default: 0.0.0.0)")

    args = parser.parse_args()

    # Initialize camera
    if not init_camera(args.camera):
        print("Failed to initialize camera. Exiting.")
        return

    local_ip = get_local_ip()
    print()
    print("=" * 60)
    print("  SkyGlass Setup & Settings Server")
    print("=" * 60)
    print()
    if ADMIN_PORTAL_AVAILABLE:
        print(f"  Admin Portal: http://{local_ip}:{args.port}/admin")
    print(f"  Registration: http://{local_ip}:{args.port}")
    print(f"  Settings:     http://{local_ip}:{args.port}/settings")
    print(f"  QR Code:      http://{local_ip}:{args.port}/qr")
    print()
    if ADMIN_PORTAL_AVAILABLE:
        print("  The Admin Portal provides a polished dashboard with:")
        print("    - System status monitoring")
        print("    - WiFi configuration (on Raspberry Pi)")
        print("    - Log viewer")
        print("    - Software updates")
        print("    - Password protection")
        print()
    print("  Open Settings to configure the mirror without a keyboard.")
    print("  Open Registration to set up face detection.")
    print()
    if not FR_AVAILABLE:
        print("  NOTE: face_recognition not installed.")
        print("        Registration will work but without face encoding.")
        print()
    if not YAML_AVAILABLE:
        print("  NOTE: PyYAML not installed. Settings will be read-only.")
        print("        Install with: pip install pyyaml")
        print()
    print("=" * 60)
    print()

    try:
        app.run(host=args.host, port=args.port, threaded=True)
    finally:
        release_camera()


if __name__ == "__main__":
    main()
