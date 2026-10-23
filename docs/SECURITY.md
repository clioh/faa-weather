# SkyGlass Security Model

SkyGlass is a mirror with a camera, often in a bedroom or bathroom. These rules
exist so that nobody else on the home network can watch the camera, change the
mirror's settings or take over its admin portal.

## Processes and ports

| Process | Port | Reachable from | Notes |
| ------- | ---- | -------------- | ----- |
| Backend (Node, `packages/backend`) | 3001 | LAN | Mirror UI, REST API, WebSocket. Every API route and the WebSocket need a trusted caller: the device itself (loopback), the internal token, or a paired phone. See "Port 3001". |
| Presence/admin server (Flask + gunicorn, `packages/presence/web_server.py` + `admin_portal.py`) | 5000 | LAN | Camera enrollment, enrolled faces, WiFi, logs, network admin portal. Every route except health/status/login needs one of the credentials below. |

Port 5000 stays bound to `0.0.0.0` (`gunicorn.conf.py`, `GUNICORN_BIND`)
because two LAN clients still need it directly: the phone app's live camera
preview during enrollment (`http://<mirror>:5000/video_feed?token=...`) and the
optional browser admin portal (`http://<mirror>:5000/admin`). Everything else
the phone does goes through the backend. Nothing on 5000 is usable without a
credential, so LAN reachability exposes no capability by itself. Set
`GUNICORN_BIND=127.0.0.1:5000` if you use neither.

There is no reverse proxy in front of port 5000. The server never trusts
"request came from loopback" or `X-Forwarded-For`: credentials are the only
thing that grants access.

## Credentials

### 1. Internal service token (backend <-> presence server)

- File: `data/internal-token` at the repo root (64 hex chars, mode 0600).
  `SKYGLASS_INTERNAL_TOKEN_FILE` overrides the path; set it for **both**
  processes or neither.
