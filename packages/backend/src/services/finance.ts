/**
 * Finance Service
 *
 * Stocks: the SkyGlass cloud service (config `skyglass_service`), which holds
 * the Finnhub key and CDN-caches quotes (GET /api/data/stocks) and company
 * names (GET /api/data/stock-profiles), so the mirror holds no key. When the
 * service is unreachable or has no Finnhub key configured, the mirror falls
 * back to the keyless Yahoo Finance chart endpoint, called directly. Yahoo
 * also supplies the sparkline history in cloud mode. Yahoo throttles bursts
 * per IP, so Yahoo calls are made one at a time with a gap, and a 429 puts
 * Yahoo into a 10 minute cooldown (cached/stale quotes are served meanwhile).
 * See docs/CLOUD_SERVICE.md.
 *
 * Crypto: CoinGecko's public simple/price endpoint.
 */

import { TtlCache, UpstreamError, fetchJson, readBodyCapped } from './upstream.js';
import { DEFAULT_SKYGLASS_SERVICE, getSkyglassJson, type ServiceFailure } from './skyglass-service.js';

export const STOCK_CACHE_TTL_MS = 5 * 60 * 1000;
export const CRYPTO_CACHE_TTL_MS = 2 * 60 * 1000;
export const NAME_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_STOCK_SYMBOLS = 12;
export const MAX_CRYPTO_COINS = 10;
export const HISTORY_POINTS = 30;
/** Minimum gap between Yahoo calls. */
export const STOCK_CALL_GAP_MS = 300;
export const YAHOO_COOLDOWN_MS = 10 * 60 * 1000;
/** After the cloud says not_configured, use Yahoo for this long before asking again. */
export const SERVICE_NOT_CONFIGURED_RETRY_MS = 10 * 60 * 1000;
/** After the cloud is unreachable / rate limited / answers nonsense, retry after this. */
export const SERVICE_FAILURE_RETRY_MS = 2 * 60 * 1000;

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
// Yahoo rejects non-browser user agents.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// ============= Stocks =============

export interface StockQuote {
  symbol: string;
  name: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  currency: 'USD';
  history: number[];
  asOf: string | null;
}

export function emptyQuote(symbol: string): StockQuote {
  return { symbol, name: null, price: null, change: null, changePercent: null, currency: 'USD', history: [], asOf: null };
}

/** Normalize a user symbol: uppercase, allow letters/digits/.-^ only. */
export function normalizeSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return /^[A-Z0-9^][A-Z0-9.^-]{0,14}$/.test(s) ? s : null;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Serializes calls: at least `gapMs` between starts and, optionally, no more
 * than `perMinute` starts in any 60 s window. Shared across requests.
 */
export class Pacer {
  private chain: Promise<unknown> = Promise.resolve();
  private lastStart = 0;
  private starts: number[] = [];

  constructor(
    private readonly gapMs: number,
    private readonly perMinute = Infinity,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      let wait = Math.max(0, this.lastStart + this.gapMs - Date.now());
      const now = Date.now();
      this.starts = this.starts.filter((t) => now - t < 60_000);
      if (this.starts.length >= this.perMinute) {
        wait = Math.max(wait, this.starts[0] + 60_000 - now);
      }
      if (wait > 0) await this.sleep(wait);
      this.lastStart = Date.now();
      this.starts.push(this.lastStart);
      return fn();
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}

const yahooPacer = new Pacer(STOCK_CALL_GAP_MS);

let yahooCooldownUntil = 0;

export function isYahooCoolingDown(now = Date.now()): boolean {
  return now < yahooCooldownUntil;
}

/** Test hook. */
export function resetYahooCooldown(): void {
  yahooCooldownUntil = 0;
}

// ----- SkyGlass service state -----

let serviceBase: string | null = DEFAULT_SKYGLASS_SERVICE;
let serviceDownUntil = 0;
let serviceDownReason: ServiceFailure | null = null;

/** Set from config (`skyglass_service`, normalized); null (invalid) → Yahoo only. */
export function setSkyglassServiceUrl(base: string | null): void {
  if (base !== serviceBase) resetSkyglassServiceState();
  serviceBase = base;
}

/** Test hook / config change: forget a previous "service down" verdict. */
export function resetSkyglassServiceState(): void {
  serviceDownUntil = 0;
  serviceDownReason = null;
}

function markServiceDown(reason: ServiceFailure): void {
  const wait = reason === 'not_configured' ? SERVICE_NOT_CONFIGURED_RETRY_MS : SERVICE_FAILURE_RETRY_MS;
  if (serviceDownReason !== reason) {
    const why =
      reason === 'not_configured'
        ? 'has no Finnhub key configured'
        : reason === 'rate_limited'
          ? 'is rate limiting requests'
          : reason === 'bad_response'
            ? 'returned an unusable response'
            : "can't be reached";
    console.warn(`[finance] SkyGlass service ${why}; using Yahoo for stock quotes for ${wait / 60000} min`);
  }
  serviceDownReason = reason;
  serviceDownUntil = Date.now() + wait;
}

export function stockProvider(now = Date.now()): 'skyglass' | 'yahoo' {
  return serviceBase && now >= serviceDownUntil ? 'skyglass' : 'yahoo';
}

export interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        shortName?: string;
        longName?: string;
        currency?: string;
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        regularMarketTime?: number;
      };
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
}

