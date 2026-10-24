# Local Development: Running the Whole Pipeline on a Laptop

SkyGlass is built for a Raspberry Pi with a camera, a phone app, and a WiFi
hotspot. None of that exists on a development machine, so this guide explains
what each piece of the first-run pipeline needs and how to drive it locally
with `npm run setup:dev`.

## What runs where

| Service                                 | Port | Started by                                 | Needed for                                                                    |
| --------------------------------------- | ---- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| Backend API + WebSocket                 | 3001 | `npm run dev`                              | everything                                                                    |
| Mirror UI (Vite)                        | 5173 | `npm run dev`                              | watching the display                                                          |
| Presence / admin server (Flask, camera) | 5000 | `npm run dev:admin`                        | camera-based face enrollment, `/admin` page                                   |
| Presence detector (OpenCV)              | -    | `npm run dev:e2e` / `npm run dev:detector` | real presence detection from the webcam; `dev:detector` adds a preview window |
| Website (incl. license API)             | 5174 | `npm run dev`                              | optional; not part of mirror setup                                            |
| Expo dev server (phone app, Metro)      | 8081 | `npm run dev:e2e`                          | running the phone app from source in Expo Go                                  |

`npm run dev:mirror` starts only the backend and the mirror UI.
`npm run dev:all` (`scripts/dev.sh`) starts the backend, UI, presence server
and the camera detector (which waits for registrations); `--simulate` skips the
detector. `npm run dev:admin` and `npm run dev:detector` run the Python
servers directly from `packages/presence/venv`.

## Environment variables

Read by the backend (`packages/backend/src`) and the mirror UI's Vite config. None are needed
for `npm run dev`; there is no `.env` file (nothing loads one). The `npm run dev*` scripts set
`SKYGLASS_LICENSE=off`. Variables marked _test_ exist so tests can point the backend at
throwaway files.

| Variable                          | Default                                   | What it does                                                                                   |
| --------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `PORT`                            | `3001`                                    | Backend port                                                                                   |
| `NODE_ENV`                        | -                                         | `production` serves the built mirror UI and allows the skyglass.dev CORS origins               |
| `SKYGLASS_SERVE_FRONTEND`         | -                                         | `1` serves `packages/frontend/dist` on the backend port outside production                     |
| `CORS_ALLOWED_ORIGINS`            | -                                         | Extra comma-separated CORS origins (`middleware/cors.ts`)                                      |
| `SKYGLASS_LICENSE`                | on                                        | `off` disables licensing (the mirror never shows the license screen)                           |
| `SKYGLASS_LICENSE_FILE`           | `/boot/firmware/skyglass-license.txt`     | Pre-flashed license key file                                                                   |
| `SKYGLASS_LICENSE_KEYFILE_MARKER` | `~/.skyglass/license-keyfile-used`        | Marks the key file as consumed                                                                 |
| `SKYGLASS_LICENSE_PUBLIC_KEY`     | embedded key                              | PEM (or base64 PEM) that license tokens are verified with                                      |
| `SKYGLASS_ORIENTATION_FILE`       | `/boot/firmware/skyglass-orientation.txt` | Pre-flashed orientation, used until `config.yaml` sets one                                     |
| `SKYGLASS_ADMIN_URL`              | `http://127.0.0.1:5000`                   | Presence/admin server the backend proxies to                                                   |
| `SKYGLASS_DEV_APP_URL`            | -                                         | Overrides the pairing QR link (`npm run dev:e2e` sets it so Expo Go opens the dev build)       |
| `GITHUB_REPO`                     | `clioh/skyglass`                          | Repository whose releases the updater installs                                                 |
| `GITHUB_API_BASE`                 | `https://api.github.com`                  | GitHub API base for the updater (_test_: a local fake)                                         |
| `SKYGLASS_UPDATE_TEMP_DIR`        | `.update-temp/`                           | Where the updater downloads releases                                                           |
| `SKYGLASS_UPDATE_CONFIG_FILE`     | `data/update-config.json`                 | Update settings saved from the phone (_test_)                                                  |
| `SKYGLASS_DB_FILE`                | `data/skyglass.db`                        | SQLite database (_test_)                                                                       |
| `SKYGLASS_SCHEDULE_FILE`          | `data/flight-schedule.xlsx`               | Imported airline schedule (_test_)                                                             |
| `SKYGLASS_PAIRED_DEVICES_FILE`    | `data/paired-devices.json`                | Paired phones (_test_; see `SECURITY.md`)                                                      |
| `SKYGLASS_INTERNAL_TOKEN_FILE`    | `data/internal-token`                     | Backend ↔ presence server token; set it for both processes (see `SECURITY.md`)                 |
| `SKYGLASS_NO_LISTEN`              | -                                         | `1`: importing `server.ts` starts nothing and doesn't listen (_test_, HTTP route tests)        |
| `VITE_BACKEND_URL`                | `http://localhost:3001`                   | Where the Vite dev server (5173) proxies `/api` and `/ws` (`packages/frontend/vite.config.ts`) |

