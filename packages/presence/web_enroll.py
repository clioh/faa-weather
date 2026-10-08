#!/usr/bin/env python3
"""
Web-based face enrollment for SkyGlass.
Provides a browser-based UI for enrolling your face.
"""

import io
import os
import pickle
import time
from pathlib import Path
from threading import Thread, Lock

from flask import Flask, Response, jsonify, render_template_string, request

# Conditional imports
try:
    import cv2
    import numpy as np
    CV_AVAILABLE = True
except ImportError:
    CV_AVAILABLE = False

try:
    import face_recognition
    FR_AVAILABLE = True
except ImportError:
    FR_AVAILABLE = False

FACE_DATA_DIR = Path(__file__).parent / "face_data"
FACE_ENCODING_FILE = FACE_DATA_DIR / "enrolled_face.pkl"

app = Flask(__name__)

# Global state
camera = None
camera_lock = Lock()
current_frame = None
face_locations = []
enrolled_encodings = []
capture_requested = False
captured_count = 0
target_samples = 5

# HTML template for enrollment UI
ENROLLMENT_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SkyGlass - Face Enrollment</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 40px 20px;
            color: #fff;
        }
        h1 {
            font-size: 2rem;
            margin-bottom: 10px;
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .subtitle {
            color: #888;
            margin-bottom: 30px;
        }
        .container {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 20px;
            padding: 30px;
            max-width: 700px;
            width: 100%;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .video-container {
            position: relative;
            width: 100%;
            border-radius: 12px;
            overflow: hidden;
            background: #000;
        }
        #video-feed {
            width: 100%;
            display: block;
        }
        .overlay {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 200px;
            height: 260px;
            border: 3px dashed rgba(0, 217, 255, 0.5);
            border-radius: 50% 50% 45% 45%;
            pointer-events: none;
        }
        .status-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 20px;
            padding: 15px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 10px;
        }
        .status {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .status-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #666;
        }
        .status-dot.detecting {
            background: #00d9ff;
            animation: pulse 1s infinite;
        }
        .status-dot.ready {
            background: #00ff88;
        }
        .status-dot.error {
            background: #ff4444;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .progress {
            display: flex;
            gap: 8px;
        }
        .progress-dot {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.2);
            transition: all 0.3s ease;
        }
        .progress-dot.filled {
            background: #00ff88;
            box-shadow: 0 0 10px #00ff88;
        }
        .controls {
            display: flex;
            gap: 15px;
            margin-top: 25px;
        }
        button {
            flex: 1;
            padding: 15px 25px;
            border: none;
            border-radius: 10px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        .btn-capture {
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            color: #1a1a2e;
        }
        .btn-capture:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(0, 217, 255, 0.4);
        }
        .btn-capture:disabled {
            background: #444;
            color: #888;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
        .btn-reset {
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .btn-reset:hover {
            background: rgba(255, 255, 255, 0.2);
        }
        .instructions {
            margin-top: 25px;
            padding: 20px;
            background: rgba(0, 217, 255, 0.1);
            border-radius: 10px;
            border-left: 4px solid #00d9ff;
        }
        .instructions h3 {
            color: #00d9ff;
            margin-bottom: 10px;
        }
        .instructions ol {
            margin-left: 20px;
            line-height: 1.8;
            color: #ccc;
        }
        .success-message {
            display: none;
            text-align: center;
            padding: 40px;
        }
        .success-message.show {
            display: block;
        }
        .success-icon {
            font-size: 4rem;
            margin-bottom: 20px;
        }
        .success-message h2 {
            color: #00ff88;
            margin-bottom: 15px;
        }
        .success-message p {
            color: #888;
            margin-bottom: 25px;
        }
        .hidden {
            display: none !important;
        }
    </style>
</head>
<body>
    <h1>SkyGlass</h1>
    <p class="subtitle">Face Enrollment</p>

    <div class="container" id="enrollment-container">
        <div class="video-container">
            <img id="video-feed" src="/video_feed" alt="Camera feed">
            <div class="overlay"></div>
        </div>

        <div class="status-bar">
            <div class="status">
                <div class="status-dot" id="status-dot"></div>
                <span id="status-text">Initializing camera...</span>
            </div>
            <div class="progress" id="progress">
                <!-- Progress dots added by JS -->
            </div>
        </div>

        <div class="controls">
            <button class="btn-capture" id="capture-btn" disabled>
                Capture Sample
            </button>
            <button class="btn-reset" id="reset-btn">
                Start Over
            </button>
        </div>

        <div class="instructions">
            <h3>Instructions</h3>
            <ol>
                <li>Position your face within the oval guide</li>
                <li>Ensure good lighting on your face</li>
                <li>Click "Capture Sample" when a green box appears</li>
                <li>Slightly move your head between captures (look left, right, up)</li>
                <li>Capture 5 samples for best recognition accuracy</li>
            </ol>
        </div>
    </div>

    <div class="container success-message" id="success-container">
        <div class="success-icon">&#10004;</div>
        <h2>Enrollment Complete!</h2>
        <p>Your face has been enrolled successfully. The mirror will now recognize you.</p>
        <button class="btn-capture" onclick="window.location.href='/'">
            Return to Mirror
        </button>
    </div>

    <script>
        const targetSamples = {{ target_samples }};
        let capturedCount = 0;
        let faceDetected = false;

        // Create progress dots
        const progressContainer = document.getElementById('progress');
        for (let i = 0; i < targetSamples; i++) {
            const dot = document.createElement('div');
            dot.className = 'progress-dot';
            dot.id = `progress-${i}`;
            progressContainer.appendChild(dot);
        }

        // Poll for status
        async function updateStatus() {
            try {
                const response = await fetch('/status');
                const data = await response.json();

                faceDetected = data.face_detected;
                capturedCount = data.captured_count;

                const statusDot = document.getElementById('status-dot');
                const statusText = document.getElementById('status-text');
                const captureBtn = document.getElementById('capture-btn');

                if (!data.camera_ready) {
                    statusDot.className = 'status-dot error';
                    statusText.textContent = 'Camera not available';
                    captureBtn.disabled = true;
                } else if (data.face_detected) {
                    statusDot.className = 'status-dot ready';
                    statusText.textContent = 'Face detected - Ready to capture!';
                    captureBtn.disabled = false;
                } else {
                    statusDot.className = 'status-dot detecting';
                    statusText.textContent = 'Looking for face...';
                    captureBtn.disabled = true;
                }

                // Update progress dots
                for (let i = 0; i < targetSamples; i++) {
                    const dot = document.getElementById(`progress-${i}`);
                    if (i < capturedCount) {
                        dot.classList.add('filled');
                    } else {
                        dot.classList.remove('filled');
                    }
                }

                // Check if enrollment complete
                if (data.enrollment_complete) {
                    document.getElementById('enrollment-container').classList.add('hidden');
                    document.getElementById('success-container').classList.add('show');
                }

            } catch (err) {
                console.error('Status update failed:', err);
            }
        }

        // Capture button click
        document.getElementById('capture-btn').addEventListener('click', async () => {
            const btn = document.getElementById('capture-btn');
            btn.disabled = true;
            btn.textContent = 'Capturing...';

            try {
                const response = await fetch('/capture', { method: 'POST' });
                const data = await response.json();

                if (data.success) {
                    // Visual feedback
                    const video = document.getElementById('video-feed');
                    video.style.filter = 'brightness(2)';
                    setTimeout(() => {
                        video.style.filter = '';
                    }, 200);
                }
            } catch (err) {
                console.error('Capture failed:', err);
            }

            btn.textContent = 'Capture Sample';
        });

        // Reset button click
        document.getElementById('reset-btn').addEventListener('click', async () => {
            if (confirm('This will clear all captured samples. Continue?')) {
                try {
                    await fetch('/reset', { method: 'POST' });
                    capturedCount = 0;
                    for (let i = 0; i < targetSamples; i++) {
                        document.getElementById(`progress-${i}`).classList.remove('filled');
                    }
                } catch (err) {
                    console.error('Reset failed:', err);
                }
            }
        });

        // Start status polling
        setInterval(updateStatus, 500);
        updateStatus();
    </script>
</body>
</html>
"""


def generate_frames():
    """Generate MJPEG frames from camera."""
    global current_frame, face_locations

    while True:
        with camera_lock:
            if current_frame is None:
                # Generate a placeholder frame
                placeholder = np.zeros((480, 640, 3), dtype=np.uint8)
                cv2.putText(placeholder, "Initializing camera...", (150, 240),
                           cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
                _, buffer = cv2.imencode('.jpg', placeholder)
                frame_bytes = buffer.tobytes()
            else:
                # Draw face rectangles on frame
                display_frame = current_frame.copy()
                for (top, right, bottom, left) in face_locations:
                    cv2.rectangle(display_frame, (left, top), (right, bottom), (0, 255, 0), 2)

                _, buffer = cv2.imencode('.jpg', display_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                frame_bytes = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

        time.sleep(0.033)  # ~30 FPS


def camera_thread():
    """Background thread for camera capture and face detection."""
    global camera, current_frame, face_locations

    camera = cv2.VideoCapture(0)
    camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    if not camera.isOpened():
        print("Failed to open camera")
        return

    print("Camera opened successfully")
    frame_count = 0

    while True:
        ret, frame = camera.read()
        if not ret:
            time.sleep(0.1)
            continue

        with camera_lock:
            current_frame = frame.copy()

        # Detect faces every 3rd frame for performance
        frame_count += 1
        if frame_count % 3 == 0 and FR_AVAILABLE:
            small_frame = cv2.resize(frame, (0, 0), fx=0.5, fy=0.5)
            rgb_frame = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)
            locations = face_recognition.face_locations(rgb_frame)
            # Scale back to original size
            face_locations = [(int(t*2), int(r*2), int(b*2), int(l*2))
                             for (t, r, b, l) in locations]

        time.sleep(0.033)


@app.route('/')
def index():
    """Serve the enrollment UI."""
    return render_template_string(ENROLLMENT_HTML, target_samples=target_samples)


@app.route('/video_feed')
def video_feed():
    """MJPEG video stream."""
    return Response(generate_frames(),
                   mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/status')
def status():
    """Get current enrollment status."""
    return jsonify({
        'camera_ready': camera is not None and camera.isOpened(),
        'face_detected': len(face_locations) == 1,
        'multiple_faces': len(face_locations) > 1,
        'captured_count': captured_count,
        'target_samples': target_samples,
        'enrollment_complete': captured_count >= target_samples,
    })


@app.route('/capture', methods=['POST'])
def capture():
    """Capture a face sample."""
    global enrolled_encodings, captured_count

    if len(face_locations) != 1:
        return jsonify({'success': False, 'error': 'No single face detected'})

    with camera_lock:
        if current_frame is None:
            return jsonify({'success': False, 'error': 'No frame available'})

        # Get face encoding
        rgb_frame = cv2.cvtColor(current_frame, cv2.COLOR_BGR2RGB)
        encodings = face_recognition.face_encodings(rgb_frame, face_locations)

        if not encodings:
            return jsonify({'success': False, 'error': 'Could not encode face'})

        enrolled_encodings.append(encodings[0])
        captured_count += 1

        print(f"Captured sample {captured_count}/{target_samples}")

        # Save if we have enough samples
        if captured_count >= target_samples:
            save_encodings()

        return jsonify({
            'success': True,
            'captured_count': captured_count,
            'complete': captured_count >= target_samples,
        })


@app.route('/reset', methods=['POST'])
def reset():
    """Reset enrollment progress."""
    global enrolled_encodings, captured_count

    enrolled_encodings = []
    captured_count = 0

    return jsonify({'success': True})


def save_encodings():
    """Save face encodings to file."""
    FACE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(FACE_ENCODING_FILE, 'wb') as f:
        pickle.dump(enrolled_encodings, f)
    print(f"Saved {len(enrolled_encodings)} face encodings to {FACE_ENCODING_FILE}")


def main():
    """Run the web enrollment server."""
    if not CV_AVAILABLE:
        print("Error: OpenCV not available")
        print("Install with: pip install opencv-python")
        return

    if not FR_AVAILABLE:
        print("Error: face_recognition not available")
        print("Install with: pip install face_recognition")
        return

    print("Starting face enrollment server...")
    print("Open http://localhost:5050 in your browser")
    print()

    # Start camera thread
    cam_thread = Thread(target=camera_thread, daemon=True)
    cam_thread.start()

    # Give camera time to initialize
    time.sleep(1)

    # Run Flask app
    app.run(host='0.0.0.0', port=5050, threaded=True)


if __name__ == '__main__':
    main()