/**
 * Map a Yahoo chart response to the API shape. A chart error or missing
 * result yields a quote with null fields.
 */
export function parseYahooChart(symbol: string, body: YahooChartResponse): StockQuote {
  const chart = body?.chart;
  const result = chart?.result?.[0];
  if (!chart || chart.error || !result?.meta) return emptyQuote(symbol);
  const meta = result.meta;
  const price = finite(meta.regularMarketPrice);
  const prev = finite(meta.previousClose) ?? finite(meta.chartPreviousClose);
  const change = price !== null && prev !== null ? round(price - prev, 4) : null;
  const changePercent = change !== null && prev ? round((change / prev) * 100, 2) : null;
  const closes = (result.indicators?.quote?.[0]?.close ?? []).filter(
    (c): c is number => typeof c === 'number' && Number.isFinite(c),
  );
  const time = finite(meta.regularMarketTime);
  return {
    symbol,
    name: meta.shortName?.trim() || meta.longName?.trim() || null,
    price,
    change,
    changePercent,
    currency: 'USD',
    history: closes.slice(-HISTORY_POINTS),
    asOf: time !== null ? new Date(time * 1000).toISOString() : null,
  };
}

/**
 * Fetch one chart (paced, never retried). Yahoo answers unknown symbols with
 * 404 + a JSON chart.error body. A 429 starts the cooldown; during cooldown
 * no request is made and the call fails fast so callers serve cached data.
 */
async function fetchYahooChart(symbol: string): Promise<YahooChartResponse> {
  if (isYahooCoolingDown()) throw new UpstreamError('Quote provider rate limited, using cached data', 503);
  return yahooPacer.run(async () => {
    if (isYahooCoolingDown()) throw new UpstreamError('Quote provider rate limited, using cached data', 503);
    const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new UpstreamError(timedOut ? 'Upstream timed out' : 'Upstream unreachable', timedOut ? 504 : 502);
    }
    if (res.status === 429) {
      await res.body?.cancel().catch(() => undefined);
      yahooCooldownUntil = Date.now() + YAHOO_COOLDOWN_MS;
      console.warn(`[finance] Yahoo returned 429; pausing Yahoo calls for ${YAHOO_COOLDOWN_MS / 60000} min`);
      throw new UpstreamError('Quote provider rate limited, using cached data', 503);
    }
    if (!res.ok && res.status !== 404) {
      await res.body?.cancel().catch(() => undefined);
      throw new UpstreamError(`Upstream returned ${res.status}`);
    }
    const text = await readBodyCapped(res, 512 * 1024);
    try {
      return JSON.parse(text) as YahooChartResponse;
    } catch {
      throw new UpstreamError('Upstream returned invalid JSON');
    }
  });
}

/** Daily closes from a Yahoo chart response (nulls dropped, last 30). */
export function yahooHistory(body: YahooChartResponse): number[] {
  const result = body?.chart?.result?.[0];
  if (body?.chart?.error || !result) return [];
  return (result.indicators?.quote?.[0]?.close ?? [])
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c))
    .slice(-HISTORY_POINTS);
}

// ----- SkyGlass service (Finnhub upstream) -----

/** One item of GET /api/data/stocks. */
export interface CloudQuote {
  symbol?: string;
  status?: 'ok' | 'unknown_symbol' | 'error';
  price?: number | null;
  change?: number | null;
  changePercent?: number | null;
  previousClose?: number | null;
  asOf?: string | null;
}

/**
 * Map a cloud quote to the API shape. Returns null when the item is missing,
 * malformed or reports an upstream error (callers treat that as a failure);
 * an unknown symbol yields null fields.
 */