## How the setup screen decides what to show

The mirror UI polls `GET /api/setup/status` every two seconds while on the
setup screen. The backend derives that status from files (and, for the license,
its database); the response is camelCase (`wifiConfigured`, `orientationConfigured`,
`licenseActivated`, `locationConfigured`, `airportConfigured`, `faceEnrolled`,
`setupComplete`, `step`). Steps in order (`routes/setup.ts`, `computeSetupStatus`):

| Step        | Satisfied when                                                                                                                            | Written by (on a Pi)                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| WiFi        | `packages/presence/face_data/.wifi_configured` exists                                                                                     | `wifi_provisioning.py` after joining a network |
| Orientation | `config/config.yaml` lists `orientation` under `setup.completed`, or `config/config.yaml` exists at all (mirrors set up before this step) | phone app via `POST /api/setup/orientation`    |
| License     | the license is activated (always, with `SKYGLASS_LICENSE=off`, which the `npm run dev*` scripts set)                                      | phone app via `POST /api/license/key`          |
| Location    | `config/config.yaml` lists `location` under `setup.completed`                                                                             | phone app via `POST /api/setup/location`       |
| Airport     | `config/config.yaml` lists `airport` under `setup.completed`                                                                              | phone app via `POST /api/setup/airport`        |
| Face        | `face_data/users/<id>/encodings.pkl` (one encoding per sample; empty only if face_recognition was missing) exists                         | presence server after a capture session        |

The display leaves the setup screen once `config/config.yaml` exists, the
license is activated and a face is enrolled. The phone app follows `step` (the
first incomplete one) and so insists on the WiFi step first, which is why the
tool can mark it done. Setup happens only in the phone app (or this tool);
there is no browser setup wizard.

When setup writes `config/config.yaml`, the backend reloads it, pushes a
`config` WebSocket message to the UI, and refreshes METAR/TAF, so a new airport
shows up without restarting anything.

## The setup tool

```bash
npm run setup:dev -- status        # what the mirror/phone see, which services are up
npm run setup:dev -- walkthrough   # reset, then advance one step at a time with pauses
npm run setup:dev -- complete      # do every step at once
npm run setup:dev -- reset         # back to the setup screen
npm run setup:dev -- help          # everything else
```

Each step talks to the running backend through the same endpoints the phone
uses. If the backend is down, the tool writes the same files the backend reads
and says so.

Individual steps:

