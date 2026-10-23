"""Camera access shared by the detector, the presence/admin server and test_camera.py.

open_camera() picks the camera:

- A Raspberry Pi camera (ribbon/CSI, e.g. Camera Module 3) when libcamera
  reports one. These cameras are only reachable through libcamera, so they
  are read with Picamera2 (apt package python3-picamera2; the presence venv
  is created with --system-site-packages to see it). camera_index picks
  between two of them on a Pi 5.
- Otherwise a USB (UVC) webcam through OpenCV. On Linux camera_index counts
  USB webcams, so 0 is the first webcam even on a Pi 5, whose camera
  front end and codecs also register /dev/video* nodes.
- Otherwise cv2.VideoCapture(camera_index) (macOS and other platforms).

Every camera returns BGR frames, as cv2.VideoCapture does.

Only one process can stream a camera on Linux. The detector holds the camera
all the time; the presence/admin server needs it only during a face
registration. The server takes a claim (claim_camera) before opening it, and
the detector lets the camera go while a live claim exists (camera_claimed).
A claim names its process and expires, so a crashed server cannot keep the
detector blind.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np

import security

log = logging.getLogger("skyglass.camera")

WIDTH, HEIGHT = 640, 480
V4L_SYSFS = Path("/sys/class/video4linux")
CLAIM_FILENAME = "camera-claim.json"
OPEN_READ_ATTEMPTS = 10


class Camera:
    """A source of BGR frames. `description` says which camera and how it is read."""

    description = ""

    def read(self) -> Tuple[bool, Optional[np.ndarray]]:
        raise NotImplementedError

    def release(self) -> None:
        raise NotImplementedError


class OpenCVCamera(Camera):
    def __init__(self, cap: "cv2.VideoCapture", name: str):
        self.cap = cap
        self.description = (
            f"{name} via OpenCV ({cap.getBackendName()}), "
            f"{int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}"
            f" @ {cap.get(cv2.CAP_PROP_FPS):.0f} fps"
        )

    def read(self) -> Tuple[bool, Optional[np.ndarray]]:
        return self.cap.read()

    def release(self) -> None:
        self.cap.release()


class PiCamera(Camera):
    def __init__(self, picam2, info: dict):
        self.picam2 = picam2
        self.description = f"Raspberry Pi camera {info.get('Model', '?')} via libcamera, {WIDTH}x{HEIGHT}"

    def read(self) -> Tuple[bool, Optional[np.ndarray]]:
        try:
            # Picamera2's "RGB888" is stored B, G, R: already OpenCV order.
            return True, self.picam2.capture_array("main")
        except Exception as exc:  # libcamera errors surface as assorted exception types
            log.debug("Pi camera read failed: %s", exc)
            return False, None

    def release(self) -> None:
        try:
            self.picam2.stop()
        finally:
            self.picam2.close()


# --- Discovery ----------------------------------------------------------------


def _picamera2():
    """The Picamera2 class, or None when it is not installed (anything but a Pi)."""
    try:
        from picamera2 import Picamera2
    except Exception as exc:  # ImportError off a Pi; a numpy ABI mismatch raises ValueError
        if sys.platform.startswith("linux"):
            log.debug("Picamera2 unavailable (%s); Raspberry Pi cameras will not be used", exc)
        return None
    return Picamera2


def pi_cameras() -> List[dict]:
    """libcamera cameras on the board's camera ports, in Picamera2 numbering.

    libcamera also lists USB webcams; those are left to OpenCV.
    """
    Picamera2 = _picamera2()
    if Picamera2 is None:
        return []
    try:
        infos = Picamera2.global_camera_info()
    except Exception as exc:
        log.warning("libcamera camera list failed: %s", exc)
        return []
    cameras = []
    for num, info in enumerate(infos):
        if "usb" in str(info.get("Id", "")).lower():
            continue
        cameras.append({**info, "Num": info.get("Num", num)})
    return cameras


def usb_cameras(sysfs: Path = V4L_SYSFS) -> List[str]:
    """Capture nodes of USB (UVC) webcams, e.g. ["/dev/video8"]. Empty off Linux.

    A UVC webcam registers a capture node (index 0) and a metadata node; only
    the capture node is returned.
    """
    if not sysfs.is_dir():
        return []
    found = []
    for node in sysfs.glob("video*"):
        try:
            driver = os.path.basename(os.readlink(node / "device" / "driver"))
        except OSError:
            continue
        if driver != "uvcvideo":
            continue
        try:
            if (node / "index").read_text().strip() != "0":
                continue
        except OSError:
            pass
        found.append(node.name)
    found.sort(key=lambda name: int(name[len("video"):] or 0))
    return [f"/dev/{name}" for name in found]


# --- Opening ------------------------------------------------------------------


def _open_pi_camera(info: dict) -> Optional[Camera]:
    Picamera2 = _picamera2()
    picam2 = None
    try:
        picam2 = Picamera2(info["Num"])
        config = picam2.create_video_configuration(main={"size": (WIDTH, HEIGHT), "format": "RGB888"})
        picam2.configure(config)
        if "AfMode" in picam2.camera_controls:  # Camera Module 3 has autofocus
            from libcamera import controls

            picam2.set_controls({"AfMode": controls.AfModeEnum.Continuous})
        picam2.start()
        return PiCamera(picam2, info)
    except Exception as exc:  # busy camera, missing tuning file, ...
        log.warning("Could not open Raspberry Pi camera %s: %s", info.get("Model", info["Num"]), exc)
        if picam2 is not None:
            try:
                picam2.close()
            except Exception:
                pass
        return None


def _open_opencv(target, name: str) -> Optional[Camera]:
    cap = cv2.VideoCapture(target, cv2.CAP_V4L2) if isinstance(target, str) else cv2.VideoCapture(target)
    if not cap.isOpened():
        cap.release()
        return None
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
    # A V4L2 device another process is streaming opens fine and then fails to
    # read, so only a delivered frame counts as open. Some webcams return a
    # few empty frames while they warm up.
    for _ in range(OPEN_READ_ATTEMPTS):
        ok, _frame = cap.read()
        if ok:
            return OpenCVCamera(cap, name)
        time.sleep(0.1)
    cap.release()
    return None


def open_camera(index: int = 0) -> Optional[Camera]:
    """Open camera `index` (see the module docstring for numbering); None if it can't be read."""
    pi = pi_cameras()
    if pi:
        if index >= len(pi):
            log.error("camera_index %d, but only %d Raspberry Pi camera(s) found", index, len(pi))
            return None
        return _open_pi_camera(pi[index])

    usb = usb_cameras()
    if usb:
        if index >= len(usb):
            log.error("camera_index %d, but only %d USB camera(s) found: %s", index, len(usb), ", ".join(usb))
            return None
        return _open_opencv(usb[index], f"USB camera {usb[index]}")
    return _open_opencv(index, f"camera {index}")


# --- Sharing between processes --------------------------------------------------


def _claim_path() -> Path:
    return security.data_dir() / CLAIM_FILENAME


def claim_camera(ttl_seconds: float) -> None:
    """Ask the detector to let go of the camera for up to `ttl_seconds`."""
    path = _claim_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps({"pid": os.getpid(), "until": time.time() + ttl_seconds}))
    os.replace(tmp, path)


def release_claim() -> None:
    """Drop this process's claim, if it holds one."""
    path = _claim_path()
    claim = _read_claim(path)
    if claim is not None and claim.get("pid") == os.getpid():
        path.unlink(missing_ok=True)


def camera_claimed() -> bool:
    """True while another live process holds an unexpired claim."""
    claim = _read_claim(_claim_path())
    if not claim:
        return False
    pid = claim.get("pid")
    if not isinstance(pid, int) or pid == os.getpid():
        return False
    if not isinstance(claim.get("until"), (int, float)) or claim["until"] < time.time():
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass  # alive, owned by another user
    return True


def _read_claim(path: Path) -> Optional[dict]:
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None
