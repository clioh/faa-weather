# SkyGlass Presence Detection

Python-based presence detection using camera and face recognition.

## Quick Start

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install basic dependencies
pip install -r requirements.txt

# Test camera
python test_camera.py

# Run presence detection (basic mode - detects any face)
python detector.py --method haar --preview
```

## Detection Methods

| Method | Accuracy | Speed | Installation | Notes |
|--------|----------|-------|--------------|-------|
| `haar` | Basic | Fast | Built-in | Detects any face, no enrollment |
| `mediapipe` | Good | Fast | `pip install mediapipe` | Lightweight, cross-platform |
| `face_recognition` | Best | Slower | `pip install face_recognition` | Recognizes enrolled user only |

### Recommended Setup (when network allows)

For the best experience with user-specific face recognition:

```bash
# Install face_recognition (requires dlib, may take a while to compile)
pip install face_recognition

# Install mediapipe as alternative
pip install mediapipe
```

**Note:** The `face_recognition` library requires dlib which can take 10+ minutes to compile on first install and needs CMake. If you encounter issues, use `--method haar` for basic detection.

## Usage

```bash
# Auto-detect best available method
python detector.py --preview

# Use specific method
python detector.py --method haar --preview      # Basic, detects any face
python detector.py --method face_recognition --preview  # Requires enrollment

# Enroll your face (for face_recognition method)
python detector.py --enroll

# Simulation mode (no camera)
python detector.py --simulate

# Full options
python detector.py --help
```

## Dependencies

### Required (installed via requirements.txt)
- `opencv-python` - Camera access and image processing
- `numpy` - Array operations
- `requests` - HTTP client for backend communication

### Optional (install when network allows)
- `face_recognition` - Best accuracy, recognizes specific enrolled face
- `mediapipe` - Good accuracy, lighter weight alternative

## Production Deployment

### Using Gunicorn (Recommended)

```bash
# Install gunicorn
pip install gunicorn

# Run with Gunicorn
gunicorn -c gunicorn.conf.py wsgi:app

# Or use the start script
./start.sh              # Production (Gunicorn)
./start.sh --dev        # Development (Flask)
```

### Using PM2 (with Node.js services)

```bash
# From project root
pm2 start ecosystem.config.js

# View logs
pm2 logs skyglass-admin
pm2 logs skyglass-detector

# Monitor
pm2 monit
```

### Using systemd (Linux/Raspberry Pi)

```bash
# Copy service file
sudo cp config/systemd/skyglass-presence.service /etc/systemd/system/

# Edit paths if needed
sudo nano /etc/systemd/system/skyglass-presence.service

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable skyglass-presence
sudo systemctl start skyglass-presence

# Check status
sudo systemctl status skyglass-presence
```

## Troubleshooting

### Camera not working on Mac
Grant camera permission in: System Settings > Privacy & Security > Camera > Terminal

### Camera not working on Raspberry Pi
```bash
# Add user to video group
sudo usermod -a -G video $USER

# Enable camera in raspi-config
sudo raspi-config  # Interface Options > Camera > Enable
```

### face_recognition install fails
This library requires dlib which compiles from source. Ensure you have:
- CMake installed: `brew install cmake` (Mac) or `sudo apt install cmake` (Linux)
- Xcode command line tools: `xcode-select --install` (Mac only)

As a workaround, use `--method haar` which only needs OpenCV.