```bash
npm run setup:dev -- wifi                          # or: wifi --clear
npm run setup:dev -- airport KPAO
npm run setup:dev -- orientation portrait-cw --preview   # mirror turns and shows "This way up?"
npm run setup:dev -- orientation landscape         # save (portrait-cw | portrait-ccw | landscape)
npm run setup:dev -- location 37.4611 -122.1150 America/Los_Angeles
npm run setup:dev -- face --name "Dev Pilot"       # simulated enrollment, no camera
npm run setup:dev -- face --camera --name "Dev Pilot"   # real capture via the presence server
npm run setup:dev -- presence on | off | toggle    # wake / sleep the display
```

A pre-flashed kit can carry its orientation in `/boot/firmware/skyglass-orientation.txt`
(`portrait-cw`, `portrait-ccw` or `landscape`), used until `config/config.yaml` sets
`display.orientation`. To try it, point `SKYGLASS_ORIENTATION_FILE` at a file of your own
before starting the backend and the detector. The detector also turns camera frames to match
(`presence.camera_rotation`, `packages/presence/rotation.py`).

### Watching it happen

Open http://localhost:5173 next to your terminal and run the walkthrough. The
screen first turns to portrait and shows the "This way up?" orientation check,
turns back once the orientation is saved, then moves from "Location Setup" to
"Airport Setup" to "Face Registration" to "Setup Complete", then switches to
the live mirror with the chosen airport.
`presence on` wakes the display and shows the greeting for the enrolled user.
`presence off` reports absence; the picture fades out at once, and the panel
powers off `display.presence_timeout` seconds later (`config/config.yaml`, 120 by default).

## Face enrollment: three ways

1. **Simulated** (`face` without `--camera`). Writes an empty encodings file
   under `face_data/users/<id>/` and creates the user in the backend database.
   Nothing can recognise your face, but every downstream feature that keys on
   an enrolled user (greeting, per-user layouts, presence with `userId`) works.

2. **Real capture from this machine** (`face --camera`). Requires the presence
   server (`npm run dev:admin`) and a webcam. The tool does exactly what the
   phone does: `POST /api/registration/start`, then one
   `POST /api/registration/capture` per sample while the mirror shows the
   capture overlay and instructions. Each sample is located with YuNet and
   encoded with face_recognition; a sample that cannot be encoded is retried
   rather than counted. If face_recognition is missing (it is in
   `requirements.txt`), the record is written without encodings and detection
   falls back to `opencv` mode, which wakes the mirror for any face.

3. **From the phone app** (Expo). Start the backend with `npm run dev`, run
   `npx expo start` in `packages/mobile`, and use "Enter IP manually" with
   your laptop's LAN address. The backend advertises `_skyglass._tcp` over
   Bonjour, so automatic discovery also works when phone and laptop share a
   network. Run `setup:dev wifi` first so the app skips its WiFi step, which
   talks to the Pi's setup hotspot (`packages/presence/wifi_provisioning.py`
   on `10.42.0.1:80`) and only works on the Pi. The app is a dev build, not
   Expo Go: after a native dependency changes (for example
   `react-native-webview`, which renders the camera preview), rebuild it
   once with `npm run ios` or `npm run android` in `packages/mobile`.

The presence server has no enrollment page of its own: camera sessions are
opened only by the backend (`POST /api/registration/start` with a `userId`;
it calls the presence server's `/api/start`, then `/api/capture` per sample,
and the face lands in `face_data/users/<userId>/`). The backend calls it with the
internal service token in `data/internal-token` (created automatically on
first use by either process) and shows the capture overlay on the mirror. The
camera stream (`/video_feed?token=...`) only works with that session's
enrollment token and for at most 10 minutes. Trust model: `docs/SECURITY.md`.

### Admin portal (port 5000)

`http://localhost:5000/admin` is off until an admin password is set on the
machine running the presence server:

```bash
cd packages/presence
venv/bin/python set_admin_password.py          # prompts; --status, --clear
```

The password hash and the session key live in `data/` (mode 0600), shared
with the backend's database and the internal token. `npm run setup:dev -- reset`
does not touch them; delete `data/internal-token` only with both servers
stopped.

## Presence detection

