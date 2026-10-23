/**
 * HTTP-level tests for the widget data routes over the REAL server.ts route
 * stack: news, finance, weather, to-dos and photos.
 *
 * - server.ts is imported with SKYGLASS_NO_LISTEN=1 and listened on 127.0.0.1:0;
 *   requests come from loopback with no X-Forwarded-For, so the pairing gate
 *   treats them as the local kiosk and the rate limiters skip them.
 * - The to-do and photo stores are redirected to a temp dir (the routes
 *   hardcode the repo `data/` dir), so the real data/ directory is never touched.
 * - Outbound network: global fetch is stubbed (rejects anything not routed by a
 *   test) and the SSRF fetcher used by news is mocked. No real network calls.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

const h = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-widgets-http-'));
  process.env.SKYGLASS_NO_LISTEN = '1';
  process.env.SKYGLASS_PAIRED_DEVICES_FILE = path.join(tmp, 'paired-devices.json');
  process.env.SKYGLASS_SCHEDULE_FILE = path.join(tmp, 'flight-schedule.xlsx');
  process.env.SKYGLASS_INTERNAL_TOKEN_FILE = path.join(tmp, 'internal-token');
  return {
    tmp,
    todosFile: path.join(tmp, 'todos.json'),
    photosDir: path.join(tmp, 'photos'),
    calendarFile: path.join(tmp, 'calendar-accounts.json'),
  };
});

const ssrf = vi.hoisted(() => ({
  safeFetchText: vi.fn<(url: string, opts?: unknown) => Promise<string>>(),
}));

vi.mock('../db/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/index.js')>()),
  getMirrorId: () => '00000000-0000-4000-8000-000000000000',
  getMirrorName: () => 'Test Mirror',
}));

// Deterministic config regardless of the developer's config/config.yaml.
vi.mock('../config/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../config/index.js')>();
  return {
    ...mod,
    loadConfig: () => {
      const c = mod.loadConfig();
      return {
        ...c,
        skyglass_service: 'https://svc.skyglass.test',
        location: { ...c.location, timezone: 'UTC' },
      };
    },
  };
});

vi.mock('../services/todos.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/todos.js')>();
  class TempTodoStore extends mod.TodoStore {
    constructor() {
      super(h.todosFile);
    }
  }
  return { ...mod, TodoStore: TempTodoStore };
});

vi.mock('../services/photos.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/photos.js')>();
  class TempPhotoStore extends mod.PhotoStore {
    constructor() {
      super(h.photosDir);
    }
  }
  return { ...mod, PhotoStore: TempPhotoStore };
});

vi.mock('../calendar/accounts-store.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../calendar/accounts-store.js')>();
  class TempAccountStore extends mod.CalendarAccountStore {
    constructor() {
      super(h.calendarFile);
    }
  }
  return { ...mod, CalendarAccountStore: TempAccountStore };
});

// The real URL guard runs (no DNS: hostnames resolve to a fixed public IP);
// the fetch itself is a test double.
vi.mock('../services/ssrf.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/ssrf.js')>();
  return {
    ...mod,
    assertPublicUrl: (raw: string) => mod.assertPublicUrl(raw, async () => ['93.184.216.34']),
    safeFetchText: ssrf.safeFetchText,
  };
});

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http, { type Server } from 'http';
import type { AddressInfo } from 'net';

const { app } = await import('../server.js');
const finance = await import('../services/finance.js');
const { UpstreamError } = await import('../services/upstream.js');

const REPO_DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../data');
const realFetch = globalThis.fetch;

type Upstream = (url: string, init?: RequestInit) => Promise<Response>;
const upstream = vi.fn<Upstream>();
const upstreamUrls: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Route stubbed upstream calls by URL prefix; anything else fails like a dead network. */
function routeUpstream(routes: Array<[string, (url: string) => Response | Promise<Response>]>): void {
  upstream.mockImplementation(async (url) => {
    for (const [prefix, handler] of routes) if (url.startsWith(prefix)) return handler(url);
    throw new TypeError(`fetch failed (unrouted in test: ${url})`);
  });
}

