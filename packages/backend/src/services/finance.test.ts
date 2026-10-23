import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseYahooChart,
  parseCloudQuote,
  yahooHistory,
  normalizeSymbol,
  Pacer,
  getStockQuotes,
  stockProvider,
  setSkyglassServiceUrl,
  resetSkyglassServiceState,
  resetYahooCooldown,
  clearFinanceCaches,
  type YahooChartResponse,
  type CloudQuote,
} from './finance.js';

// Trimmed sample of GET query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1mo&interval=1d
const AAPL: YahooChartResponse = {
  chart: {
    result: [
      {
        meta: {
          currency: 'USD',
          symbol: 'AAPL',
          regularMarketPrice: 233.75,
          regularMarketTime: 1792008000,
          longName: 'Apple Inc.',
          shortName: 'Apple Inc.',
          chartPreviousClose: 220.1,
          previousClose: 230.25,
        },
        indicators: { quote: [{ close: [226, 227.5, null, 230.25, 233.75] }] },
      },
    ],
    error: null,
  },
};

const NOT_FOUND: YahooChartResponse = {
  chart: {
    result: null,
    error: { code: 'Not Found', description: 'No data found, symbol may be delisted' },
  },
};

describe('parseYahooChart', () => {
  it('maps meta and closes, dropping nulls', () => {
    expect(parseYahooChart('AAPL', AAPL)).toEqual({
      symbol: 'AAPL',
      name: 'Apple Inc.',
      price: 233.75,
      change: 3.5,
      changePercent: 1.52,
      currency: 'USD',
      history: [226, 227.5, 230.25, 233.75],
      asOf: new Date(1792008000 * 1000).toISOString(),
    });
  });

  it('falls back to chartPreviousClose and longName', () => {
    const body = structuredClone(AAPL);
    const meta = body.chart!.result![0].meta!;
    delete meta.previousClose;
    delete meta.shortName;
    const q = parseYahooChart('AAPL', body);
    expect(q.change).toBe(13.65);
    expect(q.changePercent).toBe(6.2);
    expect(q.name).toBe('Apple Inc.');
  });

  it('caps history at 30 points', () => {
    const body = structuredClone(AAPL);
    body.chart!.result![0].indicators = {
      quote: [{ close: Array.from({ length: 40 }, (_, i) => i) }],
    };
    expect(parseYahooChart('AAPL', body).history).toHaveLength(30);
  });

  it('returns null fields for an error response or missing result', () => {
    const empty = {
      symbol: 'ZZZZ',
      name: null,
      price: null,
      change: null,
      changePercent: null,
      currency: 'USD',
      history: [],
      asOf: null,
    };
    expect(parseYahooChart('ZZZZ', NOT_FOUND)).toEqual(empty);
    expect(parseYahooChart('ZZZZ', { chart: { result: [], error: null } })).toEqual(empty);
    expect(parseYahooChart('ZZZZ', {} as YahooChartResponse)).toEqual(empty);
  });

  it('leaves change null without a previous close', () => {
    const body = structuredClone(AAPL);
    const meta = body.chart!.result![0].meta!;
    delete meta.previousClose;
    delete meta.chartPreviousClose;
    expect(parseYahooChart('AAPL', body)).toMatchObject({
      price: 233.75,
      change: null,
      changePercent: null,
    });
  });
});