- **No camera:** `setup:dev presence on|off`. This is what `detector.py` posts.
- **Webcam:** `npm run dev:detector`, also started by `npm run dev:e2e`.
  Recognises enrolled users with `face_recognition` and picks up new
  registrations while running. It reads the `presence:` block of
  `config/config.yaml` (CLI flags override; `dev:e2e` passes `--camera`
  only when `CAMERA_INDEX` is set) and logs the effective settings at startup.
  Troubleshooting: `packages/presence/README.md`.
- **Python environment:** `npm run setup:dev -- deps` creates
  `packages/presence/venv`, installs `requirements.txt`, and checks that the
  camera opens. The first install compiles dlib (needs cmake; several
  minutes). On macOS the terminal app must be allowed to use the camera
  (System Settings > Privacy & Security > Camera).

## Pairing (who may call port 3001)

The backend trusts three kinds of caller (docs/SECURITY.md, "Port 3001"):
anything on the same machine over loopback, the presence server (internal
token), and paired phones (bearer token). Everything else gets
`401 pairing_required`, except `/api/health`, `/api/discovery` and the
pairing endpoints.

What that means on a dev machine:

- `curl http://localhost:3001/...`, `npm run setup:dev`, the presence
  detector and the mirror tab at `http://localhost:5173` (or `:3001`) work
  as before. Use `localhost` / `127.0.0.1`: `curl http://<your-LAN-IP>:3001`
  from the same laptop arrives from the LAN address and is **not** local.
- The Vite proxy forwards the browser's address (`xfwd`), so opening the
  mirror UI from another computer (`http://<laptop-ip>:5173`) gets 401s and
  shows no data (a browser cannot pair); view the mirror on the laptop itself.
- `npm run dev` / `dev:mirror`: the QR is the production link,
  `https://skyglass.dev/connect#h=<ip>&p=3001&m=<mirror name>&pair=<secret>`
  (origin from `skyglass_service`), which opens an installed store or
  TestFlight build through Universal Links / App Links, not Expo Go.
- `npm run dev:e2e`: the QR on the mirror's setup screen (and the one printed
  in the terminal) is `exp://<ip>:8081/--/connect?host=<ip>&port=3001&pair=<secret>`;
  scanning it opens Expo Go and pairs the phone in one step. The secret is
  single use and rotates every 10 minutes, so the terminal copy goes stale;
  the mirror screen always shows the current one
  (`curl -s localhost:3001/api/pairing/qr`).
- `npm run dev:e2e -- --device`: for an iPhone on USB, when the LAN is too slow
  for Metro. It builds the app (Release, so the JS bundle is embedded) with
  `xcodebuild`, installs it over USB with `devicectl`, skips Metro, and the QR
  becomes `skyglass://connect?...`, which opens the installed app. The build
  sets `EXPO_PUBLIC_SKYGLASS_DEV_BUILD=1` (`packages/mobile/lib/devBuild.ts`),
  so `--reset` and the dev screens still work. API calls still go over the network; JS changes need
  another run (`--no-build` reuses the last install). Needs Developer Mode on
  the phone and an Apple Development certificate.
- A phone that is not paired (manual address, mirrors list) is sent to the
  Pair screen and pairs with the 6-digit code the mirror shows.

### Calling the API from another machine

Pair a "device" for your shell with the code flow. The code only appears on
the mirror screen (or to a local WebSocket client), never in an HTTP
response:

```bash
MIRROR=http://192.168.1.20:3001
curl -s -H 'Content-Type: application/json' \
  -d '{"deviceName":"dev laptop"}' $MIRROR/api/pairing/request
# → {"requestId":"…","expiresAt":…}; read the 6 digits off the mirror
curl -s -H 'Content-Type: application/json' \
  -d '{"requestId":"<requestId>","code":"<6 digits>"}' $MIRROR/api/pairing/complete
# → {"deviceId":"…","token":"sgp_…","mirror":{…}}  (the token is shown once)
export SKYGLASS_TOKEN=sgp_…
curl -s -H "Authorization: Bearer $SKYGLASS_TOKEN" $MIRROR/api/config
SKYGLASS_BACKEND_URL=$MIRROR npm run setup:dev -- status   # setup:dev sends SKYGLASS_TOKEN
```

