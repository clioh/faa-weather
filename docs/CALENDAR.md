# Calendars

The mirror's Schedule widget shows events from calendar accounts the user connects in the
phone app (**Calendars** screen), merged with airline XLSX schedules (manual upload or
IMAP email import, `schedule.email` in config).

The mirror is a LAN-only device with no public URL, so it stores the credentials and does
all syncing itself. The phone only drives the sign-in.

| Provider | UI name | How the user connects | What the mirror needs |
|---|---|---|---|
| `google` | Google Calendar | Sign in with Google in the phone's browser | Nothing (the SkyGlass sign-in service holds the app credentials) |
| `microsoft` | Outlook / Microsoft 365 | Enter a short code at microsoft.com/devicelogin | Nothing (client ID comes from the SkyGlass sign-in service) |
| `icloud` | iCloud | Apple ID + app-specific password | Nothing |
| `caldav` | Other CalDAV | Server URL + username + password (Nextcloud, Fastmail, Radicale...) | Nothing |
| `ics` | Calendar link | Paste an iCal/ICS/webcal link | Nothing |

The mirror itself holds **no OAuth app credentials**: no client secret, no client ID, no
environment variables. Google and Outlook sign-in go through the **SkyGlass sign-in
service** on `https://skyglass.dev`, a stateless cloud broker that holds the app
credentials (the Google client secret lives only there). The user's own tokens stay on the
mirror (`data/calendar-accounts.json`); the service never stores or logs them.

`GET /api/calendar/providers` reports Google and Outlook `available: true` when the
sign-in service publishes a configuration for them. Otherwise they are `available: false`
with a `reason` the app shows:

- service unreachable: "Can't reach the SkyGlass sign-in service. Check the mirror's
  internet connection."
- provider not configured on the service: "Google sign-in isn't available right now."
  (likewise "Outlook sign-in isn't available right now.")

iCloud, CalDAV and calendar links never need the sign-in service.

## Configuration

`config/default.yaml`:

```yaml
skyglass_service: https://skyglass.dev   # SkyGlass cloud service (top-level key)

calendar:
  refresh_minutes: 10
```

`skyglass_service` (top level, shared with NOTAMs and stock quotes; it replaced the old
`calendar.auth_service`, which is no longer read) is the base URL of the sign-in service. The default works out of the box.
**Self-hosters** can point it at their own deployment of the service (the marketing site's
`api/oauth/*` functions, see the last section) in `config/config.yaml`. It must be
`https://`; plain `http://` is accepted only for `localhost` / `127.0.0.1` during
development. A config reload (setup routes rewriting `config/config.yaml`) is picked up
without a restart.

The mirror calls the service over HTTPS with ~10 s timeouts:

| Mirror call | Purpose |
|---|---|
| `GET {skyglass_service}/api/oauth/config` | Public client IDs, redirect URI, scopes, tenant. Cached 10 minutes (failures cached ~1 minute). |
| `POST {skyglass_service}/api/oauth/google/token` | Google code exchange (`authorization_code` + PKCE verifier) and token refresh (`refresh_token`). The service adds the client ID/secret and redirect URI. |

## Google Calendar

### How sign-in works

1. The app calls `POST /api/calendar/google/start` with its deep link `returnUrl`
   (`skyglass://...`, or `exp://...` in Expo Go). The mirror fetches the sign-in
   service's config, creates a PKCE verifier (S256), keeps it in memory for 10 minutes,
   and returns Google's `authUrl` built from the service's public client ID, redirect
   URI and scopes.
2. The app opens `authUrl` in the system browser. Google redirects to
   `https://skyglass.dev/oauth/google`, a static page that forwards `code` and `state` to
   the app's `returnUrl`.
3. The app posts `code` + `state` to `POST /api/calendar/google/complete`. The mirror
   sends the code and PKCE verifier to the sign-in service's token endpoint, which adds
   the client secret and returns Google's tokens. The mirror then reads the account email
   (OpenID userinfo) and calendar list directly from Google and stores the refresh token.

