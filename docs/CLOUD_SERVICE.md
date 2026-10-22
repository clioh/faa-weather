# SkyGlass cloud service

Mirrors hold **no third-party API keys or OAuth app secrets**. Everything that needs one goes
through the SkyGlass cloud service: stateless Vercel functions deployed with the marketing site
(`packages/website/api/`, served at `https://skyglass.dev`).

| Area | Endpoints | Upstream | Code |
|---|---|---|---|
| Calendar sign-in | `/api/oauth/config`, `/api/oauth/google/token` | Google OAuth | `api/_lib/oauth.ts` |
| NOTAMs | `/api/data/notams` | FAA NOTAM API | `api/_lib/data.ts` |
| Stock quotes | `/api/data/stocks`, `/api/data/stock-profiles` | Finnhub | `api/_lib/data.ts` |

Handlers in `api/oauth/**` and `api/data/**` are thin wrappers; the logic is in `api/_lib/`
(not deployed as functions because the path contains `/_`).

## Mirror configuration

```yaml
# config/config.yaml (default in config/default.yaml)
skyglass_service: https://skyglass.dev
```

A single top-level key is used by calendar sign-in, NOTAMs and stocks. It must be `https://`
(plain `http://` is allowed only for `localhost` / `127.0.0.1` during development). An invalid
value disables calendar sign-in and NOTAMs and makes stocks use Yahoo only. It replaced
`calendar.auth_service`, which is no longer read. The old `notam_api_key` and
`finance.finnhub_api_key` keys (and the `FAA_NOTAM_API_KEY` / `FINNHUB_API_KEY` mirror
environment variables) are gone.

Mirror → service requests carry only `Accept` and `User-Agent` headers (no keys) and time
out after 10 s.

## Common behaviour

- **No CORS.** These routes are for mirrors (server to server). `vercel.json` excludes
  `/api/oauth/*` and `/api/data/*` from the `Access-Control-Allow-Origin: *` rule, and the
  functions never set CORS headers.
- **Headers:** `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`,
  `X-Content-Type-Options: nosniff`.