describe('helpers', () => {
  it('normalizes and validates symbols', () => {
    expect(normalizeSymbol(' msft ')).toBe('MSFT');
    expect(normalizeSymbol('../etc')).toBeNull();
  });

  it('Pacer runs calls one at a time with a gap', async () => {
    const pacer = new Pacer(20);
    let active = 0;
    let peak = 0;
    const starts: number[] = [];
    const out = await Promise.all(
      [1, 2, 3].map((n) =>
        pacer.run(async () => {
          starts.push(Date.now());
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
          return n * 2;
        })
      )
    );
    expect(out).toEqual([2, 4, 6]);
    expect(peak).toBe(1);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(18);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(18);
  });

  it('Pacer enforces a per-minute cap and survives failures', async () => {
    const sleeps: number[] = [];
    const pacer = new Pacer(0, 2, async (ms) => {
      sleeps.push(ms);
    });
    await pacer.run(async () => 1);
    await expect(pacer.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await pacer.run(async () => 3);
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThan(59_000);
  });
});

// Items of GET https://skyglass.dev/api/data/stocks?symbols=X (the cloud normalizes Finnhub /quote)
const CLOUD_AAPL: CloudQuote = {
  symbol: 'AAPL',
  status: 'ok',
  price: 233.75,
  change: 3.5,
  changePercent: 1.5201,
  previousClose: 230.25,
  asOf: new Date(1792008000 * 1000).toISOString(),
};

describe('parseCloudQuote', () => {
  it('maps price/change/asOf with name and history', () => {
    expect(parseCloudQuote('AAPL', CLOUD_AAPL, 'Apple Inc', [1, 2, 3])).toEqual({
      symbol: 'AAPL',
      name: 'Apple Inc',
      price: 233.75,
      change: 3.5,
      changePercent: 1.52,
      currency: 'USD',
      history: [1, 2, 3],
      asOf: new Date(1792008000 * 1000).toISOString(),
    });
  });

  it('unknown symbol → null fields; error/mismatch/malformed → null', () => {
    expect(parseCloudQuote('ZZZZ', { symbol: 'ZZZZ', status: 'unknown_symbol' })).toMatchObject({
      symbol: 'ZZZZ',
      price: null,
      change: null,
    });
    expect(parseCloudQuote('AAPL', { ...CLOUD_AAPL, status: 'error' })).toBeNull();
    expect(parseCloudQuote('MSFT', CLOUD_AAPL)).toBeNull();
    expect(parseCloudQuote('AAPL', null)).toBeNull();
    expect(parseCloudQuote('AAPL', { symbol: 'AAPL', status: 'ok', price: null })).toBeNull();
  });
});

describe('yahooHistory', () => {
  it('extracts closes for the sparkline and is empty on errors', () => {
    expect(yahooHistory(AAPL)).toEqual([226, 227.5, 230.25, 233.75]);
    expect(yahooHistory(NOT_FOUND)).toEqual([]);
  });
});

// ---------------------------------------------------------------- provider selection (mocked fetch)

type Call = { url: string; headers: Record<string, string> };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function installFetch(cloud: (url: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      url: url.toString(),
      headers: { ...((init?.headers as Record<string, string>) ?? {}) },
    });
    if (url.hostname === 'query1.finance.yahoo.com') return json(200, AAPL);
    return cloud(url);
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const cloudOk = (url: URL) => {
  if (url.pathname === '/api/data/stocks') {
    const sym = url.searchParams.get('symbols');
    if (sym === 'ZZZZ')
      return json(200, {
        version: 1,
        fetchedAt: 'x',
        quotes: [{ symbol: 'ZZZZ', status: 'unknown_symbol' }],
      });
    return json(200, { version: 1, fetchedAt: 'x', quotes: [{ ...CLOUD_AAPL, symbol: sym }] });
  }
  if (url.pathname === '/api/data/stock-profiles') {
    return json(200, {
      version: 1,
      fetchedAt: 'x',
      profiles: [
        {
          symbol: url.searchParams.get('symbols'),
          status: 'ok',
          name: 'Apple Inc',
          currency: 'USD',
          exchange: 'NASDAQ',
        },
      ],
    });
  }
  return json(404, {});
};

function assertNoKeys(calls: Call[]) {
  for (const c of calls) {
    expect(c.url).not.toMatch(/token=|apikey|api_key|client_secret/i);
    for (const k of Object.keys(c.headers))
      expect(k.toLowerCase()).not.toMatch(/token|key|secret|client_id|authorization/);
  }
}

describe('getStockQuotes provider selection', () => {
  beforeEach(() => {
    clearFinanceCaches();
    resetYahooCooldown();
    setSkyglassServiceUrl('https://skyglass.dev');
    resetSkyglassServiceState();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the SkyGlass service (quote + name) with Yahoo history; response shape unchanged; no key sent', async () => {
    const calls = installFetch(cloudOk);
    const r = await getStockQuotes(['AAPL', 'ZZZZ']);
    expect(Object.keys(r).sort()).toEqual(['fetchedAt', 'quotes']);
    expect(r.quotes[0]).toEqual({
      symbol: 'AAPL',
      name: 'Apple Inc',
      price: 233.75,
      change: 3.5,
      changePercent: 1.52,
      currency: 'USD',
      history: [226, 227.5, 230.25, 233.75],
      asOf: new Date(1792008000 * 1000).toISOString(),
    });
    expect(r.quotes[1]).toEqual({
      symbol: 'ZZZZ',
      name: null,
      price: null,
      change: null,
      changePercent: null,
      currency: 'USD',
      history: [],
      asOf: null,
    });
    const cloudCalls = calls.filter((c) => c.url.startsWith('https://skyglass.dev/'));
    expect(cloudCalls.map((c) => c.url)).toEqual([
      'https://skyglass.dev/api/data/stocks?symbols=AAPL',
      'https://skyglass.dev/api/data/stock-profiles?symbols=AAPL',
      'https://skyglass.dev/api/data/stocks?symbols=ZZZZ',
    ]);
    // unknown symbol: no Yahoo fallback / history call for it
    expect(calls.filter((c) => c.url.includes('yahoo')).length).toBe(1);
    expect(calls.some((c) => c.url.includes('finnhub.io'))).toBe(false);
    assertNoKeys(calls);
    expect(stockProvider()).toBe('skyglass');
  });

  it('encodes index symbols in the canonical form the service expects', async () => {
    const calls = installFetch(cloudOk);
    await getStockQuotes(['^GSPC']);
    expect(calls[0].url).toBe('https://skyglass.dev/api/data/stocks?symbols=%5EGSPC');
  });

  it('not_configured → Yahoo, and the service is not asked again for a while', async () => {
    const calls = installFetch(() =>
      json(503, { error: 'not_configured', error_description: 'x' })
    );
    const r = await getStockQuotes(['AAPL', 'MSFT']);
    expect(r.quotes[0]).toMatchObject({
      symbol: 'AAPL',
      price: 233.75,
      name: 'Apple Inc.',
      history: [226, 227.5, 230.25, 233.75],
    });
    const cloudCalls = calls.filter((c) => c.url.includes('skyglass.dev'));
    expect(cloudCalls).toHaveLength(1); // MSFT went straight to Yahoo
    expect(stockProvider()).toBe('yahoo');
    expect(stockProvider(Date.now() + 11 * 60 * 1000)).toBe('skyglass');
    assertNoKeys(calls);
  });

  it('unreachable service → Yahoo fallback', async () => {
    const calls = installFetch(() => {
      throw new TypeError('fetch failed');
    });
    const r = await getStockQuotes(['AAPL']);
    expect(r.quotes[0]).toMatchObject({ symbol: 'AAPL', price: 233.75 });
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual([
      'skyglass.dev',
      'query1.finance.yahoo.com',
    ]);
    expect(stockProvider()).toBe('yahoo');
    expect(stockProvider(Date.now() + 3 * 60 * 1000)).toBe('skyglass');
  });

  it('per-symbol upstream error from the service → Yahoo for that symbol, service stays in use', async () => {
    const calls = installFetch((url) =>
      url.pathname === '/api/data/stocks'
        ? json(200, {
            version: 1,
            quotes: [{ symbol: url.searchParams.get('symbols'), status: 'error' }],
          })
        : cloudOk(url)
    );
    const r = await getStockQuotes(['AAPL']);
    expect(r.quotes[0]).toMatchObject({ price: 233.75, name: 'Apple Inc.' });
    expect(stockProvider()).toBe('skyglass');
    expect(calls.some((c) => c.url.includes('yahoo'))).toBe(true);
  });

  it('invalid skyglass_service (null) → Yahoo only, no service calls', async () => {
    setSkyglassServiceUrl(null);
    const calls = installFetch(cloudOk);
    const r = await getStockQuotes(['AAPL']);
    expect(r.quotes[0].price).toBe(233.75);
    expect(calls.every((c) => c.url.includes('yahoo'))).toBe(true);
  });

  it('serves the cached quote within the 5 min TTL without new calls', async () => {
    const calls = installFetch(cloudOk);
    await getStockQuotes(['AAPL']);
    const n = calls.length;
    await getStockQuotes(['AAPL']);
    expect(calls.length).toBe(n);
  });
});
