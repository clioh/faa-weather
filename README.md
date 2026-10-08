# SkyGlass for Pilots

A smart mirror built for pilots that displays aviation weather, flight schedules, and activates via presence detection.

**Website:** https://skyglass.dev

## Features

- **Aviation Weather** - Real-time METAR/TAF with flight rules color coding (VFR/MVFR/IFR/LIFR)
- **TFRs & NOTAMs** - Active restrictions and notices for your area
- **Flight Schedule** - Google Calendar integration + airline XLSX schedule import via email
- **Presence Detection** - Wakes when you approach, sleeps when you leave
- **Sun/Moon Times** - Civil twilight for VFR currency tracking
- **Gesture Control** - Swipe to dismiss or put display to sleep

## Screenshots

```
┌────────────────────────────────────────────────────────┐
│  08:42:15 local                    KJFK  VFR          │
│  13:42:15 Zulu                                         │
│                                    METAR KJFK 134215Z │
│  Mon, Jan 12                       31012KT 10SM FEW250│
│                                    TAF valid until... │
│                                                        │
│  TODAY'S SCHEDULE          ┌──────────────────────────┤
│  ─────────────────         │ SUNRISE    07:16        │
│  09:00  Sim Session        │ SUNSET     17:02        │
│  14:00  FO Trip - LAX      │ CIVIL TWI  06:45-17:33  │
│                            │ MOON       Waning 67%   │
│  TOMORROW                  └──────────────────────────┤
│  06:00  Report - JFK                                  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.11+
- Camera (Pi Camera Module or USB webcam)

### Development Setup (Mac/Linux)

```bash
# Clone the repository (replace <your-fork> with the GitHub account hosting your copy)
git clone https://github.com/<your-fork>/SkyGlass.git
cd SkyGlass

# Install dependencies
npm install

# Set up Python environment
cd packages/presence
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ../..

# Create config
cp config/default.yaml config/config.yaml
# Edit config/config.yaml with your settings

# Start development servers
npm run dev
```

Open http://localhost:5173 for the mirror display (Vite dev server, `npm run dev` only). In production the backend serves the built display on port 3001 (http://localhost:3001).

### Raspberry Pi Setup

```bash
# Clone and run setup script
git clone https://github.com/<your-fork>/SkyGlass.git ~/SkyGlass
cd ~/SkyGlass
./scripts/setup-pi.sh

# Configure via web UI
# Open http://skyglass.local:5000/admin in browser
```

`<your-fork>` is a placeholder: there is no official public repository URL yet, so use the URL of the repository you cloned or forked.

The Pi install lives at `~/SkyGlass`; `setup-pi.sh` always installs there. The PM2 config (`config/pm2.config.cjs`) defaults to `~/SkyGlass` and can be pointed elsewhere with the `SKYGLASS_DIR` environment variable (e.g. `SKYGLASS_DIR=/opt/SkyGlass pm2 start config/pm2.config.cjs`).

## Configuration

Edit `config/config.yaml`:

```yaml
airport: KJFK                    # Your home airport ICAO code

location:
  latitude: 40.6413
  longitude: -73.7781
  timezone: America/New_York

display:
  presence_timeout: 120          # Seconds before sleep
  brightness: 80                 # Default brightness %

presence:
  camera_index: 0
  detection_method: auto         # face_recognition | haar | mediapipe | auto

calendar:
  google:
    enabled: true
    calendar_ids:
      - primary

# Optional: Auto-import XLSX schedules from email
schedule:
  email:
    enabled: false
    imap_host: imap.gmail.com
    imap_port: 993
    username: ${EMAIL_USER}
    password: ${EMAIL_PASS}
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/aviation/metar/:icao` | Current METAR with flight rules |
| `GET /api/aviation/taf/:icao` | Terminal aerodrome forecast |
| `GET /api/aviation/tfrs` | Active TFRs in area |
| `GET /api/astro` | Sun/moon times for today |
| `GET /api/schedule` | Combined calendar + flight schedule |
| `GET /api/health` | Service health check |

## Project Structure

```
SkyGlass/
├── packages/
│   ├── backend/           # Node.js API server
│   │   └── src/
│   │       ├── services/  # Aviation, calendar, astro services
│   │       └── routes/    # API endpoints
│   ├── frontend/          # React display UI
│   │   └── src/
│   │       └── components/widgets/  # Clock, Aviation, Schedule, etc.
│   └── presence/          # Python presence detection
│       ├── detector.py    # Presence/face detection
│       ├── web_server.py  # Registration & settings server
│       └── admin_portal.py # Admin dashboard
├── config/
│   ├── default.yaml       # Default configuration
│   └── config.yaml        # Your settings (gitignored)
├── scripts/
│   ├── setup-pi.sh        # Raspberry Pi setup
│   ├── setup-mac.sh       # Mac development setup
│   └── kiosk.sh          # Kiosk mode launcher
└── docs/
    └── HARDWARE.md        # Build guide with parts list