Token refreshes also go through the sign-in service. If Google rejects the refresh token
(`invalid_grant`) the account becomes `reauth`; if the service is down the account shows
`error` and cached events keep being served. Disconnecting revokes the token directly at
`https://oauth2.googleapis.com/revoke` (no secret needed).

Scopes requested (from the service config, normally
`openid email https://www.googleapis.com/auth/calendar.readonly`), with
`access_type=offline&prompt=consent` so Google always returns a refresh token.

Calendar defaults: the primary calendar and the user's own/shared calendars start
enabled; Google's holiday, birthday/contacts and week-number calendars start disabled.

## Outlook / Microsoft 365

Uses the OAuth **device code** flow, so there is no redirect and no secret:
`POST /api/calendar/microsoft/start` returns a `userCode` and `verificationUri`; the user
enters the code on any device; the mirror polls Microsoft in the background (honouring the
poll interval and `slow_down`) and the app polls `GET /api/calendar/microsoft/status/:id`.
The public client ID, tenant and scopes come from the sign-in service's
`/api/oauth/config`; the mirror talks to Microsoft directly for the device flow and token
refresh.

Events come from `GET /me/calendars/{id}/calendarView` (recurrences already expanded,
times requested in UTC). Birthday/holiday calendars start disabled.

## iCloud

iCloud calendars are read over CalDAV at `https://caldav.icloud.com` with the user's Apple
ID and an **app-specific password** (the normal Apple ID password does not work, and
two-factor authentication must be on):

1. Sign in at <https://account.apple.com> (appleid.apple.com).
2. **Sign-In and Security > App-Specific Passwords > Generate**, name it "SkyGlass".
3. Enter the Apple ID email and the generated `xxxx-xxxx-xxxx-xxxx` password in the app.

The mirror discovers calendars via `current-user-principal` → `calendar-home-set` →
calendar collections, skips Reminders (VTODO-only) lists, and fetches events with a
`calendar-query` time-range REPORT. Recurrences, EXDATEs, moved/cancelled instances and
time zones are expanded locally (ical.js). Rejected credentials return
`400 { "error": "Apple ID or app-specific password was rejected" }`.

## Other CalDAV servers

Same as iCloud, but the user supplies the server URL (e.g.
`https://cloud.example.com/remote.php/dav` for Nextcloud,
`https://caldav.fastmail.com/dav/` for Fastmail, or a Radicale URL). The mirror tries the
URL itself and then `/.well-known/caldav`. LAN/private addresses are allowed for this
provider (self-hosted servers), unlike calendar links.

## Calendar links (ICS)

Any iCal feed works (`https://`, `http://` or `webcal://`, which is fetched as
`https://`). Links are fetched through the SSRF guard (`services/ssrf.ts`): private, LAN
and loopback addresses are rejected. One link = one account with one calendar; the name
comes from `X-WR-CALNAME` unless the user gives a label.

Where to find a link:

- **Google Calendar** (web): Settings > *your calendar* > Integrate calendar >
  **Secret address in iCal format**. (Use Google sign-in instead when possible; the
  secret address gives read access to anyone who has it.)
- **iCloud**: Calendar app or icloud.com/calendar > share icon next to the calendar >
  **Public Calendar** > copy the `webcal://` link.
- **Outlook.com / Microsoft 365** (web): Settings > Calendar > Shared calendars >
  **Publish a calendar** > choose the calendar and "Can view all details" > copy the
  **ICS** link.
- **Crew scheduling systems**: most export a personal iCal/webcal subscription URL.

## Storage

Accounts live in `data/calendar-accounts.json` (repo-root `data/`, next to `todos.json`),
written atomically with file mode `0600`. It holds OAuth access/refresh tokens, CalDAV
passwords and ICS URLs. It is git-ignored (`data/*`). No API route ever returns a secret;
responses use the public account shape below.

Events are cached in memory per account and refreshed in the background every
`refresh_minutes`. A sync covers yesterday through 32 days ahead so any `days` value is
served from cache. Google and Microsoft access tokens are refreshed automatically; if the
refresh token is rejected (`invalid_grant`) or the API still answers 401, the account's
status becomes `reauth` and the app asks the user to reconnect. Other failures set status
`error` with a readable message. In both cases cached events keep being served.