- Created on first use by whichever process needs it first (temp file + hard
  link, so a concurrent creator never sees a partial file or replaces the
  winner's token). A malformed file is refused, not replaced: delete it and
  restart both processes.
- Sent as the `X-SkyGlass-Internal` header and compared in constant time
  (`packages/presence/security.py`, `packages/backend/src/services/internal-token.ts`).
- Who sends it: the backend on every call to the presence server
  (`routes/device.ts`, `/api/registration/*` in `server.ts`), and the presence
  server on its notifications to the backend's internal-only
  `/api/registration/progress`, `/api/registration/guidance` and
  `/api/registration/complete`.
- Anyone who can read `data/` on the device has full control; that is the same
  as having a shell on it.

### 2. Admin session (network admin portal on :5000)

- The portal is **off** until an admin password exists. With no password,
  `/admin` and `/admin/login` show a page explaining how to enable it, and every
  device-control API answers 401 to anything but the internal token. There is
  no "no password = open" mode, and the first password cannot be set over the
  network.
- Set, reset or clear the password **on the mirror** (keyboard or SSH):

  ```bash
  cd ~/SkyGlass/packages/presence
  venv/bin/python set_admin_password.py          # prompts twice
  venv/bin/python set_admin_password.py --status
  venv/bin/python set_admin_password.py --clear  # turns the portal off again
  ```

  The backend could also set it through `POST /api/admin/password` with the
  internal token, but it deliberately exposes no route that does so: a
  paired phone should not be able to set the network admin password.
- Storage: `data/admin-password`, mode 0600, `scrypt$N$r$p$salt$hash`
  (N=2^15, r=8, p=1, 16-byte salt), verified with `hmac.compare_digest`. The
  old `salt:sha256` format is rejected; run the CLI to replace it. Minimum
  length 10 characters.
- Session cookie `skyglass_admin`: signed with a persistent key in
  `data/admin-session-secret` (0600), `HttpOnly`, `SameSite=Strict`, 12 h
  lifetime. The session is bound to a fingerprint of the stored hash, so
  changing or clearing the password signs every session out. Login clears any
  pre-existing session data.
- Login throttling: 5 failures per client address per 15 minutes, and 30
  failures from all clients per 15 minutes, lock login out (HTTP 429) until the
  window passes. The CLI always works.
- Changing the password from the portal requires the current password.

### 3. Enrollment token (camera)

- The camera stream and capture endpoints only work during an active
  enrollment session, with that session's token.
- Only the backend can start a session (`POST /api/start` on :5000 requires the
  internal token). The backend starts one when the phone or `npm run setup:dev`
  calls `POST /api/registration/start`, and immediately broadcasts the
  `registration` WebSocket event that puts the full-screen registration overlay
  on the mirror. A camera session therefore cannot start without the mirror
  showing it.
- The token is 32 random bytes (URL-safe), returned in the
  `/api/registration/start` response (`enrollmentToken`, `expiresAt`) and in
  the `registration` WebSocket events / `GET /api/registration` while active
  (the mirror's own overlay uses those to show the preview).
- Accepted as `?token=` on `/video_feed` (an `<img>` cannot send headers) and
  as the `X-SkyGlass-Enrollment` header on API calls. `Referrer-Policy:
  no-referrer` keeps it out of Referer headers.
- It expires when the session completes, is cancelled, or 10 minutes after it
  started, whichever is first. Starting a new session invalidates the previous
  token. `/video_feed` answers 403 without a valid token, and an open stream
  ends within one frame once the session ends. At most 3 streams run at once.

### 4. Paired phone token (port 3001)

- A phone pairs by proving it can see the mirror's screen (two flows below).
  It receives a bearer token **once**: `sgp_` + base64url(32 random bytes).
- Storage: `data/paired-devices.json` (0600, temp file + fsync + rename),
  `[{ id, name, tokenHash, createdAt, lastSeenAt }]`. Only the sha256 of the
  token is stored; lookups compare hashes in constant time. `lastSeenAt` is
  written at most once a minute. At most 20 phones. An unreadable file is
  moved aside (`paired-devices.json.corrupt-<ms>`) and every phone pairs
  again. `SKYGLASS_PAIRED_DEVICES_FILE` overrides the path.
- Sent as `Authorization: Bearer <token>` on HTTP (including image URLs the
  phone loads, via RN `source={{ uri, headers }}`), and as the WebSocket
  subprotocol `skyglass.token.<token>` (see below).
- Revoking a phone (`DELETE /api/pairing/devices/:id`, from any trusted
  caller, including that phone for "Unpair this phone") invalidates the token
  at once and closes that phone's open WebSockets (close code 4401).
- A phone can also revoke itself without knowing its id:
  `DELETE /api/pairing/devices/self` (device callers only; the mirror itself
  gets 400 `not_a_paired_phone`). Removing a mirror in the phone's My Mirrors
  list calls it (best effort, 3 s timeout), then deletes the stored token
  whether or not the mirror answered, then forgets the mirror. If the mirror
  was offline its record stays until someone removes it in Paired phones.

## Port 3001

### Trust classes

Code: `packages/backend/src/pairing/` (`trust.ts`, `middleware.ts`, `ws.ts`,
`service.ts`), routes in `routes/pairing.ts`.

1. **local**: the effective client address is loopback **and** the `Host`
   header names loopback (`localhost`, `127.x`, `[::1]`, `*.localhost`)
   **and** `Origin`, if sent, is a loopback page. Covers the kiosk Chromium
   (`http://localhost:3001`), the presence detector, `npm run setup:dev` and
   `curl` on the device. The Host/Origin rule stops DNS-rebinding and
   cross-site pages opened in a browser on the device from borrowing local
   trust.
2. **internal**: a valid `X-SkyGlass-Internal` header (credential 1).
3. **device**: a valid paired-phone bearer token (credential 4).

"Effective client address" is Express `req.ip` with `trust proxy:
'loopback'`: `X-Forwarded-For` is only honoured while the hop that added it
is loopback, and the rightmost untrusted hop wins. So a LAN client sending
`X-Forwarded-For: 127.0.0.1` itself stays a LAN client, and a LAN browser
that reaches the Vite dev server (:5173, whose `/api` and `/ws` proxies set
`xfwd: true`) is seen with its LAN address, not as local. WebSocket upgrades
never pass through Express; `effectiveClientIp()` applies the same rule and
is tested against `req.ip`.

### Deny by default

`app.use('/api', apiAuthGate(...))` is registered in `server.ts` before every
API route, so a route added later is protected without doing anything.
Untrusted callers get `401 { "error": "pairing_required", "message": "This
phone isn't paired with this mirror." }` on every `/api` path (including
unknown ones), except this allowlist (`PUBLIC_API_ROUTES`):

| Public route | Why |
| ------------ | --- |
| `GET /api/health` | reachability probe during discovery |
| `GET /api/discovery` | exactly `mirrorId`, `name`, `version`, `setupComplete`, `pairingRequired: true`; a test in `src/pairing/deny-by-default.test.ts` fails if a field is added |
| `POST /api/pairing/claim`, `/request`, `/complete` | pairing itself; rate limited |

Static frontend files (non-`/api`, production only) are public; they contain
no data. `src/pairing/deny-by-default.test.ts` imports the real `server.ts`,
walks every mounted route and asserts each non-allowlisted one answers 401
to an unauthenticated LAN client, and that the gate precedes all routes.

Inside the trusted set, a few routes narrow further: `GET /api/pairing/qr` is
local only (403 for a phone), `/api/registration/progress|guidance|complete` need the
internal token, `POST /api/registration/cancel` with
`source=presence-server` is only honoured with the internal token.

Every other route is open to all three trusted classes. A paired phone can
therefore do what the phone app does: change settings, manage calendars,
start a face enrollment (which always puts the full-screen overlay on the
mirror), manage enrolled faces, scan/join WiFi, manage licenses, trigger
software updates, unpair phones.

### Pairing flows

Both require seeing the mirror's screen.

**QR (primary).** The mirror (local) fetches `GET /api/pairing/qr` → `{ url,
expiresAt }` where `url` is the connect deep link plus `&pair=<secret>`:
`skyglass://connect?host=<ip>&port=3001&pair=<secret>`, or under
`npm run dev:e2e` (`SKYGLASS_DEV_APP_URL`) the Expo form
`exp://<ip>:8081/--/connect?host=<ip>&port=3001&pair=<secret>`. The secret
is 128 random bits, single use, and rotates every 10 minutes and right after a
claim; each rotation sends the WebSocket event `pairing { state:
'qr-rotated' }` to local sockets so the mirror re-fetches. The phone sends
`POST /api/pairing/claim { secret, deviceName }` → `{ deviceId, token,
mirror: { id, name } }`; a wrong or used secret gives `400 { error:
'invalid_pairing_code' }`.

**6-digit code (fallback, e.g. manual address).** `POST /api/pairing/request
{ deviceName }` → `{ requestId, expiresAt }` (2 minutes). One pending request
at a time; a new one replaces it. The backend wakes the display for the
code's lifetime (same hold as `POST /api/display/hold`) and sends
`pairing { state: 'show', code, deviceName, expiresAt }` to **local sockets
only**; the code never appears in an HTTP response. `POST
/api/pairing/complete { requestId, code }` → `{ deviceId, token, mirror }`.
A wrong code gives `400 { error: 'invalid_pairing_code', attemptsRemaining,
requestExpired }`; the 5th wrong code voids the request. Success, void and
expiry send `pairing { state: 'hide', result: 'paired' | 'failed' |
'expired', deviceName }` to local sockets. After 50 wrong codes from all
clients in 24 hours the code flow answers `429 { error: 'pairing_locked' }`
until the window passes (QR pairing keeps working), which bounds a
distributed guessing attack to about 50 guesses a day against a one-in-a-
million code, each of them visible on the mirror.

`expiresAt` is milliseconds since the epoch everywhere. `deviceName` is 1-60
characters without control characters, line separators or bidi overrides.

Rate limits: claim, request and complete share a limiter of 10 requests per
5 minutes per client address plus 60 per 5 minutes overall (local callers
are exempt), on top of the general 600 / 15 min `/api` limiter.

Other pairing routes (any trusted caller): `GET /api/pairing/whoami` →
`{ kind, deviceId }`; `GET /api/pairing/devices` → `{ devices: [{ id, name,
createdAt, lastSeenAt, current }] }`; `PATCH /api/pairing/devices/:id
{ name }` → `{ device }`; `DELETE /api/pairing/devices/:id` → 204;
`DELETE /api/pairing/devices/self` → 204 (paired phones only, else 400).

### WebSocket

Any path on 3001 upgrades (the mirror uses `/ws`). Before the handshake:
local callers are accepted; phones offer the subprotocols `['skyglass',
'skyglass.token.<token>']` and the server answers `Sec-WebSocket-Protocol:
skyglass` (it never echoes the token protocol). An offer without `skyglass`
gets 400, and an unauthenticated upgrade gets 401; both before upgrading.
Messages keep the `{ type, data, timestamp }` envelope. Events go to every
authenticated socket, except the `pairing` family, which only local sockets
receive. The server handles no inbound messages.

### Cloud relay

The optional cloud relay (`services/relay-client.ts`, handlers in
`routes/cloud.ts`) is an **outbound** WebSocket the mirror opens to
skyglass.dev with its relay token; commands (`getLayout`, `updateLayout`,
`getStatus`, `displayOn`, `displayOff`) run in-process and never pass
through the HTTP gate. Configuring the relay (`/api/cloud/*`) needs a
trusted caller.

## Who can call what on port 5000

| Route | Internal token | Admin session | Enrollment token | Nothing |
| ----- | :------------: | :-----------: | :--------------: | :-----: |
| `GET /api/health`, `GET /api/status` | yes | yes | yes | **yes** |
| `GET/POST /admin/login`, `GET /admin/logout` | | | | yes |
| `GET /admin` (page) | | yes | | |
| `GET /api/users`, `GET/DELETE /api/users/<id>/face` | yes | yes (+CSRF) | | |
| `GET /api/admin/wifi/status`, `/scan`, `POST /connect` | yes | yes (+CSRF) | | |
| `GET /api/admin/logs` | yes | yes | | |
| `POST /api/admin/password` | yes | yes (+CSRF, current password) | | |
| `POST /api/start` (open enrollment session) | yes | | | |
| `POST /api/capture`, `POST /api/reset` | yes | | yes (header) | |
| `GET /video_feed` | | | yes (query or header) | |

"Nothing" = no credential at all. Everything not listed answers 404.

### CSRF and CORS

Cookie-authenticated requests that change state (POST/PUT/PATCH/DELETE) must
carry `X-SkyGlass-Request: 1` **and** an `Origin` (or, without one, `Referer`)
whose host:port equals the request's `Host`. The portal's own JavaScript sends
the header; a cross-site page cannot add a custom header without a CORS
preflight, and the server never sends `Access-Control-Allow-*` headers, so
preflights fail and cross-origin reads are blocked. The login form needs the
same-origin check (no custom header). Internal-token calls are server to
server, carry no cookies and skip the check. Every response also sends
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and
`Cache-Control: no-store`.

### WiFi connect

SSID and passphrase are validated (SSID 1-32 bytes, passphrase empty or 8-63
printable ASCII) and handed to `wpa_cli` in hex/PSK form, so quotes or
newlines cannot inject extra `wpa_supplicant` directives. Nothing is written
to `/tmp`.

## Known gaps

- A paired phone is fully trusted (see "Port 3001"); there are no per-phone
  permissions. Remove a lost phone from Settings → Paired phones on another
  phone, or from the device (`curl -X DELETE
  http://localhost:3001/api/pairing/devices/<id>`).
- Anyone who can stand in front of the mirror can pair (that is the design:
  physical presence). Codes and the QR are only shown on the screen.
- The WiFi provisioning captive portal (`wifi_provisioning.py`) runs on an open
  `SkyGlass-Setup` hotspot only during first setup; anyone in radio range can
  use it while it is up.
- Traffic is plain HTTP on the LAN, so pairing secrets, phone tokens,
  enrollment tokens and the admin password are visible to someone who can
  sniff the network.
- Anything running on the mirror itself (any local process) is trusted on
  3001, as it already has the files in `data/`.

## Files

| File | Mode | Written by |
| ---- | ---- | ---------- |
| `data/internal-token` | 0600 | backend or presence server, first use |
| `data/admin-session-secret` | 0600 | presence server, first start |
| `data/admin-password` | 0600 | `set_admin_password.py` / portal password change |
| `data/paired-devices.json` | 0600 | backend, on pairing / rename / revoke / lastSeenAt (token hashes only) |
| `packages/presence/face_data/users/<id>/` | default | presence server (face encodings) |

`data/` is git-ignored. `SKYGLASS_DATA_DIR` moves the presence server's
session secret and password file (not the internal token; use
`SKYGLASS_INTERNAL_TOKEN_FILE` for that, nor the paired devices; use
`SKYGLASS_PAIRED_DEVICES_FILE`).