```

## Hardware

See [docs/HARDWARE.md](docs/HARDWARE.md) for complete build instructions including:

- Parts list (~$359 recommended build)
- Frame assembly guide
- Electronics installation
- Mounting instructions

**Recommended setup:**
- Raspberry Pi 5 (4GB)
- Pi Camera Module 3
- 24" IPS Monitor
- Two-way mirror acrylic

## Scripts

```bash
npm run dev          # Start development servers
npm run build        # Build for production
npm run start        # Start production (PM2)
npm run test         # Run test suite
npm run enroll       # Enroll face (CLI)
npm run enroll:web   # Enroll face (web UI)
npm run update       # Check and apply updates
npm run kiosk        # Launch kiosk mode
```

## Presence Detection Methods

| Method | Speed | Accuracy | Notes |
|--------|-------|----------|-------|
| `face_recognition` | Slowest | Best | dlib face encodings; recognizes enrolled users only. Requires `pip install face_recognition` |
| `mediapipe` | Fast | Good | MediaPipe face detection; detects any face. Requires `pip install mediapipe` |
| `haar` | Fastest | Basic | OpenCV Haar cascade; detects any face. No extra install |
| `auto` | - | - | Default. Picks the best installed method: `face_recognition` > `mediapipe` > `haar` |

## Deployment

### PM2 (Recommended)

```bash
npm run start        # Starts all services
pm2 status          # Check status
pm2 logs            # View logs (all apps)
pm2 save            # Save for auto-restart
```

PM2 apps: `skyglass-backend` (API + built display on port 3001), `skyglass-detector`, `skyglass-admin`, `skyglass-mdns`. View one app's logs with e.g. `pm2 logs skyglass-backend`.

### systemd (Raspberry Pi)

```bash
sudo ./scripts/install-systemd.sh

# Service status
systemctl status skyglass-admin.service      # Admin portal (port 5000)
systemctl status skyglass-detector.service   # Presence detection
systemctl status skyglass-mdns.service       # mDNS advertisement (skyglass.local)
systemctl status skyglass-watchdog.service   # Watchdog
systemctl status skyglass-update.timer       # Auto-update timer

# Logs
journalctl -u skyglass-<service> -f
journalctl -u skyglass-update.service

# Updates
sudo systemctl start skyglass-update.service    # Run update now
sudo systemctl disable skyglass-update.timer    # Disable auto-update
```

`skyglass-boot.service` and `skyglass-provision.service` (WiFi provisioning via the `SkyGlass-Setup` hotspot) are installed by `scripts/setup-pi.sh`.

### Updating

Updates are installed from the `skyglass-vX.Y.Z.tar.gz` asset attached to each GitHub release (built by `.github/workflows/release.yml`; it contains the prebuilt `packages/backend/dist` and `packages/frontend/dist`). Set `GITHUB_REPO=<owner>/SkyGlass` in the environment of the backend and of `scripts/update.sh` so they look at your repository.

- **In the display UI**: *Download* fetches the tarball, *Install Now* hands it to `scripts/update.sh --apply-tarball` and returns immediately. The display shows "Update started, restarting…" and reloads itself once the backend is back on the new version.
- **From a shell**: `npm run update` (prompt), `./scripts/update.sh --check` (exit 0 if an update is available), `./scripts/update.sh --apply` (no prompt), or the `skyglass-update.timer` (`--auto`).

Either way `scripts/update.sh` backs up the install to `.backup/`, stops the PM2 apps, copies the release over the install with `rsync`, runs `npm install` (and `npm run build` only if the tarball has no `dist/`), updates the presence venv if `requirements.txt` changed, and restarts the apps with `pm2 startOrRestart config/pm2.config.cjs`. If `/api/health` is not up within 120 s, or any step fails, it restores the backup and restarts the previous version. Runtime state is never touched: `config/config.yaml`, `config/certs/`, `data/`, `logs/`, `.env` files, `node_modules`, Python venvs and `packages/presence/face_data`. Progress and errors are written to `logs/update.log`.

`rsync` and `curl` are required; `scripts/setup-pi.sh` installs both. Developers running from a git checkout can use `./scripts/update.sh --git` instead.

### Docker

```bash
docker compose up -d
```

## Development

### Running Tests

```bash
npm test                    # Run all tests
npm run test:watch         # Watch mode
cd packages/backend && npm test -- aviation  # Specific test
```

### Code Style

```bash
npm run lint               # ESLint
npm run format             # Prettier
npm run format:check       # Check formatting
```

## Troubleshooting

### Camera not detected
```bash
# Check camera connection
libcamera-hello --list-cameras

# Test with OpenCV
cd packages/presence
python3 test_camera.py
```

`test_camera.py` saves `snapshot_N.jpg` / `face_snapshot_N.jpg` files into `packages/presence/`. They are gitignored; delete them when you are done.

### Aviation data not loading
- Verify internet connection
- Check airport ICAO code is valid
- View backend logs: `pm2 logs skyglass-backend`

### Display won't wake
- Test presence detection: `python3 detector.py --preview`
- Check face enrollment: `ls packages/presence/face_data/`
- Verify camera permissions (Mac: System Settings > Privacy > Camera)

### High CPU usage
- Reduce detection resolution in config
- Increase polling intervals
- Use `haar` instead of `face_recognition`

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [aviationweather.gov](https://aviationweather.gov) - METAR/TAF data
- [OpenCV](https://opencv.org) - Computer vision
- [suncalc](https://github.com/mourner/suncalc) - Sun/moon calculations
