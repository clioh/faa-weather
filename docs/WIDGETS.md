# Widget data endpoints

Backend endpoints that feed the mirror widgets (`packages/backend`). All return JSON;
errors are `{ "error": string }` (validation errors also carry `details`). Every route sits
behind the standard `/api` rate limiter; photo uploads also use `uploadLimiter`
(10 uploads/hour/IP).

Third-party calls share `services/upstream.ts`: each has an `AbortSignal` timeout, an
in-memory TTL cache per key, in-flight de-duplication, and serves the last good value
(up to 24 h old) if the upstream fails. Raw upstream errors are never returned.

| Endpoint | Provider | Cache |
|---|---|---|
| `GET /api/news` | RSS / Atom feeds | 10 min per feed URL |
| `GET /api/finance/stocks` | Finnhub (with key) or Yahoo Finance chart API | 5 min per symbol (Finnhub names 24 h) |
| `GET /api/finance/crypto` | CoinGecko `simple/price` | 2 min per coin set + currency |
| `GET /api/weather/current`, `/forecast` | Open-Meteo | 10 min per (lat, lon rounded to 2 dp, units) |
| `GET /api/aviation/winds-aloft` | AWC `api/data/windtemp` (FB) | 30 min per region/level product |
| `GET /api/aviation/tfrs` | FAA `tfrapi/getTfrList` + TFR GeoServer WFS | 15 min |

## News

`GET /api/news?source=world|us|business|technology|sports|aviation|custom&url=<encoded>&limit=10`

```json
{ "source": "aviation", "items": [{ "id", "title", "link", "publisher", "publishedAt": "ISO|null", "summary?" }], "fetchedAt": "ISO" }
```

Presets (`services/news.ts`, `NEWS_PRESETS`):

| source | feed |
|---|---|
| world | BBC News World — `https://feeds.bbci.co.uk/news/world/rss.xml` |
| us | NPR National — `https://feeds.npr.org/1003/rss.xml` |
| business | CNBC Business — `https://www.cnbc.com/id/10001147/device/rss/rss.html` |
| technology | Ars Technica — `https://feeds.arstechnica.com/arstechnica/index` |
| sports | ESPN — `https://www.espn.com/espn/rss/news` |
| aviation | AVweb — `https://avweb.com/feed/` |

- RSS 2.0, RSS 1.0 (RDF) and Atom are supported. Titles and summaries have HTML stripped
  and entities decoded; summaries are capped at 200 characters. `id` is the first 16 hex
  characters of SHA-1(link). Items are sorted newest first; `limit` is 1–30.
- `custom` requires `url`. SSRF guard (`services/ssrf.ts`): http/https only; the host must
  resolve only to public addresses (loopback, link-local, RFC1918, CGNAT, ULA, multicast and
  reserved ranges are rejected, including IPv4-mapped IPv6); every redirect hop is
  re-checked; 5 s timeout; 2 MB response cap. A rejected URL returns 400.

## Finance

`GET /api/finance/stocks?symbols=AAPL,MSFT` (1–12 symbols)

```json
{ "quotes": [{ "symbol", "name": "string|null", "price", "change", "changePercent", "currency": "USD", "history": [/* ≤30 daily closes, oldest→newest */], "asOf": "ISO|null" }], "fetchedAt" }
```

Two providers (`services/finance.ts`). The mirror holds no stock API key.

- **SkyGlass service** (default; base URL `skyglass_service` in `config/config.yaml`,
  default `https://skyglass.dev`). The mirror calls
  `GET {skyglass_service}/api/data/stocks?symbols=X` (one symbol per request so the CDN
  cache is shared across mirrors) and `GET {skyglass_service}/api/data/stock-profiles?symbols=X`
  for the company name (cached 24 h on the mirror, omitted if it fails). The service holds
  the Finnhub key and caches quotes ~60 s on the CDN; see [CLOUD_SERVICE.md](CLOUD_SERVICE.md).
  An `unknown_symbol` item gives null fields. The sparkline `history` comes from the Yahoo
  chart below when Yahoo is not cooling down, otherwise `[]`.
  If the service answers `503 not_configured`, Yahoo is used for 10 minutes before the
  service is asked again; if it is unreachable, rate limited or answers nonsense, for
  2 minutes. A per-symbol `error` item falls back to Yahoo for that symbol only.
- **Yahoo** (keyless fallback, called directly from the mirror): `GET https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?range=1mo&interval=1d`
  with a browser User-Agent and `Accept: application/json`. `price` = `regularMarketPrice`;
  change against `previousClose`, else `chartPreviousClose`; `history` = daily closes with
  nulls dropped; `asOf` = `regularMarketTime`; `chart.error` (unknown symbol) → null fields.
  Yahoo throttles bursts per IP: a 429 is never retried and starts a 10 minute cooldown
  during which Yahoo is not called at all and cached (or stale) quotes are served.

Symbols are fetched one at a time; Yahoo calls keep a 300 ms gap (shared across requests).
A symbol whose fetch fails gets its stale cached quote, or null fields; 502 only when every
symbol fails with nothing cached. `currency` is always `USD` per the contract.

`GET /api/finance/crypto?coins=BTC,ETH&currency=USD` (1–10 coins; USD, EUR, GBP, CAD, AUD, JPY, CHF)

