# Pre-launch checklist

Everything that still has to happen before SkyGlass ships to customers. Items are grouped by
who has to act and roughly ordered by risk within each group. Tick them off as they land.

Last reviewed: 2026-10-21, after the calendar sign-in work, moving API keys to the cloud and hardening the presence server.

## 1. Security blockers

- [x] **Lock down the presence server (port 5000).** Done 2026-10-21; the trust model is in `docs/SECURITY.md`.
      Device routes need the backend's internal token (`data/internal-token`) or an admin login.
      The admin login only exists after a password is set on the device with
      `packages/presence/set_admin_password.py`. The camera feed only streams during a visible
      enrollment session with a short-lived token. Passwords use scrypt, and the portal has CSRF
      checks and a login lockout.
- [x] **Protect the mirror API (port 3001) with phone pairing.** Done 2026-10-21; details in
      `docs/SECURITY.md`. Every API route and the WebSocket deny by default. Only the mirror's own
      screen and local scripts, the presence server (internal token) and paired phones get in.
      Phones pair by scanning the QR on the mirror's setup screen or by entering a 6-digit code the
      mirror shows. A test fails if any newly added route is left unprotected.
- [x] **Trim the public discovery endpoint.** Done 2026-10-21. It returns only the mirror id, name,
      version, `setupComplete` and `pairingRequired`, and a test pins that list.
- [x] **Move third-party keys off the mirror.** Done 2026-10-21. The FAA NOTAM and Finnhub keys
      now live only on Vercel, behind `/api/data/notams`, `/api/data/stocks` and
      `/api/data/stock-profiles` (see `docs/CLOUD_SERVICE.md`). The mirror has no API keys at all;
      its only cloud setting is `skyglass_service`.
- [ ] **Rate-limit the cloud service for real.** The limits in `packages/website/api/_lib/` apply per
      server instance, so the real cap is higher. Add Vercel firewall rules on `/api/oauth/*` and
      `/api/data/*`. Anyone who finds the data endpoints can spend SkyGlass's FAA and Finnhub quota,
      and CDN caching only softens that.
- [ ] **Get a Finnhub plan that allows redistribution.** The free tier is for personal use and about
      60 calls a minute. Serving every customer from one key needs a commercial licence, or a
      different quote provider.
- [ ] **Check the FAA NOTAM API terms** for one application proxying for a commercial product, its
      rate limits, and whether the mirror must show a "not for flight planning" notice. The FAA is
      moving to the NOTAM Management System API, which will need code changes. The current
      endpoint path and response shape came from third-party documentation and are untested.

## 2. Cloud and account setup (calendar sign-in, NOTAMs, stocks)

Details are in `docs/CALENDAR.md` and `docs/CLOUD_SERVICE.md`.

- [ ] **Create the Google OAuth client.** Type "Web application", authorized redirect URI
      `https://skyglass.dev/oauth/google`, scopes `openid`, `email` and `calendar.readonly`.
- [ ] **Start Google's verification for `calendar.readonly`.** It is a sensitive scope. Until it is
      verified, only listed test users can sign in, and they see an "unverified app" warning.
      Verification needs a privacy policy, a homepage on the verified domain and a demo video, and
      it can take weeks, so start early.
- [ ] **Create the Microsoft Entra (Azure) app registration.** It must accept personal and
      work/school accounts, with "Allow public client flows" turned on and delegated `Calendars.Read`,
      `User.Read` and `offline_access`.