## API

All JSON. Errors are `{ "error": string }`, shown verbatim by the app. Sign-in endpoints
are rate-limited per client (20 per 15 minutes; on-device clients are exempt).

```ts
type CalendarProviderId = 'google' | 'microsoft' | 'icloud' | 'caldav' | 'ics';
interface CalendarAccount {
  id: string;
  provider: CalendarProviderId;
  label: string;
  email: string | null;
  status: 'ok' | 'error' | 'reauth';
  error: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  calendars: Array<{ id: string; name: string; color: string; enabled: boolean }>;
}
```

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/calendar/providers` | | `{ providers: [{ id, name, method, available, reason }] }` |
| GET | `/api/calendar/accounts` | | `{ accounts }` |
| PATCH | `/api/calendar/accounts/:id` | `{ label?, calendars?: [{ id, enabled?, color? }] }` | `{ account }` |
| DELETE | `/api/calendar/accounts/:id` | | `204` (Google tokens revoked best-effort) |
| POST | `/api/calendar/accounts/:id/sync` | | `{ account }` (also rediscovers calendars) |
| POST | `/api/calendar/google/start` | `{ returnUrl }` (`skyglass://`, `exp://`, `exp+skyglass://`) | `{ authUrl }` |
| POST | `/api/calendar/google/complete` | `{ code, state }` | `201 { account }`, or `200` when that Google account was already connected; `400` bad/expired state; `502` exchange failed |
| POST | `/api/calendar/microsoft/start` | | `{ sessionId, userCode, verificationUri, expiresAt }` |
| GET | `/api/calendar/microsoft/status/:sessionId` | | `{ status: 'pending'\|'complete'\|'expired'\|'denied'\|'error', account, error }` |
| POST | `/api/calendar/caldav` | `{ provider: 'icloud'\|'caldav', serverUrl?, username, password, label? }` | `201 { account }` (`200` when the same login was already connected) |
| POST | `/api/calendar/ics` | `{ url, label? }` | `201 { account }` |

Calendar colors are `#rrggbb`: the provider's color when it has one, otherwise the next
color of the mirror palette. A color set via PATCH sticks across rediscovery.

### Events

