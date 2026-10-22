/**
 * Shared helpers for third-party upstream calls (news, finance, weather,
 * winds aloft): fetch with a hard timeout and response size cap, plus an
 * in-memory TTL cache that serves the last good value when the upstream fails.
 *
 * Route handlers should catch UpstreamError and return a generic message;
 * raw upstream error text is never sent to clients.
 */

export const USER_AGENT = 'SkyGlass/1.0 (+https://skyglass.dev)';

/** Error type for any upstream failure. `message` is safe to show clients. */
export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export interface FetchTextOptions {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  redirect?: 'follow' | 'manual' | 'error';
}

/**
 * Read a response body as text, aborting once more than `maxBytes` arrive.
 */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new UpstreamError('Upstream response too large');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new UpstreamError('Upstream response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * GET a URL and return its body text. Throws UpstreamError on timeout,
 * network failure, non-2xx status or oversize body.
 */
export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<string> {
  const { timeoutMs = 10_000, maxBytes = 2 * 1024 * 1024, headers = {}, redirect = 'follow' } = opts;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
      redirect,
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new UpstreamError(timedOut ? 'Upstream timed out' : 'Upstream unreachable', timedOut ? 504 : 502);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new UpstreamError(`Upstream returned ${res.status}`);
  }
  return readBodyCapped(res, maxBytes);
}

export async function fetchJson<T>(url: string, opts: FetchTextOptions = {}): Promise<T> {
  const text = await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError('Upstream returned invalid JSON');
  }
}

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

export interface CachedResult<T> {
  value: T;
  /** True when the upstream failed and an expired value was served. */
  stale: boolean;
  storedAt: number;
}

/**
 * Per-key TTL cache with stale-on-error fallback and in-flight de-duplication.
 */
export class TtlCache<T> {
  private entries = new Map<string, CacheEntry<T>>();
  private inflight = new Map<string, Promise<CachedResult<T>>>();

  constructor(
    private readonly ttlMs: number,
    /** Entries older than this are dropped entirely (not even served stale). */
    private readonly maxStaleMs = 24 * 60 * 60 * 1000,
    private readonly maxEntries = 200,
  ) {}

  async get(key: string, loader: () => Promise<T>, now = Date.now()): Promise<CachedResult<T>> {
    const hit = this.entries.get(key);
    if (hit && now - hit.storedAt < this.ttlMs) {
      return { value: hit.value, stale: false, storedAt: hit.storedAt };
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const p = (async (): Promise<CachedResult<T>> => {
      try {
        const value = await loader();
        const storedAt = Date.now();
        this.set(key, value, storedAt);
        return { value, stale: false, storedAt };
      } catch (error) {
        if (hit && now - hit.storedAt < this.maxStaleMs) {
          console.warn(`[upstream] serving stale value for ${key}:`, error instanceof Error ? error.message : error);
          return { value: hit.value, stale: true, storedAt: hit.storedAt };
        }
        throw error instanceof UpstreamError ? error : new UpstreamError('Upstream request failed');
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  set(key: string, value: T, storedAt = Date.now()): void {
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }
}

/** Express helper: map any error to a safe `{ error }` JSON response. */
export function upstreamErrorResponse(error: unknown, fallback: string): { status: number; body: { error: string } } {
  if (error instanceof UpstreamError) {
    return { status: error.status, body: { error: `${fallback}: ${error.message}` } };
  }
  return { status: 502, body: { error: fallback } };
}