- **Errors** are JSON `{ "error": string, "error_description"?: string }`:

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_request` | Bad or missing parameter, unknown parameter, parameter repeated |
| 405 | `method_not_allowed` | Not GET/HEAD (data) or not POST (token) |
| 429 | `rate_limited` | Per-IP limit hit; `Retry-After` header in seconds |
| 502 | `upstream_unavailable` | Upstream timeout, network error, non-2xx, bad JSON or unexpected shape |
| 503 | `not_configured` | The variables for that upstream are not set on the deployment |
| 500 | `internal_error` | Unexpected failure |

- **Upstream calls:** 10 s timeout, redirects refused, response bodies capped at 4 MB.
  Upstream bodies and error text are never passed through. The data endpoints return a
  compact, normalized JSON.
- **Secrets** are read from the environment on each request, sent only to the upstream (FAA:
  `client_id` / `client_secret` request headers; Finnhub: `X-Finnhub-Token` header, never in a
  URL), and never logged or returned. Logs contain only categories such as
  `[data] notams upstream_status_401`.

## Caching

The data endpoints set `Cache-Control` so Vercel's CDN serves one upstream response to every
mirror asking for the same URL. Cache hits don't run the function, don't count toward the rate
limit and don't use upstream quota.

| Response | `Cache-Control` |
|---|---|
| `/api/data/notams` 200 | `public, max-age=0, s-maxage=600, stale-while-revalidate=1200` |
| `/api/data/stocks` 200 | `public, max-age=0, s-maxage=60, stale-while-revalidate=60` |
| `/api/data/stocks` or `stock-profiles` 200 with some items `status: "error"` | `public, max-age=0, s-maxage=15` |
| `/api/data/stock-profiles` 200 | `public, max-age=0, s-maxage=86400, stale-while-revalidate=604800` |
| 308 canonical redirect | `public, max-age=0, s-maxage=86400` |
| any error (4xx/5xx) | `no-store` |
| `/api/oauth/*` | `no-store` |

**Canonical URLs:** the CDN keys on the full URL. Input is normalized (trimmed, uppercased;
symbols de-duplicated and sorted, each `encodeURIComponent`-encoded and joined with literal
commas). A request whose query string is not already in that exact form gets a
`308 Location: /api/data/...?<canonical>` (cacheable). Varying case or symbol order can't
create new cache entries that cost upstream calls. The mirror always sends the canonical form.

On the mirror side: NOTAMs are cached 30 minutes per airport; on failure the last good list is
served (up to 6 h) and the fetch is retried after 5 minutes. Stock quotes are cached 5 minutes,
company names 24 hours. Stocks are requested **one symbol per request**, so popular symbols
are shared across every mirror's CDN cache rather than keyed by each user's own list.

## Abuse limits

- Strict input validation: ICAO `^[A-Z0-9]{3,4}$`, symbol `^[A-Z0-9.\-^=]{1,15}$`, at most
  20 symbols, no other query parameters.
- Best-effort **per function instance, per client IP** rate limits (in-memory, reset when an
  instance is recycled; IP from the first `x-forwarded-for` hop):

| Endpoint | Limit |
|---|---|
| `GET /api/data/notams` | 60 / min |
| `GET /api/data/stocks` | 120 / min |
| `GET /api/data/stock-profiles` | 60 / min |
| `GET /api/oauth/config` | 60 / min |
| `POST /api/oauth/google/token` | 30 / min |

- Finnhub calls within one request run at most 4 at a time.
- For stronger, global protection add Vercel Firewall rate-limit rules on `/api/data/*`.
  The per-instance limiter does not share state across instances or regions.

## Endpoints

### `GET /api/data/notams?icao=KSAN`

Upstream: `GET https://external-api.faa.gov/notamapi/v1/notams?icaoLocation=KSAN&responseFormat=geoJson&sortBy=effectiveStartDate&sortOrder=Desc&pageSize=50`
with `client_id` / `client_secret` headers. The GeoJSON items
(`properties.coreNOTAMData.notam` + `notamTranslation[]`) and a flat item shape are both
accepted.

```json
{
  "version": 1,
  "icao": "KSAN",
  "fetchedAt": "2026-10-21T12:00:00.000Z",
  "totalCount": 3,
  "notams": [{
    "id": "NOTAM_1_1", "number": "10/123", "type": "N", "classification": "DOM",
    "text": "RWY 09/27 CLSD",
    "effectiveStart": "2026-10-20T10:00:00.000Z",
    "effectiveEnd": "2026-10-25T10:00:00.000Z",
    "location": "SAN", "affectedFir": "KZLA", "schedule": "DLY 0600-1400",
    "minimumAltitude": null, "maximumAltitude": "FL180"
  }]
}
```

- `text` is the NOTAM's own text, else the local-format translation, else the ICAO
  formatted text (max 4000 characters).
- `effectiveEnd` is `null` for `PERM` or when the end is missing.
- Items without an id or a parseable `effectiveStart` are dropped.
- FL `000` and `999` (surface/unlimited defaults) become `null`.
- At most 50 items are returned (the newest by effective start). `totalCount` is the FAA's
  total.
- Category classification and the active/category filters run on the mirror
  (`GET /api/aviation/notams/:icao`).

### `GET /api/data/stocks?symbols=AAPL,MSFT`

Upstream: `GET https://finnhub.io/api/v1/quote?symbol=X` per symbol.

```json
{
  "version": 1,
  "fetchedAt": "2026-10-21T12:00:00.000Z",
  "quotes": [
    { "symbol": "AAPL", "status": "ok", "price": 233.75, "change": 3.5, "changePercent": 1.52,
      "previousClose": 230.25, "asOf": "2026-10-16T20:00:00.000Z" },
    { "symbol": "ZZZZ", "status": "unknown_symbol", "price": null, "change": null,
      "changePercent": null, "previousClose": null, "asOf": null }
  ]
}
```

`status` is `ok`, `unknown_symbol` (Finnhub `c = 0` and `pc = 0`) or `error` (that symbol's
upstream call failed; the response is then cached for 15 s only). If every symbol fails, the
whole request returns 502.

### `GET /api/data/stock-profiles?symbols=AAPL`

Upstream: `GET https://finnhub.io/api/v1/stock/profile2?symbol=X` per symbol.

```json
{ "version": 1, "fetchedAt": "...",
  "profiles": [{ "symbol": "AAPL", "status": "ok", "name": "Apple Inc", "currency": "USD", "exchange": "NASDAQ NMS - GLOBAL MARKET" }] }
```

### `GET /api/oauth/config` and `POST /api/oauth/google/token`

These are the calendar sign-in broker. They are documented in [CALENDAR.md](CALENDAR.md#skyglass-sign-in-service-cloud).
Both are `no-store`.

## Environment variables (Vercel project)

See `packages/website/.env.example`.

| Variable | Used by | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `/api/oauth/*` | Google sign-in; both needed |
| `GOOGLE_REDIRECT_URI` | `/api/oauth/*` | Optional, default `https://skyglass.dev/oauth/google` |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT` | `/api/oauth/config` | Public client; tenant optional (default `common`) |
| `FAA_NOTAM_CLIENT_ID`, `FAA_NOTAM_CLIENT_SECRET` | `/api/data/notams` | FAA API portal credentials; both needed, else 503 `not_configured` |
| `FAA_NOTAM_API_URL` | `/api/data/notams` | Optional https override of the FAA endpoint (e.g. if the FAA moves the API) |
| `FINNHUB_API_KEY` | `/api/data/stocks`, `/api/data/stock-profiles` | Else 503 `not_configured` (mirrors fall back to Yahoo) |

## Self-hosting

Deploy `packages/website` to your own Vercel project with your own credentials, then set
`skyglass_service: https://<your-host>` on your mirrors. Any endpoint whose variables you leave
unset answers `503 not_configured`. Mirrors then show no NOTAMs, use Yahoo for stocks, or
report the calendar provider as unavailable.
