"""Camera rotation for portrait mounts (rotation.py)."""

import os

import numpy as np
import pytest

import rotation


@pytest.fixture
def config_dir(tmp_path, monkeypatch):
    (tmp_path / "default.yaml").write_text("display:\n  orientation: landscape\npresence:\n  camera_rotation: auto\n")
    monkeypatch.setenv("SKYGLASS_ORIENTATION_FILE", str(tmp_path / "boot-orientation.txt"))
    return tmp_path


def write_config(config_dir, text):
    path = config_dir / "config.yaml"
    path.write_text(text)
    # Let CameraRotation see a new mtime even within one clock tick.
    stamp = path.stat().st_mtime_ns + 1_000_000_000
    os.utime(path, ns=(stamp, stamp))


@pytest.mark.parametrize(
    "orientation, degrees",
    [("landscape", 0), ("portrait-cw", 270), ("portrait-ccw", 90), ("portrait", 270), ("sideways", 0)],
)
def test_auto_follows_display_orientation(config_dir, orientation, degrees):
    write_config(config_dir, f"display:\n  orientation: {orientation}\n")
    assert rotation.resolve_rotation(config_dir) == degrees


def test_explicit_rotation_overrides_orientation(config_dir):
    write_config(config_dir, "display:\n  orientation: portrait-cw\npresence:\n  camera_rotation: 180\n")
    assert rotation.resolve_rotation(config_dir) == 180


def test_invalid_rotation_falls_back_to_orientation(config_dir):
    write_config(config_dir, "display:\n  orientation: portrait-ccw\npresence:\n  camera_rotation: 45\n")
    assert rotation.resolve_rotation(config_dir) == 90


def test_boot_file_used_until_config_sets_orientation(config_dir):
    (config_dir / "boot-orientation.txt").write_text("portrait-ccw\n")
    assert rotation.configured_orientation(config_dir) == "portrait-ccw"
    write_config(config_dir, "airport: KDEN\n")
    assert rotation.configured_orientation(config_dir) == "portrait-ccw"
    write_config(config_dir, "display:\n  orientation: landscape\n")
    assert rotation.configured_orientation(config_dir) == "landscape"


def test_unreadable_boot_file_is_ignored(config_dir):
    (config_dir / "boot-orientation.txt").write_text("upside down\n")
    assert rotation.configured_orientation(config_dir) == "landscape"


@pytest.mark.parametrize("value", ["auto", None, "AUTO"])
def test_parse_rotation_auto(value):
    assert rotation.parse_rotation(value) is None


@pytest.mark.parametrize("value", [45, "left", -90, 360])
def test_parse_rotation_rejects(value):
    with pytest.raises(ValueError):
        rotation.parse_rotation(value)


def test_rotate_turns_frame_clockwise():
    # A 2x3 frame whose top-left pixel is marked.
    frame = np.zeros((2, 3, 3), dtype=np.uint8)
    frame[0, 0] = 255
    assert rotation.rotate(frame, 0) is frame
    cw = rotation.rotate(frame, 90)
    assert cw.shape == (3, 2, 3) and cw[0, 1, 0] == 255  # top-left moves to top-right
    ccw = rotation.rotate(frame, 270)
    assert ccw.shape == (3, 2, 3) and ccw[2, 0, 0] == 255  # top-left moves to bottom-left
    assert rotation.rotate(frame, 180)[1, 2, 0] == 255


def test_camera_rotation_follows_config_changes(config_dir, monkeypatch):
    write_config(config_dir, "display:\n  orientation: landscape\n")
    upright = rotation.CameraRotation(config_dir)
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    assert upright.apply(frame).shape == (480, 640, 3)

    write_config(config_dir, "display:\n  orientation: portrait-cw\n")
    monkeypatch.setattr(rotation.CameraRotation, "CHECK_SECONDS", 0.0)
    assert upright.apply(frame).shape == (640, 480, 3)
    assert upright.degrees == 270


def test_detector_validates_camera_rotation(tmp_path):
    import argparse

    import detector

    (tmp_path / "config.yaml").write_text("presence:\n  camera_rotation: 45\n")
    with pytest.raises(detector.ConfigError, match="camera_rotation"):
        detector.resolve_settings(argparse.Namespace(), config_dir=tmp_path)
    (tmp_path / "config.yaml").write_text("presence:\n  camera_rotation: 90\n")
    settings, _ = detector.resolve_settings(argparse.Namespace(), config_dir=tmp_path)
    assert settings["camera_rotation"] == "90"
