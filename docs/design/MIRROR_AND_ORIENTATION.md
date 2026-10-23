# Mirror onboarding and mirror orientation

This is an addendum to `SCREENS.md` and `IMPLEMENTATION_PLAN.md`.

- Mockups live in `docs/design/mockups/`: `M-*-L` is landscape, `M-*-P` is portrait, and `mirror.css` holds the shared styles.
- Mirror artboards are drawn at 2/3 of 1920×1080, so 1px in a mockup is 1.5px on the mirror.

## Mirror setup screens (`packages/frontend/src/components`)

**One component per screen. Orientation changes only the layout; copy, order and states stay the same.**

| Component               | Mockups         | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProvisioningScreen`    | `M-Hotspot-L/P` | Keep the two QR codes ("01 · Connect to Wi-Fi" for `SkyGlass-Setup`, "02 · Open setup page" for `10.42.0.1`). Landscape: text left, QR codes side by side on the right. Portrait: QR codes stacked at the top, each with its label beside it. Remove the green `#4ecca3` glyph and the card fills.                                                                                                                                                                                                                                                                      |
| _new_ orientation check | `M-Orient-L/P`  | Shown while the app's Orientation step is open: an accent outline around the whole screen, a large up arrow, "This way up?" and "Confirm on your phone".                                                                                                                                                                                                                                                                                                                                                                                                                |
| `SetupProgressScreen`   | `M-Pair-L/P`    | The title becomes the kicker "Setting up your mirror". The current step's label becomes the headline (e.g. "Activate your license"), with its description as body text. Replace the numbered dots with the hairline step list (Orientation, License, Location, Airport, Face; ✓ done, white = current, dim = to do). `PairingQr` sits on the right in landscape and on top in portrait, captioned "Continue setup in the SkyGlass app on your phone." The face-registration variant ("Look at the Mirror", n / 5 photos) uses the same layout as `RegistrationOverlay`. |
| `PairingCodeOverlay`    | `M-Code-L/P`    | "Pairing request" kicker with an accent dot. "Pair **{device}**?" title. Code in mono at 120px (landscape) / 96px (portrait), in groups of three. "Enter this code in the SkyGlass app" below it, then an accent progress bar and "Expires in m:ss". The result states (Phone paired / Pairing cancelled / Code expired) use the same centred layout.                                                                                                                                                                                                                   |
| `LicenseScreen`         | `M-License-L/P` | eyebrow → kicker; title → headline; body; steps → numbered hairline list (right column in landscape, below in portrait); facts (`Last verified`, `License key ····-XXXX`) as mono definition pairs. Every status (activating, needed, reconnect, released, revoked, other mirror) uses this one layout.                                                                                                                                                                                                                                                                 |
| `RegistrationOverlay`   | `M-Face-L/P`    | The camera feed is a rounded panel with a dashed accent face outline and the big countdown. Landscape: feed left, instruction right. Portrait: feed on top at eye level. Text: "Setting up for {name}", the instruction as the headline, "2 of 5 photos", "Use your phone to capture each photo". **Drop the emoji icons.** Completion screen ("Welcome, {name}!") = `M-Welcome-L/P` with the logo mark.                                                                                                                                                                |

### Rules

- Black stays invisible behind the glass. Nothing gets a fill except the QR codes, which need a white quiet zone, and the camera feed.
- Type is sized for 1–2 m viewing (at 1080p): headline ≈ 87px, body ≈ 33px, nothing below ≈ 20px.
- Colour follows the app: sky blue for the active state and ticks only.
- Portrait puts the thing you look at or scan (QR code, code, camera feed) in the upper third, at eye level.
- Portrait rules hang off `html[data-orientation='portrait']`, which `OrientationFrame` sets from `display.orientation`, not `@media (orientation: portrait)`: a portrait panel on a landscape HDMI output is turned in CSS, so the media query would see the output, not the panel.

## New setup step: Orientation

**Order:** WiFi → **Orientation** → License → Location → Airport → Face. It comes before License, so every later mirror screen is drawn the right way up.

### App: `/setup/orientation` (mockup `S-Orientation`; checklist `S-Checklist` updated to six steps)

- Title: "How is your mirror mounted?". Body: "The mirror turns its screen to match. Look at the glass and check the arrow points up."
- A radio group of three cards:
  - Landscape
  - Portrait, "Turned right"
  - Portrait, "Turned left"
- Selecting a card applies it to the mirror immediately as a preview, and the mirror shows `M-Orient`.
- Primary button: "The arrow points up". It saves and continues to License. The "Back" button reverts the preview.
- The same screen is reachable from Settings › Mirror as an "Orientation" row.
- The layout editor already reads `display.orientation`. `E-Portrait` shows the editor for a portrait mount.

### Backend / mirror

- `config.display.orientation`: currently `landscape | portrait`. Add the rotation direction: `landscape | portrait-cw | portrait-ccw`. Keep `portrait` as an alias for `portrait-cw` when reading.
- The mirror rotates its own UI, so no OS change is needed. When the HDMI output is landscape and the setting is portrait, the frontend root gets `transform: rotate(±90deg)`, with width and height swapped to match the panel. The widgets already reflow for portrait.
- New endpoints, each behind the pairing token:
  - `POST /api/setup/orientation { orientation, preview?: boolean }`. A preview applies the setting live and shows `M-Orient`; a save persists it.
  - `GET /api/setup/status` gains `orientationConfigured`.
- `lib/setupSteps.ts` (mobile) and `STEPS` in `SetupProgressScreen` add `orientation` after `wifi`.
- Existing mirrors with no explicit setting count as configured as landscape, so they don't fall back into setup.
