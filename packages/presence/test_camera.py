#!/usr/bin/env python3
"""
Camera and Face Detection Test Script for SkyGlass.

Tests camera functionality, face detection, and provides an interactive
walkthrough for user registration.

Usage:
    python test_camera.py              # Basic camera test
    python test_camera.py --faces      # Camera test with face detection
    python test_camera.py --register   # Full registration walkthrough
"""

import argparse
import os
import pickle
import sys
import time
from pathlib import Path

import cv2
import numpy as np

FACE_DATA_DIR = Path(__file__).parent / "face_data"
FACE_ENCODING_FILE = FACE_DATA_DIR / "enrolled_face.pkl"


def get_camera_info(cap):
    """Get camera properties."""
    return {
        "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        "fps": cap.get(cv2.CAP_PROP_FPS),
        "backend": cap.getBackendName(),
    }


def draw_text(frame, text, pos, color=(255, 255, 255), scale=0.6, thickness=1):
    """Draw text with a shadow for better visibility."""
    x, y = pos
    # Shadow
    cv2.putText(frame, text, (x + 1, y + 1), cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), thickness + 1)
    # Main text
    cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness)


def test_camera_basic(camera_index=0):
    """Basic camera test - just shows the feed."""
    print(f"Testing camera {camera_index}...")

    cap = cv2.VideoCapture(camera_index)

    if not cap.isOpened():
        print(f"ERROR: Could not open camera {camera_index}")
        print("Try granting camera permission in System Settings > Privacy & Security > Camera")
        return False

    info = get_camera_info(cap)
    print(f"Camera opened successfully!")
    print(f"  Resolution: {info['width']}x{info['height']}")
    print(f"  FPS: {info['fps']}")
    print(f"  Backend: {info['backend']}")
    print()
    print("Controls:")
    print("  q - Quit")
    print("  s - Save snapshot")
    print()

    frame_count = 0
    start_time = time.time()

    while True:
        ret, frame = cap.read()
        if not ret:
            print("Failed to read frame")
            break

        frame_count += 1
        elapsed = time.time() - start_time
        actual_fps = frame_count / elapsed if elapsed > 0 else 0

        # Add overlay
        draw_text(frame, f"Frame: {frame_count}", (10, 30), (0, 255, 0))
        draw_text(frame, f"FPS: {actual_fps:.1f}", (10, 55), (0, 255, 0))
        draw_text(frame, "Press 'q' to quit, 's' to save", (10, 80), (200, 200, 200), 0.5)

        cv2.imshow("Camera Test", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("s"):
            filename = f"snapshot_{frame_count}.jpg"
            cv2.imwrite(filename, frame)
            print(f"Saved {filename}")

    cap.release()
    cv2.destroyAllWindows()
    print(f"Test complete. Captured {frame_count} frames in {elapsed:.1f}s ({actual_fps:.1f} FPS)")
    return True


def test_camera_with_faces(camera_index=0):
    """Camera test with face detection using Haar cascades."""
    print(f"Testing camera {camera_index} with face detection...")

    cap = cv2.VideoCapture(camera_index)

    if not cap.isOpened():
        print(f"ERROR: Could not open camera {camera_index}")
        return False

    info = get_camera_info(cap)
    print(f"Camera opened: {info['width']}x{info['height']} @ {info['fps']} FPS")

    # Load Haar cascade for face detection
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(cascade_path)

    # Also load eye cascade for additional info
    eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")

    print()
    print("Controls:")
    print("  q - Quit")
    print("  s - Save snapshot")
    print("  r - Start registration mode")
    print()

    frame_count = 0
    start_time = time.time()
    faces_detected_total = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            print("Failed to read frame")
            break

        frame_count += 1
        elapsed = time.time() - start_time
        actual_fps = frame_count / elapsed if elapsed > 0 else 0

        # Convert to grayscale for face detection
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Detect faces
        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(80, 80),
        )

        num_faces = len(faces)
        if num_faces > 0:
            faces_detected_total += 1

        # Draw bounding boxes and info for each face
        for i, (x, y, w, h) in enumerate(faces):
            # Main face rectangle
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)

            # Face label
            label = f"Face {i + 1}"
            draw_text(frame, label, (x, y - 10), (0, 255, 0))

            # Face dimensions
            draw_text(frame, f"{w}x{h}px", (x, y + h + 20), (200, 200, 200), 0.4)

            # Detect eyes within face region
            face_roi_gray = gray[y : y + h, x : x + w]
            face_roi_color = frame[y : y + h, x : x + w]
            eyes = eye_cascade.detectMultiScale(face_roi_gray)

            for ex, ey, ew, eh in eyes:
                # Draw eye circles
                eye_center = (x + ex + ew // 2, y + ey + eh // 2)
                cv2.circle(frame, eye_center, max(ew, eh) // 3, (255, 0, 255), 2)

            # Show eye count
            draw_text(frame, f"Eyes: {len(eyes)}", (x, y + h + 35), (255, 0, 255), 0.4)

            # Calculate face position in frame (for guidance)
            frame_center_x = frame.shape[1] // 2
            frame_center_y = frame.shape[0] // 2
            face_center_x = x + w // 2
            face_center_y = y + h // 2

            # Show centering guidance
            dx = face_center_x - frame_center_x
            dy = face_center_y - frame_center_y

            if abs(dx) < 50 and abs(dy) < 50:
                position_text = "CENTERED"
                position_color = (0, 255, 0)
            else:
                hints = []
                if dx < -50:
                    hints.append("Move right")
                elif dx > 50:
                    hints.append("Move left")
                if dy < -50:
                    hints.append("Move down")
                elif dy > 50:
                    hints.append("Move up")
                position_text = ", ".join(hints)
                position_color = (0, 165, 255)

            draw_text(frame, position_text, (x, y + h + 50), position_color, 0.4)

        # Status bar at top
        status_color = (0, 255, 0) if num_faces > 0 else (0, 0, 255)
        status_text = f"Faces: {num_faces}" if num_faces > 0 else "No face detected"
        draw_text(frame, status_text, (10, 30), status_color)
        draw_text(frame, f"FPS: {actual_fps:.1f}", (10, 55), (200, 200, 200), 0.5)

        # Help text at bottom
        h, w = frame.shape[:2]
        draw_text(frame, "q=quit  s=save  r=register", (10, h - 10), (150, 150, 150), 0.4)

        cv2.imshow("Face Detection Test", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("s"):
            filename = f"face_snapshot_{frame_count}.jpg"
            cv2.imwrite(filename, frame)
            print(f"Saved {filename}")
        elif key == ord("r"):
            cap.release()
            cv2.destroyAllWindows()
            return registration_walkthrough(camera_index)

    cap.release()
    cv2.destroyAllWindows()

    detection_rate = (faces_detected_total / frame_count * 100) if frame_count > 0 else 0
    print(f"Test complete. Face detection rate: {detection_rate:.1f}%")
    return True


def registration_walkthrough(camera_index=0):
    """Interactive walkthrough for face registration."""
    print()
    print("=" * 60)
    print("  FACE REGISTRATION WALKTHROUGH")
    print("=" * 60)
    print()
    print("This will guide you through registering your face for")
    print("the SkyGlass presence detection system.")
    print()

    # Check if face_recognition is available
    try:
        import face_recognition

        fr_available = True
        print("face_recognition library: AVAILABLE")
    except ImportError:
        fr_available = False
        print("face_recognition library: NOT INSTALLED")
        print()
        print("To enable full face recognition, install with:")
        print("  pip install face_recognition")
        print()
        print("Continuing with basic face detection demo...")
        print()

    print("Controls during capture:")
    print("  SPACE - Capture sample (when face is centered)")
    print("  q     - Cancel and exit")
    print()
    input("Press ENTER to start camera...")

    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        print("ERROR: Could not open camera")
        return False

    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(cascade_path)

    samples_needed = 5
    samples_captured = 0
    encodings = []

    print()
    print(f"Capturing {samples_needed} face samples...")
    print("Please look at the camera and move slightly between captures.")
    print()

    while samples_captured < samples_needed:
        ret, frame = cap.read()
        if not ret:
            continue

        h, w = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Detect faces
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(100, 100))

        # Draw center guide
        center_x, center_y = w // 2, h // 2
        guide_size = 150
        cv2.rectangle(
            frame,
            (center_x - guide_size, center_y - guide_size),
            (center_x + guide_size, center_y + guide_size),
            (100, 100, 100),
            2,
        )

        ready_to_capture = False
        status_text = "Position your face in the center box"
        status_color = (0, 165, 255)

        if len(faces) == 0:
            status_text = "No face detected - move closer"
            status_color = (0, 0, 255)
        elif len(faces) > 1:
            status_text = "Multiple faces - only you should be visible"
            status_color = (0, 0, 255)
        else:
            x, y, fw, fh = faces[0]
            face_center_x = x + fw // 2
            face_center_y = y + fh // 2

            # Check if face is centered
            dx = abs(face_center_x - center_x)
            dy = abs(face_center_y - center_y)

            # Draw face box
            if dx < 80 and dy < 80 and fw > 120:
                cv2.rectangle(frame, (x, y), (x + fw, y + fh), (0, 255, 0), 3)
                status_text = "READY - Press SPACE to capture"
                status_color = (0, 255, 0)
                ready_to_capture = True
            else:
                cv2.rectangle(frame, (x, y), (x + fw, y + fh), (0, 165, 255), 2)
                if fw < 120:
                    status_text = "Move closer to camera"
                elif dx > 80 or dy > 80:
                    status_text = "Center your face in the box"

        # Draw status
        draw_text(frame, f"Sample {samples_captured + 1}/{samples_needed}", (10, 30), (255, 255, 255))
        draw_text(frame, status_text, (10, 60), status_color)

        # Progress bar
        bar_width = 200
        bar_height = 10
        progress = samples_captured / samples_needed
        cv2.rectangle(frame, (10, h - 40), (10 + bar_width, h - 40 + bar_height), (50, 50, 50), -1)
        cv2.rectangle(
            frame, (10, h - 40), (10 + int(bar_width * progress), h - 40 + bar_height), (0, 255, 0), -1
        )

        cv2.imshow("Face Registration", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            print("\nRegistration cancelled.")
            break
        elif key == ord(" ") and ready_to_capture:
            print(f"  Captured sample {samples_captured + 1}")

            # If face_recognition available, save encoding
            if fr_available:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                face_locations = face_recognition.face_locations(rgb)
                if face_locations:
                    face_encodings = face_recognition.face_encodings(rgb, face_locations)
                    if face_encodings:
                        encodings.append(face_encodings[0])

            samples_captured += 1
            time.sleep(0.3)  # Brief pause

    cap.release()
    cv2.destroyAllWindows()

    if samples_captured >= samples_needed:
        print()
        print("=" * 60)
        print("  REGISTRATION COMPLETE!")
        print("=" * 60)

        if fr_available and encodings:
            # Save encodings
            FACE_DATA_DIR.mkdir(parents=True, exist_ok=True)
            with open(FACE_ENCODING_FILE, "wb") as f:
                pickle.dump(encodings, f)
            print()
            print(f"Saved {len(encodings)} face encodings to:")
            print(f"  {FACE_ENCODING_FILE}")
            print()
            print("You can now run the presence detector:")
            print("  python detector.py --preview")
        else:
            print()
            print("Face samples captured successfully!")
            print()
            print("To save face encodings, install face_recognition:")
            print("  pip install face_recognition")
            print("Then run this registration again.")

        return True
    else:
        print(f"\nOnly captured {samples_captured}/{samples_needed} samples.")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Camera and Face Detection Test for SkyGlass",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python test_camera.py              # Basic camera test
  python test_camera.py --faces      # Test with face detection
  python test_camera.py --register   # Full registration walkthrough
  python test_camera.py --camera 1   # Use camera index 1
        """,
    )
    parser.add_argument("camera_index", nargs="?", type=int, default=0, help="Camera index (default: 0)")
    parser.add_argument("--faces", "-f", action="store_true", help="Enable face detection")
    parser.add_argument("--register", "-r", action="store_true", help="Run registration walkthrough")
    parser.add_argument("--camera", "-c", type=int, help="Camera index (alternative to positional)")

    args = parser.parse_args()

    camera_idx = args.camera if args.camera is not None else args.camera_index

    if args.register:
        success = registration_walkthrough(camera_idx)
    elif args.faces:
        success = test_camera_with_faces(camera_idx)
    else:
        success = test_camera_basic(camera_idx)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