- [ ] **Get FAA NOTAM API credentials** (client id and secret) from the FAA API portal.
- [ ] **Set the Vercel environment variables** on the website project: `GOOGLE_CLIENT_ID`,
      `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `FAA_NOTAM_CLIENT_ID`,
      `FAA_NOTAM_CLIENT_SECRET`, `FINNHUB_API_KEY`. `GOOGLE_REDIRECT_URI`, `MICROSOFT_TENANT` and
      `FAA_NOTAM_API_URL` are optional.
- [ ] **Deploy the website.** Until it is deployed, Google and Outlook sign-in show as unavailable on
      every mirror, NOTAMs are empty, and stocks fall back to Yahoo.
- [ ] **Choose the canonical domain.** `skyglass.dev` redirects to `www.skyglass.dev` today. The mirror
      handles that one hop, but `skyglass_service` in `config/default.yaml` and the Google redirect
      URI should name the domain you keep.
- [ ] **Smoke-test the deployed service:** `GET /api/oauth/config` lists both providers,
      `/api/data/notams?icao=KSAN` and `/api/data/stocks?symbols=AAPL` return data, none of the
      `/api/oauth/*` or `/api/data/*` responses carry `Access-Control-Allow-Origin`, and
      `/oauth/google` serves the return page.

## 2b. Licensing setup (see `docs/LICENSING.md`)

- [ ] **Generate the signing keypair** with `node scripts/license-keygen.mjs`. Set the private line as
      `LICENSE_SIGNING_KEY` on Vercel and paste the public key into
      `packages/backend/src/license/public-key.ts`. Until then the mirror rejects every activation:
      the committed key is a placeholder.
- [ ] **Create the Neon database**, set `DATABASE_URL` on Vercel, and run
      `npm run db:migrate --workspace=packages/website` once.
- [ ] **Set `LICENSE_MANAGE_SECRET`** (`openssl rand -hex 32`) and allow the `licenses@skyglass.dev`
      sender in Resend.
- [ ] **Subscribe the Stripe webhook** to `payment_intent.succeeded`, `payment_intent.payment_failed`,
      `charge.refunded`, `refund.updated` and `charge.dispute.created`, so refunds and chargebacks revoke
      licenses (see "Refunds and disputes" in `docs/LICENSING.md` for the support runbook).
- [ ] **Review the drafted refund policy** in `packages/website/src/pages/Terms.tsx` (Refunds & Returns,
      Hardware Warranty) and confirm the kit lead time ("Ships in 2–3 weeks" in `Pricing.tsx`).
- [ ] **Confirm the Stripe tax code for the Software License.** Every item uses `txcd_99999999` (general
      tangible goods); downloadable software is usually taxed differently by state. Per-product codes
      would live in `packages/website/shared/catalog.ts`.
- [ ] **Remove the old `license:` block from existing `config/config.yaml` files.** `key` and `serverUrl` are
      ignored now, and `enabled: false` there turns licensing off.
- [ ] **Test on a Pi:** pre-flashed key file (`scripts/provision-sd.sh`) activates on first boot; entering a
      key in the app; a release from skyglass.dev/license moves the mirror to the "released" screen at its next
      refresh; unplugging the network keeps the mirror running.

## 3. Test on real hardware

None of the work below has run on a phone or a Raspberry Pi yet. Everything typechecks, lints,
passes unit tests and was reviewed, and the mirror was rendered in headless Chrome.

**Phone app** (do this first, on both iOS and Android, with a fresh dev build: `npx expo run:ios` / `run:android`)
- [ ] Run `npm install` first. Dependencies changed: `expo-image-manipulator` was added,
      `expo-auth-session` and `@react-navigation/native` were removed.
- [ ] Layout editor: drag, resize, collisions, undo/redo, the add-widget sheet, the discard prompt,
      and haptics. Check the keyboard behaviour in the widget settings sheet.
- [ ] Photo frame: upload several large photos. They should arrive at 2560 px or less on the long
      side and display correctly rotated.
- [ ] Calendars, one round trip per provider:
  - [ ] Google, in both a dev build (`skyglass://`) and Expo Go (`exp://`), on iOS and Android.
  - [ ] Microsoft code sign-in: the code is readable and can be copied, and the code countdown works.
  - [ ] iCloud with an app-specific password. Check that iOS doesn't offer to autofill the real
        Apple ID password.
  - [ ] A calendar link (Google secret iCal address, iCloud public link, a crew-scheduling feed).
  - [ ] Reconnect after revoking access, remove an account, turn calendars on and off, change colours.
- [ ] Sheets and modals: iOS page sheets can't be dismissed by swiping in React Native 0.86. Confirm
      every sheet has a visible close button.

**Mirror on a Raspberry Pi**
- [ ] **Camera Module 3 on a Pi 5** (`packages/presence/cameras.py`, Picamera2 through the venv's
      `--system-site-packages`): `pm2 logs skyglass-detector` shows `Camera 0 opened: Raspberry Pi
      camera imx708 via libcamera`, presence wakes the mirror, and autofocus settles at arm's length.
      Then repeat with only a USB webcam connected (`USB camera /dev/videoN via OpenCV`).
- [ ] **Camera hand-off during face registration.** Register a face from the phone while the
      detector runs: the detector logs `Camera lent to face registration`, the preview streams, and
      `Camera back from face registration` follows when the session ends or expires. Check that
      `/api/registration/start` answers within the backend's 5 s timeout, and that killing
      skyglass-admin mid-session gives the camera back (stale claim in `data/camera-claim.json`).
- [ ] **Display sleep** (`packages/backend/src/services/display.ts`): `pm2 logs skyglass-backend`
      shows `Display control: Wayland output HDMI-A-1 (wlr-randr)` with a monitor, or `HDMI-CEC`
      with a TV. Walk away: the monitor goes to sleep and wakes when you come back, and the Chromium
      kiosk is still full screen afterwards. Also test with the backend started before the desktop
      session (it re-probes every 30 s).
- [ ] **Fresh install on current Raspberry Pi OS** (Trixie, and Bookworm if you support it), both a
      desktop and a Lite image: `scripts/setup-pi.sh --yes` finishes without apt errors, and after
      the reboot the Pi logs in to labwc and `scripts/kiosk.sh` shows the mirror full screen with no
      panel, no mouse pointer and no keyring prompt. Kill Chromium and check that it comes back,
      leave it idle for an hour and check that the screen never blanks, and confirm that
      `raspi-config nonint do_wayland W3` and `do_boot_behaviour B4` exist on that image.
- [ ] **Re-check BOM prices and kit pricing before launch.** The Pi 5 4 GB went from $60 to $110
      (Apr 2026); the recommended DIY build is about $645 in parts at retail, against the $549
      Complete Kit. Update the edition date in `bom.html` and run `npm run docs:bom`.
- [ ] Rendering performance with a busy layout: radar animation, photo crossfade, clocks.
- [ ] Live data through the deployed cloud service: NOTAMs, stocks via Finnhub, and stocks with the
      service unreachable (Yahoo fallback; Yahoo throttles per IP and the widget then shows
      "unavailable" for about 10 minutes).
- [ ] Pairing on real phones: scan the setup-screen QR in a dev build and in Expo Go; pair a
      second phone with the on-screen code while the mirror display is asleep; enter a wrong code
      and check the tries-left message; remove a phone in Paired phones and confirm it is signed
      out at once; set up a mirror through the `SkyGlass-Setup` hotspot and confirm the phone pairs
      when the mirror joins home WiFi. Check that photos load on Android, because they need an
      auth header.
- [ ] Unlink a mirror in My Mirrors with the mirror online: the phone disappears from Paired
      phones on another phone (or the mirror's `data/paired-devices.json`) at once. Then unlink one
      while the mirror is off or unreachable: removal finishes within about 3 seconds with no
      error, and the phone's record is still listed on the mirror until removed there.
- [ ] Security on the device: run `set_admin_password.py` and log in to `/admin` from another
      machine; confirm `/video_feed` and the device routes refuse requests without a token; enroll a
      face from the phone and confirm the preview stops when the session ends; join WiFi with an
      SSID and passphrase containing quotes and spaces.
- [ ] A calendar-heavy week: recurring events, all-day and multi-day events, and time zone
      boundaries against the mirror's `location.timezone`.
- [ ] Reset the local mirror layout. It was overwritten with a test layout during development.

**Portrait mounts** (`display.orientation`, the app's Orientation step)
- [ ] **Rotation direction.** Mount the panel turned right (clockwise, seen from the front), pick
      "Portrait · Turned right" in the app and check that the arrow points up; then turned left.
      If either is upside down, swap the angles in `packages/frontend/src/orientation.ts`
      (`uiRotation`) and `packages/presence/rotation.py` (`ORIENTATION_ROTATION`) together.
- [ ] **Camera upright.** On each portrait mount, `pm2 logs skyglass-detector` shows `Camera frames
      rotated …`, presence wakes the mirror, a face registers, and the live feed on the
      registration screen is upright. A camera mounted apart from the panel needs
      `presence.camera_rotation` instead. Change the orientation from Settings › Mirror while the
      detector runs: it follows within about 5 s with no restart.
- [ ] **Rotated UI performance.** On a landscape HDMI output with a portrait setting the whole UI is
      turned in CSS. Check that the radar, photo crossfade and clocks stay smooth in Chromium on a
      Pi 5, and that text stays sharp.
- [ ] **Pre-flashed orientation.** Write `portrait-cw` to `/boot/firmware/skyglass-orientation.txt`
      on a fresh card: the hotspot screen comes up the right way up on first boot, and the app's
      Orientation step starts on "Turned right".
- [ ] **Hands-free face capture** (`packages/presence/auto_capture.py`). Register a face on the
      Pi with only the Start button: each photo is taken after about a second of holding still, the
      hints ("Move a little closer", "Turn a little further", "Now turn the other way") match what
      you do, the two turn steps need opposite sides, and the smile step fires on a natural smile.
      Tune the constants at the top of `auto_capture.py` (hold, steadiness, cooldown, yaw, pitch,
      smile, patience) from what you see, including with glasses, in dim light and at 1–2 m. Then
      check that "Take photo now" on the phone counts down and takes exactly one photo, and that
      the enrolled face is recognised afterwards.
- [ ] Run the app's Orientation step on a real phone (iOS and Android): previews follow each tap,
      Back returns the mirror to the saved orientation, and Settings › Mirror › Orientation saves.

## 4. Repository and release hygiene

- [ ] **Commit the work in reviewable pieces.** The working tree holds the release-prep pass,
      the widget/editor overhaul and calendar sign-in, about 200 files. Suggested split: backend
      services, mirror widgets, phone editor, calendar (backend + app + website), docs.
- [x] **Rename the workspace packages.** Done 2026-10-21: backend, frontend, cloud-api and
      license-server are now `@skyglass/*` (turbo filters in the root `package.json` updated).
- [ ] **Rename the git remote.** It is still `clioh/faa-weather`. The README uses a `<your-fork>`
      placeholder until there is a public repository URL.
- [x] **Regenerate `packages/website/package-lock.json`.** Done 2026-10-21. Vercel installs
      `packages/website` on its own (`.npmrc` has `workspaces=false`), and a clean `npm ci && npm run build`
      there failed three ways, all fixed: `react-helmet-async` 2 rejected React 19 (now 3.0.0),
      `@types/node` came only from the monorepo root (now a website devDependency), and `stripe` floated
      to a release whose pinned API version no longer matched `api/_lib/stripe.ts` (now pinned to 20.2.0).
- [ ] **Check the Stripe webhook version.** The payload shape follows the API version set on the
      Dashboard webhook endpoint, not the SDK pin. The SDK is pinned to `stripe@20.2.0` with
      `apiVersion: '2025-12-15.clover'`; set the webhook endpoint to the same version.
- [x] **Add HTTP-level tests for the newer routes.** Done 2026-10-21: `routes/widgets.http.test.ts`
      and `routes/calendar.http.test.ts` run news, finance, weather, to-dos, photos, calendar and
      schedule through the real route stack. They found that a corrupt XLSX upload replaced the loaded
      schedule with nothing; that now returns 400 and keeps the schedule.
- [x] **Close the SSRF guard's timing gap.** Done: `safeFetchText` now connects through an undici
      Agent whose `lookup` checks every resolved address and dials only those, on every redirect hop.
- [ ] **Remove leftover keys from existing installs.** `widgets:`, `notam_api_key`, `finance:`,
      `calendar.google`, `calendar.auth_service` and `schedule.email` in older `config/config.yaml`
      files are now ignored.

## 5. Product follow-ups (not blocking)

- [x] Flight-schedule email import (IMAP) was removed on 2026-10-21: it kept a mail password in
      `config/config.yaml`, skipped TLS certificate checks and had no phone UI. Schedules arrive by
      XLSX upload (`POST /api/schedule/upload`) and crew feeds by calendar link. It could come back
      later as a cloud mail import through skyglass.dev: Outlook `Mail.Read` is easy; Gmail
      `gmail.readonly` is a restricted scope that needs a yearly security assessment.
- [ ] The phone app has no screen for the XLSX schedule upload (`POST /api/schedule/upload`); today
      only scripts can use it. Add one, or drop the route if calendar links cover airline rosters.
- [ ] Add a calendar step to the phone onboarding flow.
- [ ] Portrait layouts: the 12 × 8 grid gives 240px-tall rows on a portrait panel, so every
      template leaves a large empty band, and the default layout (`DEFAULT_LAYOUT` in
      `packages/backend/src/routes/layout.ts`) uses only the top half. Add portrait variants (list
      widgets at least 4 columns wide, METAR large and TAF at least 6) and a portrait default.
- [ ] `DEFAULT_LAYOUT` pins `icao: 'KJFK'` and sets `showDecoded`; the per-user default in
      `packages/backend/src/db/index.ts` uses a widget id (`aviation-weather`) the mirror doesn't
      have, placed over the clock.
- [ ] Google-only calendar sign-in through the cloud means SkyGlass's Google project quota and
      verification status affect every customer. Monitor the quota once verified.