export function parseCloudQuote(
  symbol: string,
  item: CloudQuote | null | undefined,
  name: string | null = null,
  history: number[] = [],
): StockQuote | null {
  if (!item || typeof item !== 'object' || item.symbol !== symbol) return null;
  if (item.status === 'unknown_symbol') return emptyQuote(symbol);
  if (item.status !== 'ok') return null;
  const price = finite(item.price);
  if (price === null) return null;
  const change = finite(item.change);
  const changePercent = finite(item.changePercent);
  const asOf = typeof item.asOf === 'string' && Number.isFinite(Date.parse(item.asOf)) ? new Date(item.asOf).toISOString() : null;
  return {
    symbol,
    name,
    price,
    change: change !== null ? round(change, 4) : null,
    changePercent: changePercent !== null ? round(changePercent, 2) : null,
    currency: 'USD',
    history: history.slice(-HISTORY_POINTS),
    asOf,
  };
}

/** Thrown when the service as a whole is unavailable (caller falls back to Yahoo). */
class ServiceUnavailableError extends UpstreamError {
  constructor() {
    super('Quote service unavailable', 503);
  }
}

/** GET a cloud data endpoint; marks the service down on service-level failures. */
async function serviceGet(pathAndQuery: string): Promise<unknown> {
  if (stockProvider() !== 'skyglass') throw new ServiceUnavailableError();
  const res = await getSkyglassJson(serviceBase, pathAndQuery, { maxBytes: 256 * 1024 });
  if (res.ok) return res.json;
  if (res.reason === 'rejected') throw new UpstreamError('Quote service rejected the request');
  markServiceDown(res.reason);
  throw new ServiceUnavailableError();
}

function firstItem(json: unknown, list: 'quotes' | 'profiles'): Record<string, unknown> | null {
  if (!json || typeof json !== 'object') return null;
  const body = json as Record<string, unknown>;
  if (body.version !== 1 || !Array.isArray(body[list])) return null;
  const item = (body[list] as unknown[])[0];
  return item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
}

const nameCache = new TtlCache<string | null>(NAME_CACHE_TTL_MS);

async function serviceName(symbol: string): Promise<string | null> {
  try {
    const result = await nameCache.get(symbol, async () => {
      const item = firstItem(await serviceGet(`/api/data/stock-profiles?symbols=${encodeURIComponent(symbol)}`), 'profiles');
      if (!item || item.symbol !== symbol || item.status === 'error') throw new UpstreamError('No profile');
      return typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null;
    });
    return result.value;
  } catch {
    return null; // name is optional
  }
}

async function loadServiceQuote(symbol: string): Promise<StockQuote> {
  const json = await serviceGet(`/api/data/stocks?symbols=${encodeURIComponent(symbol)}`);
  const base = parseCloudQuote(symbol, firstItem(json, 'quotes') as CloudQuote | null);
  if (!base) throw new UpstreamError('Quote unavailable');
  if (base.price === null) return base; // unknown symbol: skip name/history calls
  const name = await serviceName(symbol);
  let history: number[] = [];
  if (!isYahooCoolingDown()) {
    try {
      history = yahooHistory(await fetchYahooChart(symbol));
    } catch {
      history = [];
    }
  }
  return { ...base, name, history };
}

async function loadYahooQuote(symbol: string): Promise<StockQuote> {
  return parseYahooChart(symbol, await fetchYahooChart(symbol));
}

const quoteCache = new TtlCache<StockQuote>(STOCK_CACHE_TTL_MS);

/** Test hook. */
export function clearFinanceCaches(): void {
  quoteCache.clear();
  nameCache.clear();
  cryptoCache.clear();
}

/**
 * Quotes for up to 12 symbols, fetched sequentially. Each symbol comes from
 * the SkyGlass service when it is usable; if that fails (with nothing cached)
 * the symbol is fetched from Yahoo instead. Per-symbol failures give null
 * fields (or the stale cached quote); 502 only when every symbol fails with
 * nothing cached.
 */
export async function getStockQuotes(symbols: string[]): Promise<{ quotes: StockQuote[]; fetchedAt: string }> {
  const results: Array<StockQuote | null> = [];
  for (const symbol of symbols) {
    let quote: StockQuote | null = null;
    if (stockProvider() === 'skyglass') {
      try {
        quote = (await quoteCache.get(`skyglass|${symbol}`, () => loadServiceQuote(symbol))).value;
      } catch {
        quote = null;
      }
    }
    if (!quote) {
      try {
        quote = (await quoteCache.get(`yahoo|${symbol}`, () => loadYahooQuote(symbol))).value;
      } catch {
        quote = null;
      }
    }
    results.push(quote);
  }
  if (symbols.length > 0 && results.every((r) => r === null)) {
    throw new UpstreamError('Stock quotes unavailable');
  }
  return { quotes: results.map((q, i) => q ?? emptyQuote(symbols[i])), fetchedAt: new Date().toISOString() };
}

// ============= Crypto =============

