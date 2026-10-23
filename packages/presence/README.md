# SkyGlass Presence Detection

Python-based presence detection using camera and face recognition.

## Quick Start

```bash
# Create virtual environment (or from the repo root: npm run setup:dev -- deps)
python3 -m venv venv
source venv/bin/activate

# Install dependencies (includes face_recognition, which compiles dlib)
pip install -r requirements.txt

# Test camera
python test_camera.py

# Run presence detection (basic mode - detects any face)
python detector.py --method opencv --preview
```

## Detection Methods

| Method             | Accuracy | Speed            | Installation                                        | Notes                                                                                                         |
| ------------------ | -------- | ---------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `face_recognition` | Best     | ~10 analysed fps | `requirements.txt`                                  | Default. Recognizes enrolled users only; reports who is present                                               |
| `opencv`           | Basic    | Fast             | `requirements.txt` (YuNet model ships in `models/`) | Detects any face, no enrollment                                                                               |
| `auto`             | -        | -                | -                                                   | Default value of `presence.detection_method`: `face_recognition` if installed, else `opencv` (with a warning) |

`face_recognition` locates faces with the same YuNet model as `opencv` mode,
encodes each one with dlib and compares it with every enrolled user's
encodings. A face within `--tolerance` (default 0.6; lower is stricter) of
an enrolled user wakes the mirror as that user; anyone else is logged as an
unknown face and ignored. Registrations made from the app are picked up
within a couple of seconds without restarting the detector.

## Settings

`detector.py` reads the `presence:` block of `config/config.yaml`, layered over
`config/default.yaml`. Command-line flags override individual values:

| YAML key               | Flag           | Default       |
| ---------------------- | -------------- | ------------- |
| `detection_method`     | `--method`     | `auto`        |
| `camera_index`         | `--camera`     | `0`           |
| `camera_rotation`      |                | `auto`        |
| `tolerance`            | `--tolerance`  | `0.6`         |
| `min_detection_frames` | `--min-frames` | `3`           |
| `timeout`              | `--timeout`    | `5` (seconds) |

At startup it logs each effective value and where it came from
(`Setting tolerance = 0.6 (from ...)`). Invalid values (unknown method,
tolerance outside (0, 1], non-positive frames/timeout) stop it with an error.
Restart it after editing the YAML (`pm2 restart skyglass-detector`).

`camera_rotation` turns camera frames upright for portrait mirrors
(`rotation.py`; the detector and `web_server.py` both apply it). `auto`
follows `display.orientation`, since the camera sits in the frame and turns
with it; `0`, `90`, `180` or `270` (degrees clockwise) is for a camera mounted
on its own. It is re-read when `config.yaml` changes, so no restart is needed.

`pip install -r requirements.txt` compiles dlib on the first install. It
needs CMake and a C++ compiler and takes several minutes on a Mac (much
longer on a Raspberry Pi).

**Users registered before face_recognition was installed** have no encodings
(`"encodings": 0` in `face_data/users/<id>/metadata.json`). The detector
logs a warning for them and they are never recognised: register again from
the app.

## Usage

```bash
# Auto-detect best available method
python detector.py --preview

# Use specific method
python detector.py --method opencv --preview    # Basic, detects any face
python detector.py --method face_recognition --preview  # Requires enrollment

# Simulation mode (no camera)
python detector.py --simulate

# Full options
python detector.py --help
```

## Dependencies

### Required (installed via requirements.txt)

- `opencv-python` - Camera access, image processing and YuNet face detection
- `face_recognition` (dlib) - Recognizes which enrolled user is in view
- `numpy` - Array operations
- `requests` - HTTP client for backend communication

- `flask`, `gunicorn` - Presence/admin server (`web_server.py`)
- `pyyaml` - Reads `config/config.yaml`

## Production Deployment

On the Pi both processes run under PM2 (`config/pm2.config.cjs`, started by
`scripts/setup-pi.sh` or `npm start` from the repo root):

- `skyglass-detector`: `venv/bin/python detector.py --backend http://localhost:3001`
- `skyglass-admin`: `venv/bin/gunicorn -c gunicorn.conf.py wsgi:app`, which
  serves `web_server.py` on port 5000 (one worker, since the camera is
  single-process)

For development run them directly: `npm run dev:admin` (`python web_server.py`,
`--port`/`--camera` flags) and `npm run dev:detector` (`detector.py --preview`).

### Camera

`cameras.py` opens the camera for all three programs (`detector.py`,
`web_server.py`, `test_camera.py`):

- A Raspberry Pi camera (ribbon cable, e.g. Camera Module 3) is used when one is
  connected. It is read with Picamera2 from apt (`python3-picamera2`), which is
  why `setup-pi.sh` creates the venv with `--system-site-packages`.
- Otherwise a USB webcam. On Linux `camera_index` counts USB webcams, so `0` is
  the first webcam even on a Pi 5, whose camera and codec hardware also create
  `/dev/video*` nodes.
- Elsewhere (macOS) `camera_index` is the OpenCV device number.

Only one process can stream a camera on a Pi. The detector holds it; when the
phone app starts a face registration, `web_server.py` writes a claim
(`data/camera-claim.json`), the detector releases the camera within half a
second, and takes it back when the session ends. Both use
`presence.camera_index`.

`web_server.py` is the enrollment backend for the phone app: the app calls the
mirror backend's `POST /api/registration/start` (with a `userId`), and the
backend drives this server's `/api/start` and `/api/capture`, which store the
face under `face_data/users/<userId>/`. `/video_feed` streams the camera
preview during enrollment. There is no browser registration or settings page;
setup happens only in the phone app.

