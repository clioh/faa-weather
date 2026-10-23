"""detector.py settings: config.yaml presence block, CLI overrides, fallbacks."""

import pytest

import detector as det


def parse(*argv):
    return det.build_parser().parse_args(list(argv))


def write(path, text):
    path.write_text(text)
    return path


def test_missing_files_fall_back_to_builtin_defaults(tmp_path):
    settings, sources = det.resolve_settings(parse(), config_dir=tmp_path)
    assert settings == {
        "detection_method": "auto",
        "camera_index": 0,
        "camera_rotation": "auto",
        "tolerance": 0.6,
        "min_detection_frames": 3,
        "timeout": 5.0,
    }
    assert set(sources.values()) == {"built-in default"}


def test_yaml_values_are_used(tmp_path):
    cfg = write(tmp_path / "config.yaml", """
presence:
  detection_method: opencv
  camera_index: 2
  camera_rotation: 90
  tolerance: 0.45
  min_detection_frames: 5
  timeout: 12
""")
    settings, sources = det.resolve_settings(parse(), config_dir=tmp_path)
    assert settings == {
        "detection_method": "opencv",
        "camera_index": 2,
        "camera_rotation": "90",
        "tolerance": 0.45,
        "min_detection_frames": 5,
        "timeout": 12.0,
    }
    assert set(sources.values()) == {str(cfg)}


def test_config_yaml_layers_over_default_yaml(tmp_path):
    default = write(tmp_path / "default.yaml", "presence:\n  tolerance: 0.5\n  timeout: 8\n")
    user = write(tmp_path / "config.yaml", "presence:\n  timeout: 3\n")
    settings, sources = det.resolve_settings(parse(), config_dir=tmp_path)
    assert settings["tolerance"] == 0.5 and sources["tolerance"] == str(default)
    assert settings["timeout"] == 3.0 and sources["timeout"] == str(user)
    assert sources["camera_index"] == "built-in default"


def test_default_yaml_used_when_config_yaml_missing(tmp_path):
    write(tmp_path / "default.yaml", "presence:\n  detection_method: face_recognition\n")
    settings, _ = det.resolve_settings(parse(), config_dir=tmp_path)
    assert settings["detection_method"] == "face_recognition"


def test_explicit_cli_flags_override_yaml(tmp_path):
    write(tmp_path / "config.yaml", """
presence:
  detection_method: face_recognition
  camera_index: 2
  tolerance: 0.45
  min_detection_frames: 5
  timeout: 12
""")
    args = parse("--method", "opencv", "--camera", "1", "--tolerance", "0.3", "--min-frames", "2", "--timeout", "7")
    settings, sources = det.resolve_settings(args, config_dir=tmp_path)
    assert settings == {
        "detection_method": "opencv",
        "camera_index": 1,
        "camera_rotation": "auto",
        "tolerance": 0.3,
        "min_detection_frames": 2,
        "timeout": 7.0,
    }
    assert sources["detection_method"] == "--method"
    assert sources["min_detection_frames"] == "--min-frames"


def test_unset_cli_flag_does_not_override_yaml(tmp_path):
    write(tmp_path / "config.yaml", "presence:\n  camera_index: 4\n")
    settings, _ = det.resolve_settings(parse("--tolerance", "0.4"), config_dir=tmp_path)
    assert settings["camera_index"] == 4
    assert settings["tolerance"] == 0.4


def test_unknown_yaml_method_is_rejected(tmp_path):
    write(tmp_path / "config.yaml", "presence:\n  detection_method: mediapipe\n")
    with pytest.raises(det.ConfigError, match=r"unknown method 'mediapipe'.*face_recognition, opencv, auto"):
        det.resolve_settings(parse(), config_dir=tmp_path)


def test_unknown_cli_method_is_rejected(capsys):
    with pytest.raises(SystemExit):
        parse("--method", "mediapipe")
    assert "invalid choice: 'mediapipe'" in capsys.readouterr().err


@pytest.mark.parametrize("yaml_text", [
    "presence:\n  tolerance: high\n",
    "presence:\n  tolerance: 1.5\n",
    "presence:\n  timeout: 0\n",
    "presence: [1, 2]\n",
    "presence: {\n",
])
def test_invalid_yaml_values_are_rejected(tmp_path, yaml_text):
    write(tmp_path / "config.yaml", yaml_text)
    with pytest.raises(det.ConfigError):
        det.resolve_settings(parse(), config_dir=tmp_path)


def test_repo_default_yaml_is_valid():
    settings, sources = det.resolve_settings(parse(), config_dir=det.CONFIG_DIR)
    assert settings["detection_method"] in det.DETECTION_METHODS
    assert sources["detection_method"].endswith(".yaml")
