# SkyGlass

A smart mirror built for pilots that displays aviation weather, flight schedules, and activates via presence detection.

**Website:** https://skyglass.dev

## Project Overview

SkyGlass is a smart mirror application designed for pilots. It displays:
- Real-time METAR/TAF with flight rules color coding (VFR/MVFR/IFR/LIFR)
- TFRs and NOTAMs for your area
- Google Calendar integration + airline schedule import
- Sun/moon times for VFR currency tracking
- Presence detection to wake/sleep the display

## Architecture

This is a monorepo using npm workspaces and Turborepo:

```
SkyGlass/
├── packages/
│   ├── backend/        # Node.js/Express API server (TypeScript)
│   ├── frontend/       # React display UI (Vite + TypeScript)
│   ├── mobile/         # React Native/Expo mobile app
│   ├── presence/       # Python presence detection (OpenCV, face_recognition)
│   ├── cloud-api/      # Cloud sync API (optional)
│   └── license-server/ # License validation server (optional)
├── config/             # Configuration files (yaml, nginx, systemd)
├── scripts/            # Setup and utility shell scripts
└── docs/               # Documentation
```

## Key Technologies

- **Backend:** Node.js, Express, TypeScript, SQLite (better-sqlite3)
- **Frontend:** React, Vite, TypeScript
- **Mobile:** React Native, Expo
- **Presence Detection:** Python 3, OpenCV, face_recognition, Flask/Gunicorn
- **Process Management:** PM2
- **Deployment:** Raspberry Pi, Docker, systemd

## Common Commands

```bash
npm run dev           # Start development servers
npm run build         # Build for production
npm run start         # Start production (PM2)
npm run test          # Run test suite
npm run lint          # Run ESLint
npm run format        # Run Prettier
```

## Configuration

- Main config: `config/config.yaml` (copy from `config/default.yaml`)
- Environment variables can override config values
- Key settings: airport ICAO code, location coordinates, presence detection method

## Services & Ports

| Service | Port | Description |
|---------|------|-------------|
| Backend API | 3001 | Node.js REST API |
| Frontend | 5173 | React UI (Vite dev server, `npm run dev` only; in production the backend serves the built UI on 3001) |
| Admin Portal | 5000 | Python Flask admin interface |
| mDNS | - | Advertises `_skyglass._tcp` for discovery |
| License Server | 3002 | Optional, separate deployment (`packages/license-server`) |
| Cloud API | 3003 | Optional, separate deployment (`packages/cloud-api`) |
| Website | 5174 | Marketing site dev server (`packages/website`, deployed to Vercel) |

## Key Directories

- `packages/backend/src/services/` - Aviation, calendar, astro services
- `packages/backend/src/routes/` - API endpoints
- `packages/frontend/src/components/` - React components and widgets
- `packages/presence/` - Python presence detection scripts
- `config/systemd/` - systemd service files (skyglass-*.service)
- `config/nginx/` - nginx configuration (skyglass.conf)

## Naming Conventions

- Service names: `skyglass-*` (e.g., skyglass-admin, skyglass-detector)
- mDNS hostname: `skyglass.local`
- mDNS service type: `_skyglass._tcp`
- WiFi provisioning SSID: `SkyGlass-Setup`
- Storage keys: `@skyglass:*`
- Bundle ID: `com.skyglass.app`

## Testing

```bash
npm test                              # All tests
npm test --workspace=packages/backend # Backend only
cd packages/presence && python -m pytest  # Python tests
```

## Deployment

- **Development:** `npm run dev`
- **Raspberry Pi:** `./scripts/setup-pi.sh`
- **Docker:** `docker compose up -d`
- **systemd:** `./scripts/install-systemd.sh`