function snapshot(p: string): string {
  try {
    const s = fs.statSync(p);
    return `${s.isDirectory() ? 'dir' : 'file'}:${s.mtimeMs}:${s.size}`;
  } catch {
    return 'missing';
  }
}
const repoDataPaths = ['todos.json', 'photos', 'calendar-accounts.json'].map((f) => path.join(REPO_DATA, f));
const repoDataBefore = repoDataPaths.map(snapshot);

let server: Server;
let base: string;
const api = (p: string, init?: RequestInit) => realFetch(`${base}${p}`, init);
/** Raw request: the path goes on the wire exactly as given (fetch would normalize `..` / `%2e%2e`). */
function raw(method: string, rawPath: string): Promise<{ status: number; body: string }> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: rawPath }, (res) => {
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
const sendJson = (method: string, p: string, body: unknown) =>
  api(p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeAll(async () => {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    upstreamUrls.push(url);
    return upstream(url, init);
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  upstream.mockReset();
  routeUpstream([]);
  upstreamUrls.length = 0;
  ssrf.safeFetchText.mockReset();
  ssrf.safeFetchText.mockRejectedValue(new UpstreamError('Upstream unreachable'));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(h.tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------- news

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Test Wire</title>
  <item><title>Older &amp; wiser</title><link>https://news.test/a</link><pubDate>Mon, 19 Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;First&lt;/p&gt;</description></item>
  <item><title>Newest</title><link>https://news.test/b</link><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate></item>
  <item><title>Undated</title><link>https://news.test/c</link></item>
</channel></rss>`;

describe('GET /api/news', () => {
  it('returns parsed preset headlines, newest first, capped by limit', async () => {
    ssrf.safeFetchText.mockResolvedValue(RSS);
    const res = await api('/api/news?source=aviation&limit=2');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['fetchedAt', 'items', 'source']);
    expect(body.source).toBe('aviation');
    expect(Number.isFinite(Date.parse(body.fetchedAt))).toBe(true);
    expect(body.items.map((i: { title: string }) => i.title)).toEqual(['Newest', 'Older & wiser']);
    expect(body.items[0]).toMatchObject({ link: 'https://news.test/b', publishedAt: '2026-10-20T10:00:00.000Z' });
    expect(body.items[0].id).toMatch(/^[0-9a-f]{16}$/);
    expect(ssrf.safeFetchText).toHaveBeenCalledWith('https://avweb.com/feed/', expect.anything());
  });

  it('fetches a custom feed through the guard', async () => {
    ssrf.safeFetchText.mockResolvedValue(RSS);
    const res = await api(`/api/news?source=custom&url=${encodeURIComponent('https://feeds.example.org/rss')}`);
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(3);
    expect(ssrf.safeFetchText).toHaveBeenCalledWith('https://feeds.example.org/rss', expect.anything());
  });

  it('rejects bad query params with 400 and details', async () => {
    for (const q of ['source=nope', 'limit=0', 'limit=31', 'limit=abc', 'source=custom']) {
      const res = await api(`/api/news?${q}`);
      expect(res.status, q).toBe(400);
      const body = await res.json();
      expect(body.error, q).toBe('Invalid query parameters');
      expect(Array.isArray(body.details), q).toBe(true);
    }
    const missing = await (await api('/api/news?source=custom')).json();
    expect(missing.details).toEqual([{ field: 'url', message: 'url is required for custom source' }]);
    expect(ssrf.safeFetchText).not.toHaveBeenCalled();
  });

  it('rejects unsafe custom URLs with 400 before fetching', async () => {
    for (const u of ['http://169.254.169.254/latest/meta-data', 'http://127.0.0.1:3001/api/config', 'file:///etc/passwd', 'http://localhost/x', 'not a url']) {
      const res = await api(`/api/news?source=custom&url=${encodeURIComponent(u)}`);
      expect(res.status, u).toBe(400);
      expect(typeof (await res.json()).error, u).toBe('string');
    }
    expect(ssrf.safeFetchText).not.toHaveBeenCalled();
  });

  it('maps an upstream failure to 502 with a safe message', async () => {
    ssrf.safeFetchText.mockRejectedValue(new UpstreamError('Upstream returned 500'));
    const res = await api('/api/news?source=world');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Failed to fetch news: Upstream returned 500' });
  });

  it('maps an upstream timeout to 504', async () => {
    ssrf.safeFetchText.mockRejectedValue(new UpstreamError('Upstream timed out', 504));
    const res = await api('/api/news?source=us');
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: 'Failed to fetch news: Upstream timed out' });
  });

  it('never leaks a non-upstream error message', async () => {
    ssrf.safeFetchText.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:443 secret-internal-host'));
    const res = await api('/api/news?source=sports');
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/^Failed to fetch news/);
    expect(JSON.stringify(body)).not.toContain('secret-internal-host');
  });

  it('serves the last good feed when the upstream fails after the cache expires', async () => {
    ssrf.safeFetchText.mockResolvedValueOnce(RSS);
    const first = await (await api('/api/news?source=technology')).json();
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 11 * 60 * 1000);
    ssrf.safeFetchText.mockRejectedValue(new UpstreamError('Upstream returned 503'));
    const res = await api('/api/news?source=technology');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual(first.items);
    expect(body.fetchedAt).toBe(first.fetchedAt);
    expect(ssrf.safeFetchText).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------- finance

const SVC = 'https://svc.skyglass.test';
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const GECKO = 'https://api.coingecko.com/api/v3/simple/price';

function yahooChart(symbol: string, price: number, prev: number, closes: Array<number | null>) {
  return {
    chart: {
      result: [
        {
          meta: { symbol, shortName: `${symbol} Corp`, regularMarketPrice: price, previousClose: prev, regularMarketTime: 1760990400 },
          indicators: { quote: [{ close: closes }] },
        },
      ],
      error: null,
    },
  };
}

describe('GET /api/finance/stocks', () => {
  beforeEach(() => {
    finance.clearFinanceCaches();
    finance.resetSkyglassServiceState();
    finance.resetYahooCooldown();
  });

  it('returns quotes from the SkyGlass service with name and Yahoo history', async () => {
    routeUpstream([
      [`${SVC}/api/data/stocks?symbols=AAPL`, () =>
        json({ version: 1, quotes: [{ symbol: 'AAPL', status: 'ok', price: 200, change: 2, changePercent: 1.0101, asOf: '2026-10-20T20:00:00Z' }] })],
      [`${SVC}/api/data/stock-profiles?symbols=AAPL`, () => json({ version: 1, profiles: [{ symbol: 'AAPL', name: 'Apple Inc' }] })],
      [`${YAHOO}AAPL`, () => json(yahooChart('AAPL', 199, 198, [190, null, 195, 198]))],
    ]);
    const res = await api('/api/finance/stocks?symbols=aapl');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['fetchedAt', 'quotes']);
    expect(body.quotes).toEqual([
      {
        symbol: 'AAPL',
        name: 'Apple Inc',
        price: 200,
        change: 2,
        changePercent: 1.01,
        currency: 'USD',
        history: [190, 195, 198],
        asOf: '2026-10-20T20:00:00.000Z',
      },
    ]);
  });

  it('falls back to Yahoo when the service is not configured (503 not_configured)', async () => {
    routeUpstream([
      [`${SVC}/`, () => json({ error: 'not_configured' }, 503)],
      [`${YAHOO}MSFT`, () => json(yahooChart('MSFT', 410, 400, [400, 405, 410]))],
    ]);
    const res = await api('/api/finance/stocks?symbols=MSFT');
    expect(res.status).toBe(200);
    const [q] = (await res.json()).quotes;
    expect(q).toMatchObject({ symbol: 'MSFT', name: 'MSFT Corp', price: 410, change: 10, changePercent: 2.5, currency: 'USD', history: [400, 405, 410] });
    expect(finance.stockProvider()).toBe('yahoo');
  });

  it('gives null fields for a symbol that fails while others succeed', async () => {
    routeUpstream([
      [`${SVC}/`, () => json({ error: 'not_configured' }, 503)],
      [`${YAHOO}IBM`, () => json(yahooChart('IBM', 250, 250, [250]))],
      [`${YAHOO}NOPE`, () => new Response('boom', { status: 500 })],
    ]);
    const res = await api('/api/finance/stocks?symbols=IBM,NOPE');
    expect(res.status).toBe(200);
    const { quotes } = await res.json();
    expect(quotes.map((q: { symbol: string }) => q.symbol)).toEqual(['IBM', 'NOPE']);
    expect(quotes[1]).toMatchObject({ symbol: 'NOPE', price: null, change: null, changePercent: null, history: [] });
  });

  it('answers 502 when every symbol fails with nothing cached', async () => {
    const res = await api('/api/finance/stocks?symbols=TSLA');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Failed to fetch stock quotes: Stock quotes unavailable' });
  });

  it('rejects bad symbol lists with 400', async () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => `S${i}`).join(',');
    for (const q of ['', 'symbols=', 'symbols=%20,%20', 'symbols=BAD%20SYM', 'symbols=AAPL;rm', `symbols=${thirteen}`]) {
      const res = await api(`/api/finance/stocks?${q}`);
      expect(res.status, q).toBe(400);
      const body = await res.json();
      expect(body.error, q).toBe('Invalid query parameters');
      expect(body.details[0].field, q).toMatch(/^symbols/);
    }
    expect(upstreamUrls).toEqual([]);
  });
});

describe('GET /api/finance/crypto', () => {
  beforeEach(() => finance.clearFinanceCaches());

  it('returns prices for known coins and nulls for unknown ones', async () => {
    let calledUrl = '';
    routeUpstream([
      [GECKO, (url) => {
        calledUrl = url;
        return json({ bitcoin: { eur: 60000.5, eur_24h_change: 1.23456 }, ethereum: { eur: 3000 } });
      }],
    ]);
    const res = await api('/api/finance/crypto?coins=btc,ETH,ZZZ&currency=eur');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['fetchedAt', 'quotes']);
    expect(body.quotes).toEqual([
      { symbol: 'BTC', name: 'Bitcoin', price: 60000.5, change24hPercent: 1.23, currency: 'EUR' },
      { symbol: 'ETH', name: 'Ethereum', price: 3000, change24hPercent: null, currency: 'EUR' },
      { symbol: 'ZZZ', name: 'ZZZ', price: null, change24hPercent: null, currency: 'EUR' },
    ]);
    expect(calledUrl).toContain('ids=bitcoin%2Cethereum');
    expect(calledUrl).toContain('vs_currencies=eur');
  });

  it('rejects bad coins / currency with 400', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `C${i}`).join(',');
    for (const q of ['', 'coins=BTC&currency=XYZ', 'coins=BTC-USD', `coins=${eleven}`]) {
      const res = await api(`/api/finance/crypto?${q}`);
      expect(res.status, q).toBe(400);
      expect((await res.json()).error, q).toBe('Invalid query parameters');
    }
    expect(upstreamUrls).toEqual([]);
  });

  it('maps a CoinGecko failure to 502', async () => {
    routeUpstream([[GECKO, () => new Response('nope', { status: 500 })]]);
    const res = await api('/api/finance/crypto?coins=SOL');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Failed to fetch crypto prices: Upstream returned 500' });
  });

  it('maps a CoinGecko rate limit (429) to 502 without leaking the body', async () => {
    routeUpstream([[GECKO, () => new Response('{"status":{"error_code":429,"error_message":"secret plan"}}', { status: 429 })]]);
    const res = await api('/api/finance/crypto?coins=DOGE');
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('secret plan');
  });
});

// ---------------------------------------------------------------- weather

const METEO = 'https://api.open-meteo.com/v1/forecast';
const CURRENT = {
  current: {
    temperature_2m: 71.26,
    apparent_temperature: 70.04,
    relative_humidity_2m: 55.4,
    wind_speed_10m: 8.6,
    wind_direction_10m: 271.2,
    wind_gusts_10m: 15.5,
    weather_code: 2,
    is_day: 1,
  },
};
const DAILY = {
  daily: {
    time: ['2026-10-21', '2026-10-22', '2026-10-23'],
    weather_code: [0, 61, 3],
    temperature_2m_max: [75.4, 68.6, 70],
    temperature_2m_min: [58.2, 55, 54],
    precipitation_probability_max: [0, 80, null],
  },
};

describe('GET /api/weather/current', () => {
  it('returns mapped current conditions', async () => {
    let calledUrl = '';
    routeUpstream([[METEO, (url) => ((calledUrl = url), json(CURRENT))]]);
    const res = await api('/api/weather/current?lat=32.7336&lon=-117.1897');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      temperature: 71.3,
      apparentTemperature: 70,
      humidity: 55,
      windSpeed: 9,
      windDirection: 271,
      windGust: 16,
      weatherCode: 2,
      isDay: true,
      units: 'imperial',
    });
    expect(typeof body.description).toBe('string');
    expect(Number.isFinite(Date.parse(body.fetchedAt))).toBe(true);
    expect(Object.keys(body).sort()).toEqual(
      ['apparentTemperature', 'description', 'fetchedAt', 'humidity', 'isDay', 'temperature', 'units', 'weatherCode', 'windDirection', 'windGust', 'windSpeed'].sort(),
    );
    expect(calledUrl).toContain('latitude=32.73&longitude=-117.19');
  });

  it('passes metric units through', async () => {
    let calledUrl = '';
    routeUpstream([[METEO, (url) => ((calledUrl = url), json(CURRENT))]]);
    const res = await api('/api/weather/current?lat=10&lon=10&units=metric');
    expect(res.status).toBe(200);
    expect((await res.json()).units).toBe('metric');
    expect(calledUrl).not.toContain('fahrenheit');
  });

  it('rejects bad coordinates and units with 400', async () => {
    for (const q of ['', 'lat=91&lon=0', 'lat=0&lon=-181', 'lat=abc&lon=0', 'lat=0', 'lat=0&lon=0&units=kelvin']) {
      const res = await api(`/api/weather/current?${q}`);
      expect(res.status, q).toBe(400);
      const body = await res.json();
      expect(body.error, q).toBe('Invalid query parameters');
      expect(body.details.length, q).toBeGreaterThan(0);
    }
    expect(upstreamUrls).toEqual([]);
  });

  it('maps an upstream error to 502, a timeout to 504 and incomplete data to 502', async () => {
    routeUpstream([[METEO, () => new Response('x', { status: 500 })]]);
    let res = await api('/api/weather/current?lat=11&lon=11');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Failed to fetch weather: Upstream returned 500' });

    upstream.mockImplementation(async () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    });
    res = await api('/api/weather/current?lat=12&lon=12');
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: 'Failed to fetch weather: Upstream timed out' });

    routeUpstream([[METEO, () => json({ current: { temperature_2m: 50 } })]]);
    res = await api('/api/weather/current?lat=13&lon=13');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Failed to fetch weather: Weather data incomplete' });
  });

  it('serves stale conditions when the upstream fails after the cache expires', async () => {
    routeUpstream([[METEO, () => json(CURRENT)]]);
    const first = await (await api('/api/weather/current?lat=14&lon=14')).json();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
    routeUpstream([[METEO, () => new Response('x', { status: 503 })]]);
    const res = await api('/api/weather/current?lat=14&lon=14');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(first);
  });
});

describe('GET /api/weather/forecast', () => {
  it('returns up to `days` complete days', async () => {
    let calledUrl = '';
    routeUpstream([[METEO, (url) => ((calledUrl = url), json(DAILY))]]);
    const res = await api('/api/weather/forecast?lat=20&lon=20&days=2');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['days', 'fetchedAt', 'units']);
    expect(body.days).toHaveLength(2);
    expect(body.days[1]).toMatchObject({ date: '2026-10-22', high: 69, low: 55, weatherCode: 61, precipitationProbability: 80 });
    expect(typeof body.days[1].description).toBe('string');
    expect(calledUrl).toContain('forecast_days=16');
    // Same cache entry serves a different `days`.
    const more = await (await api('/api/weather/forecast?lat=20&lon=20')).json();
    expect(more.days).toHaveLength(3);
    expect(more.days[2].precipitationProbability).toBeNull();
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('rejects days outside 1-16 with 400', async () => {
    for (const q of ['days=0', 'days=17', 'days=2.5', 'days=x']) {
      const res = await api(`/api/weather/forecast?lat=0&lon=0&${q}`);
      expect(res.status, q).toBe(400);
      expect((await res.json()).details[0].field, q).toBe('days');
    }
  });

  it('maps a failure to 502', async () => {
    routeUpstream([[METEO, () => json({})]]);
    const res = await api('/api/weather/forecast?lat=21&lon=21');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Failed to fetch forecast: Forecast data incomplete' });
  });
});

// ---------------------------------------------------------------- todos

interface Todo {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  completedAt: string | null;
}
const readTodosFile = () => JSON.parse(fs.readFileSync(h.todosFile, 'utf-8')) as { items: Todo[] };

describe('/api/todos', () => {
  beforeAll(() => fs.rmSync(h.todosFile, { force: true }));

  it('starts empty', async () => {
    const res = await api('/api/todos');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  it('creates, updates, reorders and deletes, persisting each change', async () => {
    const created = await sendJson('POST', '/api/todos', { text: '  Preflight the 172  ' });
    expect(created.status).toBe(201);
    const { item: a } = (await created.json()) as { item: Todo };
    expect(a).toMatchObject({ text: 'Preflight the 172', done: false, completedAt: null });
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(readTodosFile().items).toEqual([a]);

    const { item: b } = (await (await sendJson('POST', '/api/todos', { text: 'Renew medical' })).json()) as { item: Todo };
    expect((await (await api('/api/todos')).json()).items.map((t: Todo) => t.id)).toEqual([a.id, b.id]);

    const patched = await sendJson('PATCH', `/api/todos/${a.id}`, { done: true });
    expect(patched.status).toBe(200);
    const { item: doneA } = (await patched.json()) as { item: Todo };
    expect(doneA.done).toBe(true);
    expect(Number.isFinite(Date.parse(doneA.completedAt ?? ''))).toBe(true);
    expect(readTodosFile().items[0]).toEqual(doneA);

    const renamed = await (await sendJson('PATCH', `/api/todos/${b.id}`, { text: 'Renew 3rd class medical' })).json();
    expect(renamed.item.text).toBe('Renew 3rd class medical');

    const reordered = await sendJson('PUT', '/api/todos', {
      items: [
        { id: b.id, text: 'Renew 3rd class medical', done: false },
        { id: a.id, text: 'Preflight the 172', done: true },
        { id: 'new-item-1', text: 'Check NOTAMs', done: false },
      ],
    });
    expect(reordered.status).toBe(200);
    const { items } = (await reordered.json()) as { items: Todo[] };
    expect(items.map((t) => t.id)).toEqual([b.id, a.id, 'new-item-1']);
    expect(items[1].createdAt).toBe(a.createdAt);
    expect(items[1].completedAt).toBe(doneA.completedAt);

    const readBack = (await (await api('/api/todos')).json()) as { items: Todo[] };
    expect(readBack.items).toEqual(items);
    expect(readTodosFile().items).toEqual(items);

    const del = await api(`/api/todos/${a.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ success: true });
    expect(readTodosFile().items.map((t) => t.id)).toEqual([b.id, 'new-item-1']);
    expect((await api(`/api/todos/${a.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('validates bodies with 400 and the validation error shape', async () => {
    const cases: Array<[string, string, unknown]> = [
      ['POST', '/api/todos', {}],
      ['POST', '/api/todos', { text: '   ' }],
      ['POST', '/api/todos', { text: 'x'.repeat(501) }],
      ['POST', '/api/todos', { text: 42 }],
      ['PATCH', '/api/todos/new-item-1', {}],
      ['PATCH', '/api/todos/new-item-1', { done: 'yes' }],
      ['PUT', '/api/todos', { items: [{ id: '../x', text: 'a', done: false }] }],
      ['PUT', '/api/todos', { items: 'nope' }],
    ];
    const before = fs.readFileSync(h.todosFile, 'utf-8');
    for (const [method, p, body] of cases) {
      const res = await sendJson(method, p, body);
      expect(res.status, `${method} ${JSON.stringify(body)}`).toBe(400);
      const b = await res.json();
      expect(b.error).toBe('Validation failed');
      expect(Array.isArray(b.details)).toBe(true);
    }
    const nothing = await (await sendJson('PATCH', '/api/todos/new-item-1', {})).json();
    expect(nothing.details[0].message).toBe('Nothing to update');
    expect(fs.readFileSync(h.todosFile, 'utf-8')).toBe(before);
  });

  it('rejects unsafe ids with 400 and unknown ids with 404', async () => {
    for (const id of ['..%2F..%2Fetc%2Fpasswd', 'a.b', '%2e%2e%2fx', 'x'.repeat(65)]) {
      expect((await sendJson('PATCH', `/api/todos/${id}`, { done: true })).status, id).toBe(400);
      const del = await api(`/api/todos/${id}`, { method: 'DELETE' });
      expect(del.status, id).toBe(400);
      expect(await del.json()).toEqual({ error: 'Invalid id' });
    }
    for (const id of ['..', '%2e%2e', '.%2e']) {
      const del = await raw('DELETE', `/api/todos/${id}`);
      expect(del.status, `raw ${id}`).toBe(400);
      expect(JSON.parse(del.body)).toEqual({ error: 'Invalid id' });
    }
    const missing = await sendJson('PATCH', '/api/todos/does-not-exist', { done: true });
    expect(missing.status).toBe(404);
    expect(typeof (await missing.json()).error).toBe('string');
  });

  it('enforces the 200 item limit with 400', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, text: `item ${i}`, done: false }));
    expect((await sendJson('PUT', '/api/todos', { items })).status).toBe(200);
    const res = await sendJson('POST', '/api/todos', { text: 'one too many' });
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe('string');
    expect(readTodosFile().items).toHaveLength(200);
    expect((await sendJson('PUT', '/api/todos', { items: [...items, { id: 't200', text: 'x', done: false }] })).status).toBe(400);
  });
});

// ---------------------------------------------------------------- photos

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake-jpeg-body')]);

function uploadForm(buf: Buffer, field = 'photo', type = 'image/png', name = 'p.png'): FormData {
  const form = new FormData();
  form.append(field, new Blob([new Uint8Array(buf)], { type }), name);
  return form;
}
const upload = (form: FormData) => api('/api/photos', { method: 'POST', body: form });

describe('/api/photos', () => {
  const secret = path.join(h.tmp, 'secret.png');

  beforeAll(() => {
    fs.rmSync(h.photosDir, { recursive: true, force: true });
    fs.writeFileSync(secret, PNG);
  });

  it('starts empty', async () => {
    expect(await (await api('/api/photos')).json()).toEqual({ photos: [] });
  });

  it('uploads, lists, serves and deletes a photo (persisted on disk)', async () => {
    const res = await upload(uploadForm(PNG));
    expect(res.status).toBe(201);
    const { photo } = await res.json();
    expect(Object.keys(photo).sort()).toEqual(['id', 'size', 'uploadedAt', 'url']);
    expect(photo.url).toBe(`/api/photos/${photo.id}/file`);
    expect(photo.size).toBe(PNG.length);
    expect(fs.readFileSync(path.join(h.photosDir, `${photo.id}.png`))).toEqual(PNG);

    // Type comes from the bytes, not the client's MIME or filename.
    const jpg = await (await upload(uploadForm(JPEG, 'photo', 'image/png', 'lie.png'))).json();
    expect(fs.existsSync(path.join(h.photosDir, `${jpg.photo.id}.jpg`))).toBe(true);

    const list = await (await api('/api/photos')).json();
    expect(list.photos.map((p: { id: string }) => p.id).sort()).toEqual([photo.id, jpg.photo.id].sort());

    const file = await api(photo.url);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(Buffer.from(await file.arrayBuffer())).toEqual(PNG);
    expect((await api(jpg.photo.url)).headers.get('content-type')).toBe('image/jpeg');

    const del = await api(`/api/photos/${photo.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ success: true });
    expect(fs.existsSync(path.join(h.photosDir, `${photo.id}.png`))).toBe(false);
    expect((await api(photo.url)).status).toBe(404);
    expect((await api(`/api/photos/${photo.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await (await api('/api/photos')).json()).photos.map((p: { id: string }) => p.id)).toEqual([jpg.photo.id]);
  });

  it('rejects non-images with 415, a missing file with 400, the wrong field with 400', async () => {
    const before = fs.readdirSync(h.photosDir).sort();

    const html = await upload(uploadForm(Buffer.from('<html><script>alert(1)</script>'), 'photo', 'image/png'));
    expect(html.status).toBe(415);
    expect(await html.json()).toEqual({ error: 'Only JPEG, PNG and WebP images are supported' });

    const svg = await upload(uploadForm(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'photo', 'image/svg+xml', 'x.svg'));
    expect(svg.status).toBe(415);

    const none = await api('/api/photos', { method: 'POST', body: new FormData() });
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: 'No photo uploaded (field "photo")' });

    const wrongField = await upload(uploadForm(PNG, 'image'));
    expect(wrongField.status).toBe(400);
    expect((await wrongField.json()).error).toMatch(/^Upload rejected/);

    const notMultipart = await sendJson('POST', '/api/photos', { photo: 'x' });
    expect(notMultipart.status).toBe(400);

    expect(fs.readdirSync(h.photosDir).sort()).toEqual(before);
  });

  it('rejects files over 10 MB with 413', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    PNG.copy(big);
    const res = await upload(uploadForm(big));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Photo must be 10 MB or smaller' });
  });

  it('rejects path traversal in the id for file and delete', async () => {
    const attempts = [
      '..%2Fsecret',
      '..%2F..%2Fsecret',
      '%2e%2e%2fsecret',
      '..%5Csecret',
      'secret.png',
      'photos%2F..%2Fsecret',
      `${'a'.repeat(65)}`,
      '%00secret',
    ];
    for (const id of attempts) {
      const get = await api(`/api/photos/${id}/file`);
      expect(get.status, `GET ${id}`).toBe(400);
      expect(await get.json()).toEqual({ error: 'Invalid id' });
      const del = await api(`/api/photos/${id}`, { method: 'DELETE' });
      expect(del.status, `DELETE ${id}`).toBe(400);
    }
    // Literal dot segments sent raw (a browser/fetch would normalize them away).
    for (const id of ['..', '%2e%2e', '.%2E', '..%2f..%2fsecret']) {
      const get = await raw('GET', `/api/photos/${id}/file`);
      expect(get.status, `raw GET ${id}`).toBe(400);
      expect(JSON.parse(get.body)).toEqual({ error: 'Invalid id' });
      expect((await raw('DELETE', `/api/photos/${id}`)).status, `raw DELETE ${id}`).toBe(400);
    }
    // Raw `..` segments that would climb out of /api/photos never serve the file.
    for (const p of ['/api/photos/../../secret.png', '/api/photos/x/../../../secret.png', '/api/photos/%2e%2e/%2e%2e/secret.png']) {
      const res = await raw('GET', p);
      expect(res.status, p).not.toBe(200);
      expect(res.body, p).not.toContain('fake-png-body');
    }
    expect(fs.existsSync(secret)).toBe(true);
    // A safe id that names a file outside the store is just "not found".
    expect((await api('/api/photos/secret/file')).status).toBe(404);
  });
});

describe('repo data/ directory', () => {
  it('was not touched by these tests', () => {
    expect(repoDataPaths.map(snapshot)).toEqual(repoDataBefore);
  });
});
