#!/usr/bin/env python3
"""
Gesture recognition for SkyGlass.

Detects hand gestures like swipes and waves to control the display.
Uses motion tracking and optional hand detection.

Supported gestures:
- swipe_left: Quick horizontal motion from right to left
- swipe_right: Quick horizontal motion from left to right
- wave: Repeated horizontal motion (dismiss gesture)
- palm: Open hand held still (wake gesture)
"""

import time
from collections import deque
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Tuple, List

import cv2
import numpy as np

# Try importing MediaPipe for better hand detection
try:
    import mediapipe as mp
    MP_HANDS_AVAILABLE = True
except ImportError:
    MP_HANDS_AVAILABLE = False


class GestureType(Enum):
    NONE = "none"
    SWIPE_LEFT = "swipe_left"
    SWIPE_RIGHT = "swipe_right"
    WAVE = "wave"
    PALM = "palm"


@dataclass
class Gesture:
    type: GestureType
    confidence: float
    timestamp: float


class MotionTracker:
    """
    Tracks motion in video frames using frame differencing.
    Used for detecting swipes without requiring hand detection.
    """

    def __init__(
        self,
        motion_threshold: int = 25,
        min_area: int = 5000,
        history_size: int = 10,
    ):
        self.motion_threshold = motion_threshold
        self.min_area = min_area
        self.history_size = history_size

        self.prev_frame: Optional[np.ndarray] = None
        self.motion_history: deque = deque(maxlen=history_size)
        self.centroid_history: deque = deque(maxlen=history_size)

    def update(self, frame: np.ndarray) -> Tuple[bool, Optional[Tuple[int, int]], float]:
        """
        Process a frame and detect motion.
        Returns (motion_detected, centroid, motion_area).
        """
        # Convert to grayscale and blur
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (21, 21), 0)

        if self.prev_frame is None:
            self.prev_frame = gray
            return False, None, 0.0

        # Compute frame difference
        frame_diff = cv2.absdiff(self.prev_frame, gray)
        thresh = cv2.threshold(frame_diff, self.motion_threshold, 255, cv2.THRESH_BINARY)[1]

        # Dilate to fill gaps
        thresh = cv2.dilate(thresh, None, iterations=2)

        # Find contours
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        # Find largest motion area
        max_area = 0
        centroid = None

        for contour in contours:
            area = cv2.contourArea(contour)
            if area > max_area and area > self.min_area:
                max_area = area
                M = cv2.moments(contour)
                if M["m00"] > 0:
                    cx = int(M["m10"] / M["m00"])
                    cy = int(M["m01"] / M["m00"])
                    centroid = (cx, cy)

        self.prev_frame = gray

        if centroid:
            self.centroid_history.append((centroid, time.time()))
            self.motion_history.append(max_area)
            return True, centroid, max_area

        return False, None, 0.0

    def get_motion_direction(self) -> Optional[str]:
        """
        Analyze centroid history to determine motion direction.
        Returns 'left', 'right', or None.
        """
        if len(self.centroid_history) < 5:
            return None

        # Get recent centroids
        recent = list(self.centroid_history)[-5:]
        times = [t for _, t in recent]
        positions = [p for p, _ in recent]

        # Check if motion is recent (within last 0.5 seconds)
        if times[-1] - times[0] > 0.5:
            return None

        # Calculate horizontal displacement
        start_x = positions[0][0]
        end_x = positions[-1][0]
        displacement = end_x - start_x

        # Need significant horizontal movement
        if abs(displacement) > 150:
            return "left" if displacement < 0 else "right"

        return None

    def clear(self):
        """Clear motion history."""
        self.prev_frame = None
        self.motion_history.clear()
        self.centroid_history.clear()