No screen handy (headless Pi, SSH)? Watch for the code on the mirror itself
with a local WebSocket client, e.g. from `packages/backend`:
`node -e "const W=require('ws');new W('ws://localhost:3001/ws').on('message',m=>{const x=JSON.parse(m);if(x.type==='pairing')console.log(x.data)})"`.

Paired devices live in `data/paired-devices.json` (token hashes only).
List them with `curl -s localhost:3001/api/pairing/devices`, remove one with
`curl -X DELETE localhost:3001/api/pairing/devices/<id>`; deleting the file
unpairs everything. The WebSocket from another machine needs the token as a
subprotocol: `new WebSocket(url, ['skyglass', 'skyglass.token.' + token])`.

## Resetting

`npm run setup:dev -- reset` removes `config/config.yaml`, the WiFi flag, all
enrollments under `face_data/`, the users in the backend database and the
paired phones, after listing what it will delete. Pass `--yes` to skip the
prompt, `--keep-config` to keep the airport and location and `--keep-phones`
to keep pairings. Reload the mirror tab afterwards: the live mirror does not
poll setup status.

The phone app keeps its own state (profile, linked mirrors, onboarding
progress, pairing tokens). To start over from registration on both sides:

```bash
npm run dev:e2e -- --reset
```

This resets the mirror as above and adds `&reset=<nonce>` to the QR deep link.
The first scan of that QR wipes the app's data (`packages/mobile/lib/devReset.ts`:
all `@skyglass:*` keys, pairing tokens, cloud sign-in) and opens onboarding.
Later scans in the same run don't wipe again. Dev builds also have **Settings →
Reset App Data (dev)**, which does the same on the phone only. No need to
reinstall Expo Go.

## Troubleshooting

- **Mirror stays on the setup screen after `complete`.** Run
  `setup:dev status`; it shows which step is still unsatisfied and whether the
  backend's view matches the files. The backend must be running from this
  checkout, since it resolves `config/` and `face_data/` relative to its own
  source.
- **`face --camera` fails with "Presence server unreachable".** Start it with
  `npm run dev:admin`. The backend only talks to `SKYGLASS_ADMIN_URL`
  (default `http://127.0.0.1:5000`).
- **Captures are rejected with "Center your face in the box".** The face
  check wants one face, roughly centred, at least 120 px wide in a 640x480
  frame. Move closer and improve lighting.
- **The phone cannot find the mirror.** Use manual IP entry with the laptop's
  LAN address and port 3001, and check that both devices are on the same
  network (mDNS does not cross VLANs or guest networks).
- **`401 pairing_required`.** The caller is not on this machine and has no
  paired token. From the laptop use `localhost`, not its LAN IP; from
  elsewhere pair first (see "Pairing"). A phone gets the Pair screen.
- **The mirror tab shows nothing when opened from another computer.** Expected:
  only the mirror itself (loopback) is trusted. Open it on the laptop.
- **`python -m pytest` in `packages/presence` hangs.** It is collecting
  `test_camera.py`, which opens the webcam. `pytest.ini` limits collection to
  `tests/`; run from the package directory so it is picked up.

## Airport search data

The setup airport search runs against `packages/backend/data/airports.json`: every
station the Aviation Weather Center serves METARs for that has a 4-letter ICAO code,
with names and cities from OurAirports. Regenerate it with:

```bash
npm run data:airports
```

The generator (`scripts/build-airports.mjs`) needs network access and takes a few
seconds. The file is checked in so a fresh clone works offline.
