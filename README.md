# SkyGlass for Pilots

A smart mirror built for pilots that displays aviation weather, flight schedules, and activates via presence detection.

**Website:** https://skyglass.dev

## Features

- **Aviation Weather** - Real-time METAR/TAF with flight rules color coding (VFR/MVFR/IFR/LIFR)
- **TFRs & NOTAMs** - Active restrictions and notices for your area
- **Schedule** - Google, Outlook, iCloud, CalDAV or calendar-link (ICS) accounts connected from the phone app, plus airline XLSX schedule import via email ([docs/CALENDAR.md](docs/CALENDAR.md))
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
# Clone the repository
git clone https://github.com/clioh/skyglass.git SkyGlass
cd SkyGlass

# Install dependencies
npm install

# Set up the Python environment (packages/presence/venv; compiles dlib, takes a few minutes)
npm run setup:dev -- deps

# Create config
cp config/default.yaml config/config.yaml
# Edit config/config.yaml with your settings

# Start development servers
npm run dev
```

Open http://localhost:5173 for the mirror display (Vite dev server, `npm run dev` only). In production the backend serves the built display on port 3001 (http://localhost:3001).

A fresh checkout shows the first-run setup screen. To get through it without a Pi, phone, or camera:

```bash
npm run setup:dev -- walkthrough   # step through location → airport → face while watching :5173
npm run setup:dev -- complete      # or do it all at once
npm run setup:dev -- presence on   # wake the mirror
npm run setup:dev -- reset         # back to the setup screen
```

See [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) for how the pipeline fits together, camera-based enrollment, and testing with the phone app.

### Raspberry Pi Setup

```bash
# Clone and run setup script
git clone https://github.com/clioh/skyglass.git ~/SkyGlass
cd ~/SkyGlass
./scripts/setup-pi.sh
```

`setup-pi.sh` installs everything natively (no Docker): Node, the presence venv, PM2 with the three apps in `config/pm2.config.cjs`, the `skyglass-boot`, `skyglass-provision` and `skyglass-watchdog` systemd units, and a Chromium kiosk pointed at `http://localhost:3001`. Setup (WiFi, license, location, airport, face registration) is done from the phone app; on first boot without WiFi the mirror opens the `SkyGlass-Setup` hotspot. Once on your network the mirror is at `http://skyglass.local:3001`.

The Pi install lives at `~/SkyGlass`; `setup-pi.sh` always installs there. The PM2 config (`config/pm2.config.cjs`) defaults to the checkout it lives in and can be pointed elsewhere with the `SKYGLASS_DIR` environment variable (e.g. `SKYGLASS_DIR=/opt/SkyGlass pm2 start config/pm2.config.cjs`).

## Configuration

Edit `config/config.yaml`:

```yaml
airport: KJFK # Your home airport ICAO code

# SkyGlass cloud service: calendar sign-in, NOTAMs, stock quotes. It holds all
# third-party API keys, so the mirror needs none (docs/CLOUD_SERVICE.md)
skyglass_service: https://skyglass.dev

location:
  latitude: 40.6413
  longitude: -73.7781
  timezone: America/New_York

display:
  presence_timeout: 120 # Seconds before sleep
  brightness: 80 # Default brightness %

presence:
  camera_index: 0
  detection_method: auto # face_recognition | opencv | auto
  tolerance: 0.6 # face_recognition match tolerance (lower = stricter)
  min_detection_frames: 3 # consecutive detections before waking
  timeout: 5 # seconds without a face before absent

# Calendars are connected from the phone app. Google/Outlook sign-in goes
# through skyglass_service; the mirror holds no OAuth app credentials
# (see docs/CALENDAR.md)
calendar:
  refresh_minutes: 10
```

## API Endpoints

| Endpoint                        | Description                                                            |
| ------------------------------- | ---------------------------------------------------------------------- |
| `GET /api/aviation/metar/:icao` | Current METAR with flight rules                                        |
| `GET /api/aviation/taf/:icao`   | Terminal aerodrome forecast                                            |
| `GET /api/aviation/tfrs`        | Active TFRs in area                                                    |
| `GET /api/aviation/astro`       | Sun/moon times for today                                               |
| `GET /api/schedule?days=7`      | Merged calendar-account events + XLSX flight duties                    |
| `GET /api/calendar/accounts`    | Connected calendar accounts (see [docs/CALENDAR.md](docs/CALENDAR.md)) |
| `GET /api/health`               | Service health check                                                   |

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
│   │       └── components/modules/  # One <Name>Module.tsx + .css per widget, registry in index.ts
│   ├── mobile/            # Expo phone app: setup, layout editor (widget catalog in lib/modules.ts)
│   └── presence/          # Python presence detection
│       ├── detector.py    # Presence/face detection (PM2: skyglass-detector)
│       ├── web_server.py  # Enrollment API + camera feed on :5000 (PM2: skyglass-admin)
│       └── admin_portal.py # Slim /admin page (WiFi, logs, password)
├── config/
│   ├── default.yaml       # Default configuration
│   ├── config.yaml        # Your settings (gitignored)
│   ├── pm2.config.cjs     # PM2 apps
│   └── systemd/           # skyglass-boot, -provision, -watchdog units
├── scripts/
│   ├── setup-pi.sh        # Raspberry Pi install
│   ├── update.sh          # Release updater
│   └── dev-setup.mjs      # npm run setup:dev
└── docs/
    └── HARDWARE.md        # Build guide with parts list