class GestureDetector:
    """
    Detects gestures using motion tracking and optional hand detection.
    """

    def __init__(
        self,
        swipe_threshold: int = 150,
        wave_threshold: int = 3,
        cooldown: float = 1.0,
        use_mediapipe: bool = True,
    ):
        self.swipe_threshold = swipe_threshold
        self.wave_threshold = wave_threshold
        self.cooldown = cooldown

        self.motion_tracker = MotionTracker()
        self.last_gesture_time = 0
        self.direction_history: deque = deque(maxlen=10)

        # MediaPipe hands (if available)
        self.use_mediapipe = use_mediapipe and MP_HANDS_AVAILABLE
        self.mp_hands = None
        self.hands = None

        if self.use_mediapipe:
            self.mp_hands = mp.solutions.hands
            self.hands = self.mp_hands.Hands(
                static_image_mode=False,
                max_num_hands=1,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )

    def detect(self, frame: np.ndarray) -> Optional[Gesture]:
        """
        Process a frame and detect any gestures.
        Returns a Gesture if detected, None otherwise.
        """
        current_time = time.time()

        # Check cooldown
        if current_time - self.last_gesture_time < self.cooldown:
            return None

        # Track motion
        motion_detected, centroid, area = self.motion_tracker.update(frame)

        gesture = None

        # Check for swipe gestures using motion tracking
        if motion_detected:
            direction = self.motion_tracker.get_motion_direction()
            if direction:
                self.direction_history.append((direction, current_time))

                # Check for wave (alternating directions)
                if self._detect_wave():
                    gesture = Gesture(
                        type=GestureType.WAVE,
                        confidence=0.8,
                        timestamp=current_time,
                    )
                elif direction == "left":
                    gesture = Gesture(
                        type=GestureType.SWIPE_LEFT,
                        confidence=0.7,
                        timestamp=current_time,
                    )
                elif direction == "right":
                    gesture = Gesture(
                        type=GestureType.SWIPE_RIGHT,
                        confidence=0.7,
                        timestamp=current_time,
                    )

        # Check for palm gesture using MediaPipe (if available)
        if self.use_mediapipe and gesture is None:
            palm_detected, palm_confidence = self._detect_palm(frame)
            if palm_detected:
                gesture = Gesture(
                    type=GestureType.PALM,
                    confidence=palm_confidence,
                    timestamp=current_time,
                )

        if gesture:
            self.last_gesture_time = current_time
            self.motion_tracker.clear()

        return gesture

    def _detect_wave(self) -> bool:
        """Detect a wave gesture (alternating left/right motion)."""
        if len(self.direction_history) < 4:
            return False

        recent = list(self.direction_history)[-6:]
        times = [t for _, t in recent]

        # Wave should happen within 2 seconds
        if times[-1] - times[0] > 2.0:
            return False

        # Count direction changes
        directions = [d for d, _ in recent]
        changes = 0
        for i in range(1, len(directions)):
            if directions[i] != directions[i - 1]:
                changes += 1

        return changes >= self.wave_threshold

    def _detect_palm(self, frame: np.ndarray) -> Tuple[bool, float]:
        """Detect an open palm using MediaPipe."""
        if not self.use_mediapipe or self.hands is None:
            return False, 0.0

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.hands.process(rgb)

        if not results.multi_hand_landmarks:
            return False, 0.0

        # Check if hand is open (all fingers extended)
        for hand_landmarks in results.multi_hand_landmarks:
            # Simple check: if fingertips are above their respective knuckles
            # This indicates extended fingers

            tips = [
                self.mp_hands.HandLandmark.INDEX_FINGER_TIP,
                self.mp_hands.HandLandmark.MIDDLE_FINGER_TIP,
                self.mp_hands.HandLandmark.RING_FINGER_TIP,
                self.mp_hands.HandLandmark.PINKY_TIP,
            ]

            pips = [
                self.mp_hands.HandLandmark.INDEX_FINGER_PIP,
                self.mp_hands.HandLandmark.MIDDLE_FINGER_PIP,
                self.mp_hands.HandLandmark.RING_FINGER_PIP,
                self.mp_hands.HandLandmark.PINKY_PIP,
            ]

            extended = 0
            for tip, pip in zip(tips, pips):
                if hand_landmarks.landmark[tip].y < hand_landmarks.landmark[pip].y:
                    extended += 1

            # All 4 fingers extended = open palm
            if extended >= 4:
                return True, 0.9

        return False, 0.0

    def close(self):
        """Release resources."""
        if self.hands:
            self.hands.close()


def draw_gesture_debug(frame: np.ndarray, gesture: Optional[Gesture]) -> np.ndarray:
    """Draw gesture detection debug info on frame."""
    debug_frame = frame.copy()

    if gesture:
        color = (0, 255, 0)
        text = f"{gesture.type.value} ({gesture.confidence:.0%})"
        cv2.putText(debug_frame, text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2)
    else:
        cv2.putText(debug_frame, "No gesture", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (128, 128, 128), 1)

    return debug_frame


# Test function
def main():
    """Test gesture detection with camera."""
    import argparse

    parser = argparse.ArgumentParser(description="Test gesture detection")
    parser.add_argument("--camera", "-c", type=int, default=0, help="Camera index")
    parser.add_argument("--no-mediapipe", action="store_true", help="Disable MediaPipe")
    args = parser.parse_args()

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        print("Failed to open camera")
        return

    detector = GestureDetector(use_mediapipe=not args.no_mediapipe)

    print("Gesture Detection Test")
    print("=" * 40)
    print("Supported gestures:")
    print("  - Swipe left/right quickly")
    print("  - Wave hand back and forth")
    if MP_HANDS_AVAILABLE and not args.no_mediapipe:
        print("  - Hold open palm")
    print()
    print("Press 'q' to quit")
    print()

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                continue

            gesture = detector.detect(frame)

            if gesture:
                print(f"Detected: {gesture.type.value} (confidence: {gesture.confidence:.0%})")

            debug_frame = draw_gesture_debug(frame, gesture)
            cv2.imshow("Gesture Detection", debug_frame)

            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    finally:
        cap.release()
        cv2.destroyAllWindows()
        detector.close()


if __name__ == "__main__":
    main()
