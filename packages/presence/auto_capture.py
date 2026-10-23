"""
Hands-free enrollment capture: decides when to take each of the 5 photos.

web_server.py analyses the enrollment camera at ANALYSIS_FPS and feeds every
detection to AutoCapture.update(). Once the face is framed (the same rule the
manual /api/capture applies), posed for the current instruction and steady for
HOLD_SECONDS, the decision says capture; the server stores the sample and
reports back with captured() or capture_failed().

Instructions (index = samples collected, text lives in the mirror and phone):
0 look straight (records the baseline pose), 1 turn either way, 2 turn the
other way, 3 tilt up, 4 smile. Left/right is never checked: a mirrored webcam
or a person who mixes them up must not get stuck. A pose not reached within
POSE_PATIENCE seconds of framed time is dropped for that step.

Pure code: no camera, no clock (``now`` is passed in), no network.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Optional, Sequence, Tuple

log = logging.getLogger("skyglass.enrollment")

# Tunables. First guesses, to be tuned on the Pi.
HOLD_SECONDS = 1.0     # framed + posed this long before a capture
STILL_PX = 12          # max face-centre drift during the hold, frame px
COOLDOWN = 1.5         # pause after a capture before the next step starts
YAW_TURN = 0.18        # |yaw - baseline yaw| for the turn steps
PITCH_UP = 0.08        # baseline pitch - pitch for the tilt step
SMILE_RATIO = 1.06     # mouth ratio / baseline mouth ratio for the smile step
POSE_PATIENCE = 8.0    # framed seconds before a step's pose rule is dropped
ANALYSIS_FPS = 10

# Framing, shared with the manual capture so the two can't drift.
CENTRE_TOLERANCE_PX = 80
MIN_FACE_WIDTH_PX = 120

SAMPLES_NEEDED = 5

# Guidance reasons (hands-free contract; the clients map them to hint text).
NO_FACE = "no_face"
MULTIPLE = "multiple"
TOO_FAR = "too_far"
OFF_CENTRE = "off_centre"
TURN_MORE = "turn_more"
OTHER_WAY = "other_way"
HOLD = "hold"
COOLDOWN_REASON = "cooldown"

# Framed time counted per update at most, so a stalled analysis loop
# (slow backend, paused for a manual capture) doesn't burn the patience.
_MAX_PATIENCE_STEP = 0.5


@dataclass(frozen=True)
class Pose:
    """Landmark-only head pose. yaw: signed nose offset along the eye line in
    eye distances (0 = frontal). pitch: nose depth between the eye line and
    the mouth, 0..1 (smaller = tilted up). mouth: mouth width / eye distance."""

    yaw: float
    pitch: float
    mouth: float


@dataclass(frozen=True)
class Decision:
    reason: Optional[str]      # a guidance reason
    hold_ms: int = 0           # time left on the hold (reason == hold)
    capture: bool = False      # take the photo now
    hold_restarted: bool = False  # a new hold started this update


def _box(face) -> Tuple[int, int, int, int]:
    """(x, y, w, h) of a face_detect.Face or a plain box tuple."""
    box = getattr(face, "box", face)
    x, y, w, h = box
    return int(x), int(y), int(w), int(h)


def face_centre(face) -> Tuple[float, float]:
    x, y, w, h = _box(face)
    return x + w / 2.0, y + h / 2.0


def estimate_pose(face) -> Optional[Pose]:
    """Pose from the five YuNet landmarks, or None without usable landmarks.

    Measured in the eye-line frame (u along the eyes, v perpendicular towards
    the mouth), so a head tilted sideways (roll) doesn't read as a turn or a
    nod. With the eyes level this is exactly
    yaw = (nose_x - eye_mid_x) / eye_dist,
    pitch = (nose_y - eye_mid_y) / (mouth_mid_y - eye_mid_y).
    """
    try:
        rex, rey = face.right_eye
        lex, ley = face.left_eye
        nx, ny = face.nose
        mrx, mry = face.mouth_right
        mlx, mly = face.mouth_left
    except (AttributeError, TypeError, ValueError):
        return None

    ex, ey = lex - rex, ley - rey
    eye_dist = math.hypot(ex, ey)
    if eye_dist < 1.0:
        return None
    ux, uy = ex / eye_dist, ey / eye_dist
    vx, vy = -uy, ux
    emx, emy = (rex + lex) / 2.0, (rey + ley) / 2.0
    mmx, mmy = (mrx + mlx) / 2.0, (mry + mly) / 2.0
    # v points towards the mouth whichever way round the eyes are labelled.
    if (mmx - emx) * vx + (mmy - emy) * vy < 0:
        vx, vy = -vx, -vy

    mouth_depth = (mmx - emx) * vx + (mmy - emy) * vy
    if mouth_depth < 1.0:
        return None
    yaw = ((nx - emx) * ux + (ny - emy) * uy) / eye_dist
    pitch = ((nx - emx) * vx + (ny - emy) * vy) / mouth_depth
    mouth = math.hypot(mlx - mrx, mly - mry) / eye_dist
    return Pose(yaw=yaw, pitch=pitch, mouth=mouth)


def assess_framing(faces: Sequence, frame_shape) -> Optional[str]:
    """no_face | multiple | too_far | off_centre, or None when framed.

    Exactly one face, at least MIN_FACE_WIDTH_PX wide, its centre within
    CENTRE_TOLERANCE_PX of the frame centre on both axes. Takes Face records
    or (x, y, w, h) boxes.
    """
    if not faces:
        return NO_FACE
    if len(faces) > 1:
        return MULTIPLE
    x, y, w, h = _box(faces[0])
    if w < MIN_FACE_WIDTH_PX:
        return TOO_FAR
    frame_h, frame_w = frame_shape[:2]
    dx = abs(x + w // 2 - frame_w // 2)
    dy = abs(y + h // 2 - frame_h // 2)
    if dx > CENTRE_TOLERANCE_PX or dy > CENTRE_TOLERANCE_PX:
        return OFF_CENTRE
    return None


def _sign(v: float) -> int:
    return 1 if v > 0 else -1 if v < 0 else 0


class AutoCapture:
    """Step-by-step capture decisions for one enrollment session.

    update() is called for every analysed frame. A Decision with capture=True
    means "store this frame now"; the caller then calls captured() if a sample
    was stored (also for a manual capture, so step == samples collected) or
    capture_failed() if not (e.g. no face encoding), which keeps the step.
    """

    def __init__(self, samples_needed: int = SAMPLES_NEEDED):
        self.samples_needed = samples_needed
        self.step = 0
        self.baseline: Optional[Pose] = None
        self.first_turn = 0          # yaw side of step 1 (+1/-1), 0 = unknown
        self._hold_start: Optional[float] = None
        self._hold_centre: Optional[Tuple[float, float]] = None
        self._cooldown_until = 0.0
        self._patience_used = 0.0
        self._last_now: Optional[float] = None
        self._pending_pose: Optional[Pose] = None
        log.debug(
            "Auto capture: hold %.1fs, still %dpx, cooldown %.1fs, yaw %.2f, "
            "pitch %.2f, smile %.2f, patience %.0fs, %d fps",
            HOLD_SECONDS, STILL_PX, COOLDOWN, YAW_TURN, PITCH_UP, SMILE_RATIO,
            POSE_PATIENCE, ANALYSIS_FPS,
        )

    @property
    def done(self) -> bool:
        return self.step >= self.samples_needed

    def reset_hold(self) -> None:
        self._hold_start = None
        self._hold_centre = None

    def update(self, faces: Sequence, frame_shape, now: float) -> Decision:
        dt = 0.0 if self._last_now is None else max(0.0, now - self._last_now)
        self._last_now = now

        if self.done:
            return Decision(COOLDOWN_REASON)
        if now < self._cooldown_until:
            self.reset_hold()
            return Decision(COOLDOWN_REASON)

        reason = assess_framing(faces, frame_shape)
        if reason is not None:
            self.reset_hold()
            return Decision(reason)

        face = faces[0]
        pose = estimate_pose(face)
        if self.baseline is None and self.step > 0 and pose is not None:
            # Step 0 was taken without landmarks (manual capture of a bare
            # box): the first pose seen stands in for the baseline.
            self.baseline = pose

        self._patience_used += min(dt, _MAX_PATIENCE_STEP)
        if self._patience_used < POSE_PATIENCE:
            reason = self._pose_reason(pose)
            if reason is not None:
                self.reset_hold()
                return Decision(reason)

        centre = face_centre(face)
        restarted = False
        if self._hold_start is None or math.dist(centre, self._hold_centre) > STILL_PX:
            self._hold_start = now
            self._hold_centre = centre
            restarted = True
        held = now - self._hold_start
        if held >= HOLD_SECONDS:
            self._pending_pose = pose
            return Decision(HOLD, 0, capture=True, hold_restarted=restarted)
        left_ms = int(round((HOLD_SECONDS - held) * 1000))
        return Decision(HOLD, left_ms, hold_restarted=restarted)

    def captured(self, now: float, face=None) -> None:
        """A sample for the current step was stored. ``face`` is the face it
        was taken from (its pose is recorded); without one, the pose of the
        last capture decision is used."""
        pose = estimate_pose(face) if face is not None else None
        if pose is None:
            pose = self._pending_pose
        self._pending_pose = None
        if self.step == 0:
            self.baseline = pose
        elif self.step == 1 and pose is not None and self.baseline is not None:
            d = pose.yaw - self.baseline.yaw
            # A turn too small to tell (patience fallback) leaves step 2 open.
            self.first_turn = _sign(d) if abs(d) >= YAW_TURN / 2 else 0
        self.step += 1
        self._cooldown_until = now + COOLDOWN
        self._patience_used = 0.0
        self.reset_hold()

    def capture_failed(self) -> None:
        """The sample could not be stored: stay on the step, hold again."""
        self._pending_pose = None
        self.reset_hold()

    def _pose_reason(self, pose: Optional[Pose]) -> Optional[str]:
        if self.step == 0:
            return None
        if pose is None or self.baseline is None:
            return TURN_MORE
        b = self.baseline
        d_yaw = pose.yaw - b.yaw
        if self.step in (1, 2):
            if (self.step == 2 and self.first_turn
                    and _sign(d_yaw) == self.first_turn and abs(d_yaw) >= YAW_TURN / 2):
                return OTHER_WAY
            return None if abs(d_yaw) >= YAW_TURN else TURN_MORE
        if self.step == 3:
            return None if b.pitch - pose.pitch >= PITCH_UP else TURN_MORE
        if self.step == 4:
            frontal = abs(d_yaw) < YAW_TURN
            return None if frontal and pose.mouth >= SMILE_RATIO * b.mouth else TURN_MORE
        return None