```

## Hardware

The bill of materials for a DIY build is
[docs/build-guide/SkyGlass-Bill-of-Materials.pdf](docs/build-guide/SkyGlass-Bill-of-Materials.pdf)
(about $645 in parts for the recommended 24" build; source `docs/build-guide/bom.html`,
rebuilt with `npm run docs:bom`). [docs/HARDWARE.md](docs/HARDWARE.md) covers the build:

- Frame assembly guide
- Electronics installation
- Mounting instructions

**Recommended setup:**

- Raspberry Pi 5 (4GB)
- Pi Camera Module 3
- 24" IPS Monitor
- Two-way mirror glass

## Scripts

```bash
npm run dev          # Start development servers (all packages)
npm run dev:mirror   # Backend + mirror UI only
npm run dev:admin    # Presence/admin server on :5000 (camera enrollment)
npm run dev:detector # Camera presence detector
npm run dev:e2e      # Everything incl. detector + Expo; mirror shows a QR for the phone app
npm run setup:dev    # Drive first-run setup locally (status | walkthrough | complete | reset | deps)
npm run build        # Build for production
npm run start        # Start production (PM2)
npm run test         # Run test suite
npm run update       # Check and apply updates
```

## Presence Detection Methods

| Method             | Speed   | Accuracy | Notes                                                                                                                                                      |
| ------------------ | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `face_recognition` | Slowest | Best     | YuNet finds faces, dlib encodings identify them; wakes only for enrolled users and reports who is present. Installed by `requirements.txt` (compiles dlib) |
| `opencv`           | Fastest | Basic    | OpenCV's bundled YuNet model; detects any face                                                                                                             |
| `auto`             | -       | -        | Default. `face_recognition` if installed, else `opencv`, and warns when it falls back to the any-face method                                               |

The detector reads the `presence:` block of `config/config.yaml` (over `config/default.yaml`) at startup and logs the effective settings; its CLI flags (`--method`, `--camera`, `--tolerance`, `--min-frames`, `--timeout`) override the YAML. Restart it after editing (`pm2 restart skyglass-detector`). Faces registered from the phone app are picked up without a restart. Tuning and diagnostics: [packages/presence/README.md](packages/presence/README.md).

## Deployment

### PM2 (Recommended)

```bash
npm run start        # Starts all services
pm2 status          # Check status
pm2 logs            # View logs (all apps)
pm2 save            # Save for auto-restart
```

PM2 apps: `skyglass-backend` (API + built display on port 3001; also advertises mDNS `_skyglass._tcp`), `skyglass-detector`, `skyglass-admin` (gunicorn `wsgi:app`, the presence server on port 5000). View one app's logs with e.g. `pm2 logs skyglass-backend`.

### systemd (Raspberry Pi)

PM2 runs the app processes. systemd only runs three helper units, all installed by `scripts/setup-pi.sh` from `config/systemd/`:

```bash
systemctl status skyglass-boot.service       # Boot mode: WiFi provisioning or normal start
systemctl status skyglass-provision.service  # WiFi provisioning via the SkyGlass-Setup hotspot
systemctl status skyglass-watchdog.service   # Watchdog
journalctl -u skyglass-watchdog -f
```

### Updating

Updates are installed from the `skyglass-vX.Y.Z.tar.gz` asset attached to each GitHub release (built by `.github/workflows/release.yml`; it contains the prebuilt `packages/backend/dist` and `packages/frontend/dist`). They come from `clioh/skyglass` by default; a fork sets `GITHUB_REPO=<owner>/<repo>` in the environment of the backend and of `scripts/update.sh`.

- **In the display UI**: _Download_ fetches the tarball, _Install Now_ hands it to `scripts/update.sh --apply-tarball` and returns immediately. The display shows "Update started, restarting…" and reloads itself once the backend is back on the new version.
- **From a shell**: `npm run update` (prompt), `./scripts/update.sh --check` (exit 0 if an update is available) or `./scripts/update.sh --apply` (no prompt). There is no automatic update timer.

Either way `scripts/update.sh` backs up the install to `.backup/`, stops the PM2 apps, copies the release over the install with `rsync`, runs `npm install` (and `npm run build` only if the tarball has no `dist/`), updates the presence venv if `requirements.txt` changed, and restarts the apps with `pm2 startOrRestart config/pm2.config.cjs`. If `/api/health` is not up within 120 s, or any step fails, it restores the backup and restarts the previous version. Runtime state is never touched: `config/config.yaml`, `data/`, `logs/`, `.env` files, `node_modules`, Python venvs and `packages/presence/face_data`. Progress and errors are written to `logs/update.log`.

`rsync` and `curl` are required; `scripts/setup-pi.sh` installs both.

## Development

See [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) for running the full setup pipeline on a laptop.

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

- Test presence detection: `npm run dev:detector` (runs `detector.py --preview`), or `cd packages/presence && venv/bin/python detector.py --log-level debug` for per-second diagnostics
- Check face enrollment: `ls packages/presence/face_data/users/`
- Verify camera permissions (Mac: System Settings > Privacy > Camera)

### High CPU usage

- Use `detection_method: opencv` (in the `presence:` block) instead of `face_recognition`; it wakes for any face

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
