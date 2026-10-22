#!/usr/bin/env python3
"""
Camera and Face Detection Test Script for SkyGlass.

Tests camera functionality and face detection. Registration happens from
the phone app (or `npm run setup:dev -- face --camera`).

Usage:
    python test_camera.py              # Basic camera test
    python test_camera.py --faces      # Camera test with face detection
"""

import argparse
import sys
import time

import cv2

from face_detect import FaceDetector


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
    print("Camera opened successfully!")
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
    """Camera test with face detection using OpenCV's YuNet model."""
    print(f"Testing camera {camera_index} with face detection...")

    cap = cv2.VideoCapture(camera_index)

    if not cap.isOpened():
        print(f"ERROR: Could not open camera {camera_index}")
        return False

    info = get_camera_info(cap)
    print(f"Camera opened: {info['width']}x{info['height']} @ {info['fps']} FPS")

    # YuNet face detector; also gives eye landmarks, so no separate eye model
    face_detector = FaceDetector(min_size=80)

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

        # Detect faces
        faces = face_detector.detect_faces(frame)

        num_faces = len(faces)
        if num_faces > 0:
            faces_detected_total += 1

        # Draw bounding boxes and info for each face
        for i, face in enumerate(faces):
            x, y, w, h = face.box
            # Main face rectangle
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)

            # Face label
            label = f"Face {i + 1}"
            draw_text(frame, label, (x, y - 10), (0, 255, 0))

            # Face dimensions
            draw_text(frame, f"{w}x{h}px", (x, y + h + 20), (200, 200, 200), 0.4)

            # Eye landmarks from the detector
            for eye_center in face.eyes:
                cv2.circle(frame, eye_center, max(8, w // 12), (255, 0, 255), 2)

            draw_text(frame, f"Score: {face.score:.2f}", (x, y + h + 35), (255, 0, 255), 0.4)

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
        draw_text(frame, "q=quit  s=save", (10, h - 10), (150, 150, 150), 0.4)

        cv2.imshow("Face Detection Test", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("s"):
            filename = f"face_snapshot_{frame_count}.jpg"
            cv2.imwrite(filename, frame)
            print(f"Saved {filename}")

    cap.release()
    cv2.destroyAllWindows()

    detection_rate = (faces_detected_total / frame_count * 100) if frame_count > 0 else 0
    print(f"Test complete. Face detection rate: {detection_rate:.1f}%")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Camera and Face Detection Test for SkyGlass",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python test_camera.py              # Basic camera test
  python test_camera.py --faces      # Test with face detection
  python test_camera.py --camera 1   # Use camera index 1
        """,
    )
    parser.add_argument("camera_index", nargs="?", type=int, default=0, help="Camera index (default: 0)")
    parser.add_argument("--faces", "-f", action="store_true", help="Enable face detection")
    parser.add_argument("--camera", "-c", type=int, help="Camera index (alternative to positional)")

    args = parser.parse_args()

    camera_idx = args.camera if args.camera is not None else args.camera_index

    if args.faces:
        success = test_camera_with_faces(camera_idx)
    else:
        success = test_camera_basic(camera_idx)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