Capture is hands-free (`auto_capture.py`): from `/api/start` on, one thread
per session reads the camera (the feed and captures share its latest frame)
and another analyses it at ~10 fps. Each of the 5 photos is taken once the
face is framed (one face, at least 120px wide, centre within 80px of the frame
centre), posed for the step (straight, turn, turn the other way, tilt up,
smile; judged from YuNet's landmarks against the first photo) and steady for a
second. A pose not reached within 8 s is dropped for that step. The server
posts the hint to show (`/api/registration/guidance`, `no_face`, `too_far`,
`hold`, `cooldown`, ...) to the backend whenever it changes, then `progress`
and `complete` as before. `/api/capture` is the manual fallback: optional
`{"delay": 0-5}` pauses auto capture for the countdown, then takes the latest
frame with the framing check only. Tunables are constants at the top of
`auto_capture.py`.

### Access control

Every route except `/api/health`, `/api/status` and the login page needs a
credential: the backend's internal service token (`data/internal-token`), an
admin session, or the token of the active enrollment session (camera). The
browser admin portal at `/admin` is off until you set a password on the
device: `venv/bin/python set_admin_password.py`. Details:
`docs/SECURITY.md` at the repo root.

### Logs

```bash
pm2 logs skyglass-admin
pm2 logs skyglass-detector
pm2 monit
```

The systemd units under `config/systemd/` run only the boot-mode switch,
WiFi provisioning (`wifi_provisioning.py`) and the watchdog
(`watchdog_service.py`); there is no systemd unit for the detector or the
presence server.

## Troubleshooting

### Mirror does not wake (presence detection)

Work down this list; each line of the detector log answers one question.

1. **Is the detector running?** `npm run dev:e2e` starts it (`[detector]`
   lines) and `npm run dev:detector` runs it alone with a preview window.
   Nothing wakes the mirror unless one of these is running.
2. **Is the camera delivering frames?** The first lines report the camera's
   real resolution and fps, and the 10-second heartbeat shows frames per
   second and read failures:

   ```
   12:01:10 INFO  Camera 0 opened: 640x480 @ 30 fps (requested 640x480)
   12:01:20 INFO  10s: 296 frames (29.6 fps), face in 0 (0%), 118 with only too-small faces (largest 64px < 80px), detect 6.2 ms avg, 0 read failures, state absent, backend ok 0 / failed 0
   ```

   That heartbeat already tells you the usual story: a face _was_ found but
   is narrower than `--min-face-size` (default 80 px), so you are too far
   from the camera for the current threshold.

   In `face_recognition` mode the heartbeat also says whether the face was
   recognised, and how close an unknown face came:

   ```
   12:01:20 INFO  10s: 290 frames (29.0 fps), 96 analysed (38 ms avg), face in 96, enrolled user in 0, unknown face in 96 (nearest miss Clio at 0.64 > tolerance 0.60), 0 read failures, state absent, backend ok 0 / failed 0
   ```

   A nearest miss just above the tolerance usually means the registration
   was done in different light or at a different distance: register again
   in front of the mirror, or raise `--tolerance` slightly (0.65 at most;
   higher values start to accept other people). `No enrolled faces with
encodings` or `has no face encodings` at startup means nobody can be
   recognised yet: register from the app.

3. **Is the state machine moving?** Every transition is logged with its
   reason (`State -> detecting (face seen, need 3 consecutive frames)`,
   `State -> absent (no face for 5.2s)`). `min_detection_frames` and
   `timeout` in the `presence:` block of `config/config.yaml` (or
   `--min-frames` / `--timeout`) set those numbers.
4. **Does the backend accept the report?** `backend ok N / failed M` in the
   heartbeat, and a WARNING with the HTTP status or connection error when a
   report fails.

For per-frame detail run with `--log-level debug` (one summary line per
second) or `--log-level trace` (every frame), or set
`SKYGLASS_DETECTOR_LOG=debug` for `npm run dev:e2e`.

To tune without staring at a live camera, save frames and re-run the detector
on them offline:

```bash
python detector.py --dump-frames /tmp/skyglass-frames      # saves annotated frames
python face_detect.py /tmp/skyglass-frames/*.jpg --min-size 60 --score 0.7
```

Orange boxes are faces the size filter rejected. `--min-face-size` and
`--score-threshold` on `detector.py` apply the same knobs live.

In `face_recognition` mode `--dump-frames` saves frames with unknown faces
(raw plus `-annotated.jpg`). Copy raw frames into
`tests/fixtures/faces/<person>/` and run
`python -m pytest tests/test_identity_real_model.py` to check recognition
offline (see `tests/fixtures/faces/README.md`).

### Camera not working on Mac

Grant camera permission in: System Settings > Privacy & Security > Camera > Terminal

### Camera not working on Raspberry Pi

```bash
pm2 logs skyglass-detector --lines 20   # "Camera 0 opened: ..." names the camera in use
rpicam-hello --list-cameras             # does libcamera see the Pi camera?
pm2 stop skyglass-detector              # free the camera, then:
venv/bin/python test_camera.py          # lists the cameras it found if none opens
pm2 start skyglass-detector
```

A Pi camera that `rpicam-hello` lists but SkyGlass ignores usually means the
venv cannot see Picamera2: recreate it with
`python3 -m venv --system-site-packages venv`. For a USB webcam, check that your
user is in the `video` group (`sudo usermod -a -G video $USER`).

### face_recognition install fails

This library requires dlib which compiles from source. Ensure you have:

- CMake installed: `brew install cmake` (Mac) or `sudo apt install cmake` (Linux)
- Xcode command line tools: `xcode-select --install` (Mac only)

- On Linux: `sudo apt install build-essential cmake python3-dev`

Without it the detector falls back to `opencv` mode and wakes the mirror for
any face.