/** Symbol → CoinGecko id + display name for the most common coins. */
export const COIN_IDS: Record<string, { id: string; name: string }> = {
  BTC: { id: 'bitcoin', name: 'Bitcoin' },
  ETH: { id: 'ethereum', name: 'Ethereum' },
  USDT: { id: 'tether', name: 'Tether' },
  BNB: { id: 'binancecoin', name: 'BNB' },
  SOL: { id: 'solana', name: 'Solana' },
  XRP: { id: 'ripple', name: 'XRP' },
  USDC: { id: 'usd-coin', name: 'USD Coin' },
  DOGE: { id: 'dogecoin', name: 'Dogecoin' },
  ADA: { id: 'cardano', name: 'Cardano' },
  TRX: { id: 'tron', name: 'TRON' },
  TON: { id: 'the-open-network', name: 'Toncoin' },
  AVAX: { id: 'avalanche-2', name: 'Avalanche' },
  SHIB: { id: 'shiba-inu', name: 'Shiba Inu' },
  DOT: { id: 'polkadot', name: 'Polkadot' },
  LINK: { id: 'chainlink', name: 'Chainlink' },
  BCH: { id: 'bitcoin-cash', name: 'Bitcoin Cash' },
  LTC: { id: 'litecoin', name: 'Litecoin' },
  NEAR: { id: 'near', name: 'NEAR Protocol' },
  MATIC: { id: 'matic-network', name: 'Polygon' },
  POL: { id: 'polygon-ecosystem-token', name: 'POL (ex-MATIC)' },
  UNI: { id: 'uniswap', name: 'Uniswap' },
  XLM: { id: 'stellar', name: 'Stellar' },
  ICP: { id: 'internet-computer', name: 'Internet Computer' },
  DAI: { id: 'dai', name: 'Dai' },
  ETC: { id: 'ethereum-classic', name: 'Ethereum Classic' },
  APT: { id: 'aptos', name: 'Aptos' },
  XMR: { id: 'monero', name: 'Monero' },
  ATOM: { id: 'cosmos', name: 'Cosmos' },
  FIL: { id: 'filecoin', name: 'Filecoin' },
  HBAR: { id: 'hedera-hashgraph', name: 'Hedera' },
  ARB: { id: 'arbitrum', name: 'Arbitrum' },
  OP: { id: 'optimism', name: 'Optimism' },
  VET: { id: 'vechain', name: 'VeChain' },
  ALGO: { id: 'algorand', name: 'Algorand' },
  SUI: { id: 'sui', name: 'Sui' },
  AAVE: { id: 'aave', name: 'Aave' },
  INJ: { id: 'injective-protocol', name: 'Injective' },
  PEPE: { id: 'pepe', name: 'Pepe' },
  XTZ: { id: 'tezos', name: 'Tezos' },
  EOS: { id: 'eos', name: 'EOS' },
  SAND: { id: 'the-sandbox', name: 'The Sandbox' },
  MANA: { id: 'decentraland', name: 'Decentraland' },
};

export const CRYPTO_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF'] as const;
export type CryptoCurrency = (typeof CRYPTO_CURRENCIES)[number];

export interface CryptoQuote {
  symbol: string;
  name: string;
  price: number | null;
  change24hPercent: number | null;
  currency: string;
}

type SimplePrice = Record<string, Record<string, number | undefined>>;

const cryptoCache = new TtlCache<SimplePrice>(CRYPTO_CACHE_TTL_MS);

/** Unknown symbols are returned with null price rather than failing the request. */
export async function getCryptoQuotes(
  coins: string[],
  currency: CryptoCurrency,
): Promise<{ quotes: CryptoQuote[]; fetchedAt: string }> {
  const known = coins.filter((c) => COIN_IDS[c]);
  const ids = [...new Set(known.map((c) => COIN_IDS[c].id))].sort();
  const vs = currency.toLowerCase();
  let data: SimplePrice = {};
  let fetchedAt = new Date().toISOString();
  if (ids.length > 0) {
    const key = `${ids.join(',')}|${vs}`;
    const url = `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=${vs}&include_24hr_change=true`;
    const result = await cryptoCache.get(key, () => fetchJson<SimplePrice>(url, { timeoutMs: 8000, maxBytes: 256 * 1024 }));
    data = result.value;
    fetchedAt = new Date(result.storedAt).toISOString();
  }
  const quotes = coins.map((symbol): CryptoQuote => {
    const meta = COIN_IDS[symbol];
    const entry = meta ? data[meta.id] : undefined;
    const price = entry?.[vs];
    const change = entry?.[`${vs}_24h_change`];
    return {
      symbol,
      name: meta?.name ?? symbol,
      price: typeof price === 'number' ? price : null,
      change24hPercent: typeof change === 'number' ? Math.round(change * 100) / 100 : null,
      currency,
    };
  });
  return { quotes, fetchedAt };
}
