"""Camera image rotation for portrait-mounted mirrors.

The camera sits in the mirror frame, so a mirror mounted portrait turns the
camera with it and every frame arrives sideways. Face detection and
recognition don't work on sideways faces, so frames are turned upright here
before the detector, the enrollment captures and the mirror's live feed see
them.

presence.camera_rotation picks the rotation:

- `auto` (default): follow display.orientation, the setting the phone app's
  Orientation step writes. landscape = 0, portrait-cw ("turned right", seen
  from the front) = 270, portrait-ccw ("turned left") = 90.
- 0, 90, 180, 270: degrees clockwise, for a camera mounted on its own
  (on top of a portrait frame, or upside down).

display.orientation comes from config/config.yaml over config/default.yaml,
or, when config.yaml doesn't set it, the pre-flashed boot partition file
(BOOT_ORIENTATION_FILE), the same rule as the backend
(packages/backend/src/config/index.ts).
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Optional

import yaml

log = logging.getLogger("skyglass.camera")

CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "config"
BOOT_ORIENTATION_FILE = "/boot/firmware/skyglass-orientation.txt"
ROTATIONS = (0, 90, 180, 270)
ORIENTATION_ROTATION = {"landscape": 0, "portrait-cw": 270, "portrait-ccw": 90}


def normalize_orientation(value) -> Optional[str]:
    """A display.orientation value, or None if unset or unknown. `portrait` reads as portrait-cw."""
    if not isinstance(value, str):
        return None
    v = value.strip().lower()
    if v == "portrait":
        return "portrait-cw"
    return v if v in ORIENTATION_ROTATION else None


def boot_orientation_path() -> Path:
    return Path(os.environ.get("SKYGLASS_ORIENTATION_FILE") or BOOT_ORIENTATION_FILE)


def _read_yaml(path: Path) -> dict:
    try:
        with open(path) as f:
            data = yaml.safe_load(f) or {}
    except (OSError, yaml.YAMLError) as exc:
        log.warning("%s: unreadable (%s); ignoring it for camera rotation", path, exc)
        return {}
    return data if isinstance(data, dict) else {}


def _block(data: dict, name: str) -> dict:
    block = data.get(name)
    return block if isinstance(block, dict) else {}


def configured_orientation(config_dir: Path = CONFIG_DIR) -> str:
    """display.orientation as the backend resolves it: config.yaml, else the boot file, else default.yaml."""
    user = _block(_read_yaml(Path(config_dir) / "config.yaml"), "display").get("orientation")
    found = normalize_orientation(user)
    if found:
        return found
    try:
        found = normalize_orientation(boot_orientation_path().read_text())
    except OSError:
        found = None
    if found:
        return found
    default = _block(_read_yaml(Path(config_dir) / "default.yaml"), "display").get("orientation")
    return normalize_orientation(default) or "landscape"


def parse_rotation(value) -> Optional[int]:
    """presence.camera_rotation as degrees clockwise, None for `auto`. Raises ValueError if invalid."""
    if value is None or (isinstance(value, str) and value.strip().lower() == "auto"):
        return None
    try:
        degrees = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{value!r} is not auto, 0, 90, 180 or 270") from None
    if degrees not in ROTATIONS:
        raise ValueError(f"{value!r} is not auto, 0, 90, 180 or 270")
    return degrees


def resolve_rotation(config_dir: Path = CONFIG_DIR) -> int:
    """Degrees clockwise to turn each camera frame so faces are upright."""
    setting = None
    for name in ("default.yaml", "config.yaml"):
        value = _block(_read_yaml(Path(config_dir) / name), "presence").get("camera_rotation")
        if value is not None:
            setting = value
    try:
        degrees = parse_rotation(setting)
    except ValueError as exc:
        log.warning("presence.camera_rotation %s; following display.orientation", exc)
        degrees = None
    if degrees is None:
        degrees = ORIENTATION_ROTATION[configured_orientation(config_dir)]
    return degrees


def rotate(frame, degrees: int):
    """`frame` turned `degrees` clockwise (0 returns it unchanged)."""
    if not degrees:
        return frame
    import cv2

    code = {
        90: cv2.ROTATE_90_CLOCKWISE,
        180: cv2.ROTATE_180,
        270: cv2.ROTATE_90_COUNTERCLOCKWISE,
    }[degrees]
    return cv2.rotate(frame, code)


class CameraRotation:
    """Turns frames upright and follows config.yaml while running.

    The phone app can change the orientation at any time (Settings › Mirror),
    so config.yaml is checked again every CHECK_SECONDS and the rotation
    re-resolved when the file changes.
    """

    CHECK_SECONDS = 5.0

    def __init__(self, config_dir: Path = CONFIG_DIR):
        self.config_dir = Path(config_dir)
        self._stamp = self._config_stamp()
        self.degrees = resolve_rotation(self.config_dir)
        self._checked_at = time.monotonic()
        if self.degrees:
            log.info("Camera frames rotated %d° clockwise", self.degrees)

    def _config_stamp(self):
        try:
            return (self.config_dir / "config.yaml").stat().st_mtime_ns
        except OSError:
            return None

    def apply(self, frame):
        now = time.monotonic()
        if now - self._checked_at >= self.CHECK_SECONDS:
            self._checked_at = now
            stamp = self._config_stamp()
            if stamp != self._stamp:
                self._stamp = stamp
                degrees = resolve_rotation(self.config_dir)
                if degrees != self.degrees:
                    log.info("Camera rotation now %d° clockwise", degrees)
                    self.degrees = degrees
        return rotate(frame, self.degrees)
