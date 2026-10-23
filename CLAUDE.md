# SkyGlass

A smart mirror built for pilots that displays aviation weather, flight schedules, and activates via presence detection.

**Website:** https://skyglass.dev

## Project Overview

SkyGlass is a smart mirror application designed for pilots. It displays:

- Real-time METAR/TAF with flight rules color coding (VFR/MVFR/IFR/LIFR)
- TFRs and NOTAMs for your area
- Calendars (Google, Outlook/Microsoft 365, iCloud, CalDAV, ICS links) + airline schedule import
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
│   └── website/        # Marketing site + store, license API (Vercel)
├── config/             # default.yaml / config.yaml, PM2 config, systemd units
├── scripts/            # Setup and utility shell scripts
└── docs/               # Documentation
```

## Key Technologies

- **Backend:** Node.js, Express, TypeScript, SQLite (better-sqlite3)
- **Frontend:** React, Vite, TypeScript
- **Mobile:** React Native, Expo
- **Presence Detection:** Python 3, OpenCV, face_recognition, Flask/Gunicorn
- **Process Management:** PM2
- **Deployment:** Raspberry Pi (native install, PM2 + systemd); no Docker image

## Common Commands

```bash
npm run dev           # Start development servers (all packages)
npm run dev:mirror    # Backend + mirror UI only
npm run dev:admin     # Presence/admin server (:5000), needed for camera enrollment
npm run dev:detector  # Camera presence detector (with preview window)
npm run dev:e2e       # Everything + Expo; mirror shows a QR that opens the phone app pointed at it
npm run setup:dev     # First-run setup on a dev machine: status | walkthrough | complete | reset | deps
npm run build         # Build for production
npm run start         # Start production (PM2: config/pm2.config.cjs)
npm run update        # Check for / install a release update (scripts/update.sh)
npm run test          # Run test suite
npm run lint          # Run ESLint
npm run format        # Run Prettier
```

## Configuration

- Main config: `config/config.yaml` (copy from `config/default.yaml`)
- Environment variables can override config values
- Key settings: airport ICAO code, location coordinates, `presence:` block (read by `packages/presence/detector.py`; CLI flags override)
- Setup (WiFi, license, location, airport, face) happens only in the phone app

## Services & Ports

| Service          | Port | Description                                                                                                                                   |
| ---------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend API      | 3001 | Node.js REST API                                                                                                                              |
| Frontend         | 5173 | React UI (Vite dev server, `npm run dev` only; in production the backend serves the built UI on 3001)                                         |
| Presence / Admin | 5000 | Flask presence server (`packages/presence/web_server.py`, gunicorn `wsgi:app` in production): enrollment API, camera feed, slim `/admin` page |
| mDNS             | -    | Advertises `_skyglass._tcp` for discovery (from the backend, `services/mdns.ts`)                                                              |
| Website          | 5174 | Marketing site dev server (`packages/website`, deployed to Vercel; also hosts the license API, `api/license`)                                 |

## Key Directories

- `packages/backend/src/services/` - Aviation, calendar, astro services
- `packages/backend/src/routes/` - API endpoints
- `packages/backend/src/calendar/` - Calendar accounts (providers, sync engine, `data/calendar-accounts.json`); setup in `docs/CALENDAR.md`
- `packages/frontend/src/components/modules/` - Mirror widgets (one `<Name>Module.tsx` + `.css` per widget, registry in `index.ts`, shared chrome in `ModuleFrame.tsx`)
- `packages/mobile/lib/modules.ts` - Widget catalog (ids, sizes, settings); the frontend registry must list the same ids
- `packages/mobile/components/editor/` - Phone layout editor (drag/drop canvas, library and config sheets)
- `docs/LICENSING.md` - License activation contract: cloud API (`packages/website/api/license`), signed tokens, mirror states, fulfilment
- `docs/SECURITY.md` - Trust model: phone pairing tokens (port 3001 is deny-by-default, `src/pairing/`), internal token, admin password CLI, enrollment tokens
- `docs/CLOUD_SERVICE.md` - skyglass.dev functions holding all third-party keys (OAuth broker, NOTAM and stock proxies); mirror setting `skyglass_service`
- `docs/design/` - Glass Cockpit redesign: `DESIGN_SYSTEM.md` (tokens, components), `SCREENS.md` (route → mockup map), `IMPLEMENTATION_PLAN.md` (phased work), `mockups/*.dc.html` + `mockups/app.css` (reference markup for every app screen and the website). Mobile tokens live in `packages/mobile/lib/theme.ts`
- `docs/build-guide/` - Customer bill of materials: `bom.html` is the source, `SkyGlass-Bill-of-Materials.pdf` is built from it with `npm run docs:bom` (headless Chrome). `docs/HARDWARE.md` (assembly) refers to its part codes
- `docs/KIT_CARDS.md` - Kit SD cards: golden image from a reference Pi (`scripts/prepare-image.sh`), captured and written per kit with `scripts/flash-sd.sh` (license key + orientation files; `scripts/provision-sd.sh` issues keys)
- `docs/PRE_LAUNCH_CHECKLIST.md` - Open security, setup, device-testing and release items; keep it current
- `docs/WIDGETS.md` - Widget data endpoints (news, finance, weather, winds aloft, todos, photos) and the `data/` files they use
- `packages/presence/` - Python presence detection scripts
- `config/pm2.config.cjs` - PM2 apps: skyglass-backend (:3001, also serves the built mirror UI), skyglass-detector, skyglass-admin (:5000)
- `config/systemd/` - systemd units for skyglass-boot, skyglass-provision, skyglass-watchdog (installed by `scripts/setup-pi.sh`), and skyglass-firstboot (kit cards only, armed by `scripts/prepare-image.sh`)

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

## Local setup pipeline

The mirror shows a setup screen until `config/config.yaml` exists, the license is activated
(always true with `SKYGLASS_LICENSE=off`, which the `npm run dev*` scripts set) and a face is
enrolled (files under `packages/presence/face_data/`). `scripts/dev-setup.mjs` (`npm run setup:dev`)
drives those steps through the backend API so the whole flow can be tested without a Pi,
phone, or camera. Details: `docs/LOCAL_DEVELOPMENT.md`.

## Deployment

- **Development:** `npm run dev`
- **Raspberry Pi (only supported target):** `./scripts/setup-pi.sh` (native install; PM2 + the three systemd units). The mirror is at `http://skyglass.local:3001`
- **Updates:** in-app updater (display UI) or `./scripts/update.sh --check | --apply`