`GET /api/schedule?days=N` (1..30, default 7) returns events overlapping
[start of today in the mirror's timezone, now + N days] from enabled calendars, merged
with XLSX flight duties and sorted by start:

```ts
interface ScheduleResponse {
  count: number;
  events: ScheduleEvent[];
  accounts: Array<{ id; label; provider; status }>;
  updatedAt: string; // last successful sync of any account
}
interface ScheduleEvent {
  id: string;                       // unique across sources
  source: CalendarProviderId | 'xlsx';
  accountId: string | null;         // null for xlsx
  calendarId: string | null;
  calendarName: string | null;
  color: string | null;             // null for xlsx
  title: string;
  location: string | null;
  startTime: string;                // ISO instant
  endTime: string;
  allDay: boolean;
  startDate: string | null;         // 'YYYY-MM-DD', all-day only (floating date)
  endDate: string | null;           // exclusive, all-day only
  isFlightDuty: boolean;
  flightNumber?; departure?; arrival?; aircraftType?; dutyType?; reportTime?; releaseTime?;
}
```

For all-day events, render `startDate`/`endDate` (no timezone shift); `startTime` is local
midnight in the mirror's configured timezone (`location.timezone`). The request waits at
most ~5 s for accounts that have not synced yet, otherwise it answers from cache.

`GET /api/schedule/flights?days=N` returns `{ count, flights }` with XLSX duties only, in
the same event shape. `GET /api/schedule/next-flight` returns `{ flight }`.

The WebSocket broadcasts `{ type: 'calendar', data: { updatedAt } }` whenever accounts
change, a sync changes the event set or an account's status, or a new XLSX schedule is
loaded; the widget refetches `/api/schedule` on it.

## Code

- `packages/backend/src/calendar/`: `service.ts` (flows, sync engine, merged events),
  `accounts-store.ts`, `ical.ts` (ICS parsing/recurrence), `providers/{google,microsoft,caldav}.ts`,
  `auth-service.ts` (SkyGlass sign-in service client: config cache, Google token broker),
  `config.ts`, `instance.ts` (singleton wired to config + WS)
- `packages/backend/src/routes/calendar.ts`, `routes/schedule.ts`

## SkyGlass sign-in service (cloud)

A stateless OAuth broker that holds the app's Google client secret so mirrors never need
it. It runs as Vercel functions on the marketing site (`packages/website`), served at
`https://skyglass.dev`. It stores nothing, and it never logs codes, tokens, PKCE verifiers
or the secret (logs carry only error categories such as `google_token upstream_timeout`).
Users' refresh tokens stay on their mirror (`data/calendar-accounts.json`).

| Endpoint | Behaviour |
|---|---|
| `GET /api/oauth/config` | `{ version: 1, google: { clientId, redirectUri, scopes } \| null, microsoft: { clientId, tenant, scopes } \| null }`. A provider is `null` when its env vars are unset (Google needs both ID and secret). GET/HEAD only. |
| `POST /api/oauth/google/token` | JSON body `{ grant_type: "authorization_code", code, code_verifier }` or `{ grant_type: "refresh_token", refresh_token }`. The service adds `client_id`, `client_secret` and (for code exchange) the fixed `redirect_uri`; caller-supplied values for those are ignored. Forwards to `https://oauth2.googleapis.com/token`. |

Token endpoint responses:

- 2xx: Google's body, reduced to `access_token`, `expires_in`, `refresh_token`, `scope`,
  `token_type`, `id_token`.
- 4xx from Google (e.g. `invalid_grant`): status and `{ error, error_description }`
  passed through unchanged, other fields stripped.
- Google 5xx, network error, timeout (10 s) or unparseable reply: `502 { error: "upstream_unavailable" }`.
- `400 invalid_request` for invalid JSON, a body over 8 KB, missing/empty fields, strings over
  2048 chars, or a `code_verifier` outside `^[A-Za-z0-9\-._~]{43,128}$`;
  `400 unsupported_grant_type` for other grants; `415` for a non-JSON `Content-Type`;
  `405` for methods other than POST; `503 { error: "not_configured" }` when the Google env
  vars are missing; `429 rate_limited` (with `Retry-After`) above 30 requests/minute per
  client IP (60/minute for `/api/oauth/config`). The limit is best effort: in-memory, per
  function instance, keyed on the first `x-forwarded-for` hop, then `x-real-ip`.

All `/api/oauth/*` responses carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`,
and no CORS headers: these are server-to-server endpoints. In `vercel.json` the CORS header
rule is scoped to `/api/((?!oauth/).*)` so other site APIs keep `Access-Control-Allow-Origin: *`.

Code: `packages/website/api/_lib/oauth.ts` (all logic; the `_lib` folder is not deployed as a
function), `api/oauth/config.ts`, `api/oauth/google/token.ts` (thin handlers). The bounce page
Google redirects to is the static `public/oauth/google.html` (`/oauth/google`).

Environment variables (Vercel project settings, see `packages/website/.env.example`):

| Variable | Required | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | for Google | Web application OAuth client. |
| `GOOGLE_CLIENT_SECRET` | for Google | Only ever stored here. |
| `GOOGLE_REDIRECT_URI` | no | Default `https://skyglass.dev/oauth/google`; must be an authorized redirect URI on the Google client. |
| `MICROSOFT_CLIENT_ID` | for Microsoft | Public client (device code flow runs on the mirror; no secret). |
| `MICROSOFT_TENANT` | no | Default `common`. |

**Self-hosting:** deploy `packages/website` to your own Vercel project with your own Google/Microsoft app
credentials, register `https://<your-host>/oauth/google` as the Google redirect URI, set
`GOOGLE_REDIRECT_URI` to it, and point the mirror's `skyglass_service` at your host.
All cloud endpoints (sign-in and data) are listed in [CLOUD_SERVICE.md](CLOUD_SERVICE.md).