```json
{ "quotes": [{ "symbol", "name", "price": "number|null", "change24hPercent": "number|null", "currency" }], "fetchedAt" }
```

Symbols map to CoinGecko ids through the bundled `COIN_IDS` table (~40 coins); unknown
symbols come back with null price.

## Weather (Open-Meteo)

`GET /api/weather/current?lat=&lon=&units=imperial|metric` (default imperial: °F, mph)

```json
{ "temperature", "apparentTemperature", "humidity", "windSpeed", "windDirection", "windGust": "number|null", "weatherCode", "description", "isDay", "units", "fetchedAt" }
```

`GET /api/weather/forecast?lat=&lon=&units=&days=5` (1–16 days)

```json
{ "days": [{ "date": "YYYY-MM-DD", "high", "low", "weatherCode", "description", "precipitationProbability": "number|null" }], "units", "fetchedAt" }
```

`description` comes from the WMO code table in `services/weather.ts` (`WEATHER_CODES`).

## Winds aloft

`GET /api/aviation/winds-aloft?lat=&lon=&maxAltitude=12000` (3000–53000 ft)

```json
{ "station": "SAN", "stationName": "San Diego Intl Arpt, CA", "validAt": "ISO|null", "forUse": "0800-1500Z", "levels": [{ "altitude", "direction": "number|null", "speed", "temperature": "number|null" }], "fetchedAt" }
```

- Nearest FB station by great-circle distance from `services/winds-aloft-stations.ts`
  (~200 stations: CONUS, Alaska, Hawaii; offshore points omitted).
- Uses the 6-hour forecast (`fcst=06`); low-level product covers 3000–39000 ft, the high
  product (45000/53000) is fetched for CONUS when `maxAltitude` exceeds 39000.
- Decoding: `9900` = light and variable → `direction: null`, `speed: 0`; direction codes
  51–86 mean +100 kt (`7307-16` = 230° at 107 kt, −16 °C); temperatures above 24000 ft are
  negative with the sign omitted; blank cells (below station elevation) are skipped;
  3000 ft has no temperature.

## TFRs and NOTAMs (changes)

`GET /api/aviation/tfrs?lat=&lon=&radiusNm=` — each TFR now has `latitude`/`longitude`
(bounding-box centre of its shape from the FAA TFR GeoServer `TFR:V_TFR_LOC` layer, or null
when no shape is published, e.g. nationwide TFRs). With `lat`+`lon`, each item gets
`distanceNm` (to the nearest edge, 0 inside, null when unlocated) and items are sorted
nearest first; `radiusNm` drops located TFRs farther than the radius.

`GET /api/aviation/notams/:icao?categories=runway,obstacle` — each NOTAM carries a derived
`category` (runway, taxiway, obstacle, airspace, navaid, approach, other) classified from
keywords in its text; `categories` filters on that (FAA codes like `FDC` still work).
The mirror holds no FAA key: NOTAMs come from `GET {skyglass_service}/api/data/notams?icao=X`
(see [CLOUD_SERVICE.md](CLOUD_SERVICE.md)), cached 30 minutes on the mirror. If the service
is unreachable or has no FAA credentials (`503 not_configured`), the last good list is
served for up to 6 hours, otherwise the response has `count: 0`; the reason is logged and
the fetch is retried after 5 minutes. Classification and filtering run on the mirror.

## Todos

Stored in `data/todos.json` (repo root `data/`), rewritten atomically; max 200 items, text ≤ 500 chars.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/todos` | — | `{ items: [{ id, text, done, createdAt, completedAt }] }` |
| POST | `/api/todos` | `{ text }` | `201 { item }` |
| PATCH | `/api/todos/:id` | `{ text?, done? }` | `{ item }` |
| DELETE | `/api/todos/:id` | — | `{ success: true }` |
| PUT | `/api/todos` | `{ items: [{ id, text, done }] }` | `{ items }` (reorder/bulk replace) |

Every change broadcasts `{ type: 'todos', data: { items } }` over the WebSocket.

The phone app manages the list from the To-do widget's config sheet in the layout editor
(`packages/mobile/components/config/TodoManager.tsx`); there is no separate widgets screen.

## Photos

Stored in `data/photos/` as `<uuid>.jpg|png|webp`; metadata comes from the filesystem.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/photos` | `{ photos: [{ id, url: '/api/photos/<id>/file', uploadedAt, size }] }` |
| POST | `/api/photos` | multipart field `photo`; ≤ 10 MB (413 above); type checked by magic bytes, not the client MIME (415 otherwise); `201 { photo }` |
| DELETE | `/api/photos/:id` | `{ success: true }` |
| GET | `/api/photos/:id/file` | image bytes, `Cache-Control: public, max-age=86400` |

Ids must match the safe-id pattern (`validation/safe-id.ts`), so path tricks get a 400.
Every change broadcasts `{ type: 'photos', data: { count } }`.

Photos are uploaded and deleted from the photo frame widget's config sheet in the phone's
layout editor (`packages/mobile/components/config/PhotoManager.tsx`).

## Config

`GET /api/config` (and the `config` WebSocket broadcast after a config reload) returns
`{ airport, location, display: { orientation, fade_duration, presence_timeout } }`.
`display.orientation` (`landscape` | `portrait`, default `landscape`) is set in
`config/config.yaml`. The legacy `widgets` section has been removed; layouts live in
`data/layouts/`.
