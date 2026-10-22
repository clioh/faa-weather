/**
 * SkyGlass data service: keyed upstream APIs proxied for mirrors so no
 * third-party API key ever lives on a mirror.
 *
 *   GET /api/data/notams?icao=KSAN               FAA NOTAM API (client_id/client_secret)
 *   GET /api/data/stocks?symbols=AAPL,MSFT       Finnhub /quote
 *   GET /api/data/stock-profiles?symbols=AAPL    Finnhub /stock/profile2 (company name)
 *
 * Responses are compact normalized JSON (never raw upstream bodies) and are
 * cached on the Vercel CDN via `Cache-Control: s-maxage` so many mirrors share
 * one upstream call. Inputs are normalized; a non-canonical query (lowercase,
 * unsorted, duplicates, extra params) gets a cacheable 308 to the canonical URL
 * so the CDN cache key is stable and can't be trivially busted.
 *
 * Secrets are read from env per request, sent only to the upstream, and never
 * logged or echoed. Only error categories are logged.
 *
 * Lives under api/_lib/ so Vercel does not deploy it as a function.
 */

import {
  RateLimiter,
  clientIp,
  errorResult,
  type FetchLike,
  type HandlerResult,
  type Headers,
  type Logger,
  type ResponseLike,
} from './oauth.js'

export { RateLimiter }
export type { FetchLike, HandlerResult }

export const DEFAULT_FAA_NOTAM_URL = 'https://external-api.faa.gov/notamapi/v1/notams'
export const FINNHUB_BASE = 'https://finnhub.io/api/v1'
export const UPSTREAM_TIMEOUT_MS = 10_000

export const ICAO_RE = /^[A-Z0-9]{3,4}$/
export const SYMBOL_RE = /^[A-Z0-9.\-^=]{1,15}$/
export const MAX_SYMBOLS = 20
export const NOTAM_PAGE_SIZE = 50
export const MAX_NOTAM_TEXT = 4000
const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024
const FINNHUB_CONCURRENCY = 4

/** CDN cache policies (Vercel honours s-maxage / stale-while-revalidate). */
export const CACHE = {
  notams: 'public, max-age=0, s-maxage=600, stale-while-revalidate=1200',
  quotes: 'public, max-age=0, s-maxage=60, stale-while-revalidate=60',
  /** A batch where some symbols failed upstream: cache only briefly. */
  quotesPartial: 'public, max-age=0, s-maxage=15',
  profiles: 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
  redirect: 'public, max-age=0, s-maxage=86400',
  error: 'no-store',
} as const

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

type EnvSource = Record<string, string | undefined>

function envValue(env: EnvSource, name: string): string | undefined {
  const v = env[name]
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t : undefined
}

export interface FaaEnv {
  clientId: string
  clientSecret: string
  url: string
}

/** FAA needs both client_id and client_secret. FAA_NOTAM_API_URL optionally overrides the endpoint. */
export function readFaaEnv(env: EnvSource = process.env): FaaEnv | null {
  const clientId = envValue(env, 'FAA_NOTAM_CLIENT_ID')
  const clientSecret = envValue(env, 'FAA_NOTAM_CLIENT_SECRET')
  if (!clientId || !clientSecret) return null
  const override = envValue(env, 'FAA_NOTAM_API_URL')
  const url = override && /^https:\/\//.test(override) ? override : DEFAULT_FAA_NOTAM_URL
  return { clientId, clientSecret, url }
}

export function readFinnhubKey(env: EnvSource = process.env): string | null {
  return envValue(env, 'FINNHUB_API_KEY') ?? null
}

// ---------------------------------------------------------------------------
// Request input
// ---------------------------------------------------------------------------

export interface DataRequestInput {
  method?: string
  headers: Headers
  remoteAddress?: string
  /** Request URL as received (path + query). */
  url?: string
}

export interface DataDeps {
  env?: EnvSource
  limiter?: RateLimiter
  fetch?: FetchLike
  timeoutMs?: number
  log?: Logger
  now?: () => Date
}

const defaultLog: Logger = (category) => console.warn(`[data] ${category}`)

function err(status: number, error: string, description?: string, headers: Record<string, string> = {}): HandlerResult {
  return errorResult(status, error, description, { 'Cache-Control': CACHE.error, ...headers })
}

function parseQuery(url: string | undefined): { raw: string; params: URLSearchParams } {
  const q = (url ?? '').indexOf('?')
  const raw = q >= 0 ? (url ?? '').slice(q + 1) : ''
  return { raw, params: new URLSearchParams(raw) }
}

type Parsed<T> = { ok: true; value: T; canonical: string } | { ok: false; result: HandlerResult }

function badRequest(description: string): { ok: false; result: HandlerResult } {
  return { ok: false, result: err(400, 'invalid_request', description) }
}

/** Only `name` is allowed, exactly once. */
function singleParam(params: URLSearchParams, name: string): string | { error: string } {
  for (const key of params.keys()) if (key !== name) return { error: `Unknown parameter: only ${name} is accepted` }
  const all = params.getAll(name)
  if (all.length === 0) return { error: `${name} is required` }
  if (all.length > 1) return { error: `${name} must be given once` }
  return all[0]
}

export function parseIcao(url: string | undefined): Parsed<string> {
  const { params } = parseQuery(url)
  const v = singleParam(params, 'icao')
  if (typeof v !== 'string') return badRequest(v.error)
  const icao = v.trim().toUpperCase()
  if (!ICAO_RE.test(icao)) return badRequest('icao must be 3-4 letters/digits')
  return { ok: true, value: icao, canonical: `icao=${icao}` }
}

/** Uppercased, de-duplicated, sorted symbols; canonical query uses encodeURIComponent per symbol. */
export function parseSymbols(url: string | undefined): Parsed<string[]> {
  const { params } = parseQuery(url)
  const v = singleParam(params, 'symbols')
  if (typeof v !== 'string') return badRequest(v.error)
  const parts = v.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  if (parts.length === 0) return badRequest('symbols is required')
  for (const s of parts) if (!SYMBOL_RE.test(s)) return badRequest('symbols contains an invalid symbol')
  const symbols = [...new Set(parts)].sort()
  if (symbols.length > MAX_SYMBOLS) return badRequest(`At most ${MAX_SYMBOLS} symbols`)
  return { ok: true, value: symbols, canonical: `symbols=${symbols.map(encodeURIComponent).join(',')}` }
}

function redirectTo(path: string, canonical: string): HandlerResult {
  return {
    status: 308,
    body: { error: 'non_canonical_query', location: `${path}?${canonical}` },
    headers: { Location: `${path}?${canonical}`, 'Cache-Control': CACHE.redirect },
  }
}

/** Shared preamble: method, rate limit, validation + canonical redirect. */
function preflight<T>(
  req: DataRequestInput,
  path: string,
  parse: (url: string | undefined) => Parsed<T>,
  limiter: RateLimiter,
  log: Logger,
  tag: string,
): { ok: true; value: T } | { ok: false; result: HandlerResult } {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return { ok: false, result: err(405, 'method_not_allowed', undefined, { Allow: 'GET' }) }
  }
  const retry = limiter.hit(clientIp(req.headers, req.remoteAddress))
  if (retry) {
    log(`${tag} rate_limited`)
    return { ok: false, result: err(429, 'rate_limited', 'Too many requests', { 'Retry-After': String(retry) }) }
  }
  const p = parse(req.url)
  if (!p.ok) return p
  if (parseQuery(req.url).raw !== p.canonical) return { ok: false, result: redirectTo(path, p.canonical) }
  return { ok: true, value: p.value }
}

// ---------------------------------------------------------------------------
// Upstream fetch helper
// ---------------------------------------------------------------------------

class UpstreamFailure extends Error {
  constructor(readonly category: string) {
    super(category)
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new UpstreamFailure('too_large')
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new UpstreamFailure('too_large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

/** GET JSON from an upstream with a hard timeout. Throws UpstreamFailure with a log-safe category. */
async function upstreamJson(
  url: string,
  headers: Record<string, string>,
  deps: DataDeps,
): Promise<unknown> {
  const doFetch: FetchLike = deps.fetch ?? ((u, init) => fetch(u, init))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? UPSTREAM_TIMEOUT_MS)
  try {
    let res: Response
    try {
      res = await doFetch(url, { method: 'GET', headers: { Accept: 'application/json', ...headers }, signal: controller.signal, redirect: 'error' })
    } catch {
      throw new UpstreamFailure(controller.signal.aborted ? 'upstream_timeout' : 'upstream_network_error')
    }
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel().catch(() => undefined)
      throw new UpstreamFailure(`upstream_status_${res.status}`)
    }
    let text: string
    try {
      text = await readCapped(res, MAX_UPSTREAM_BYTES)
    } catch (e) {
      throw e instanceof UpstreamFailure ? e : new UpstreamFailure(controller.signal.aborted ? 'upstream_timeout' : 'upstream_read_error')
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new UpstreamFailure('upstream_bad_json')
    }
  } finally {
    clearTimeout(timer)
  }
}

function failureCategory(e: unknown): string {
  return e instanceof UpstreamFailure ? e.category : 'internal_error'
}

// ---------------------------------------------------------------------------
// NOTAMs
// ---------------------------------------------------------------------------

export interface NormalizedNotam {
  id: string
  number: string | null
  type: string
  classification: string
  text: string
  effectiveStart: string
  /** null = permanent / no end given */
  effectiveEnd: string | null
  location: string
  affectedFir: string
  schedule: string | null
  minimumAltitude: string | null
  maximumAltitude: string | null
}

export interface NotamsBody {
  version: 1
  icao: string
  fetchedAt: string
  totalCount: number
  notams: NormalizedNotam[]
}

function s(v: unknown, max = 256): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v)
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

function isoDate(v: unknown): string | null {
  const str = s(v, 64)
  if (!str || /^PERM/i.test(str)) return null
  const t = Date.parse(str)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** FL "000"/"999" are the FAA's "surface"/"unlimited" defaults; not worth showing. */
function altitude(primary: unknown, fl: unknown, defaultFl: string): string | null {
  const a = s(primary, 32)
  if (a) return a
  const f = s(fl, 32)
  return f && f !== defaultFl ? `FL${f}` : null
}

/**
 * One FAA item to the normalized shape. Accepts the documented GeoJSON form
 * (items[].properties.coreNOTAMData.notam + notamTranslation[]) and a flat
 * form (fields directly on the item). Items without an id or a valid
 * effectiveStart are dropped.
 */
export function normalizeNotamItem(item: unknown, icao: string): NormalizedNotam | null {
  const it = obj(item)
  if (!it) return null
  const core = obj(obj(it.properties)?.coreNOTAMData)
  const n = obj(core?.notam) ?? it
  const translations = Array.isArray(core?.notamTranslation) ? (core!.notamTranslation as unknown[]).map(obj) : []
  const tr = (type: string, field: string) => {
    for (const t of translations) if (t && t.type === type) return s(t[field], MAX_NOTAM_TEXT)
    return null
  }
  const text =
    s(n.text, MAX_NOTAM_TEXT) ??
    s(n.traditionalMessage, MAX_NOTAM_TEXT) ??
    s(n.notamText, MAX_NOTAM_TEXT) ??
    tr('LOCAL_FORMAT', 'simpleText') ??
    tr('ICAO', 'formattedText') ??
    s(n.icaoMessage, MAX_NOTAM_TEXT) ??
    ''
  const id = s(n.id, 128) ?? s(n.key, 128)
  const effectiveStart = isoDate(n.effectiveStart)
  if (!id || !effectiveStart) return null
  return {
    id,
    number: s(n.number, 32),
    type: s(n.type, 32) ?? 'NOTAM',
    classification: s(n.classification, 32) ?? 'Unknown',
    text,
    effectiveStart,
    effectiveEnd: isoDate(n.effectiveEnd),
    location: s(n.location, 32) ?? s(n.icaoLocation, 32) ?? icao,
    affectedFir: s(n.affectedFIR, 16) ?? s(n.affectedFir, 16) ?? '',
    schedule: s(n.schedule, 256),
    minimumAltitude: altitude(n.minimumAltitude ?? n.lowerLimit, n.minimumFL, '000'),
    maximumAltitude: altitude(n.maximumAltitude ?? n.upperLimit, n.maximumFL, '999'),
  }
}

export function buildFaaNotamUrl(faa: FaaEnv, icao: string): string {
  const q = new URLSearchParams({
    icaoLocation: icao,
    responseFormat: 'geoJson',
    sortBy: 'effectiveStartDate',
    sortOrder: 'Desc',
    pageSize: String(NOTAM_PAGE_SIZE),
  })
  return `${faa.url}?${q.toString()}`
}

export const notamsLimiter = new RateLimiter(60, 60_000)

/** Never let an unexpected throw escape a handler (and never log its message). */
async function guard(tag: string, deps: DataDeps, fn: () => Promise<HandlerResult>): Promise<HandlerResult> {
  try {
    return await fn()
  } catch {
    ;(deps.log ?? defaultLog)(`${tag} internal_error`)
    return err(500, 'internal_error')
  }
}

export function handleNotamsRequest(req: DataRequestInput, deps: DataDeps = {}): Promise<HandlerResult> {
  return guard('notams', deps, () => notamsImpl(req, deps))
}

async function notamsImpl(req: DataRequestInput, deps: DataDeps): Promise<HandlerResult> {
  const log = deps.log ?? defaultLog
  const pre = preflight(req, '/api/data/notams', parseIcao, deps.limiter ?? notamsLimiter, log, 'notams')
  if (!pre.ok) return pre.result
  const icao = pre.value

  const faa = readFaaEnv(deps.env ?? process.env)
  if (!faa) {
    log('notams not_configured')
    return err(503, 'not_configured', 'NOTAMs are not configured on this service')
  }

  let raw: unknown
  try {
    raw = await upstreamJson(buildFaaNotamUrl(faa, icao), { client_id: faa.clientId, client_secret: faa.clientSecret }, deps)
  } catch (e) {
    log(`notams ${failureCategory(e)}`)
    return err(502, 'upstream_unavailable')
  }
  const root = obj(raw)
  if (!root || !Array.isArray(root.items)) {
    log('notams upstream_bad_shape')
    return err(502, 'upstream_unavailable')
  }
  const notams = (root.items as unknown[])
    .slice(0, NOTAM_PAGE_SIZE)
    .map((i) => normalizeNotamItem(i, icao))
    .filter((n): n is NormalizedNotam => n !== null)
  const total = typeof root.totalCount === 'number' && Number.isFinite(root.totalCount) ? root.totalCount : notams.length
  const body: NotamsBody = {
    version: 1,
    icao,
    fetchedAt: (deps.now?.() ?? new Date()).toISOString(),
    totalCount: total,
    notams,
  }
  return { status: 200, body: body as unknown as Record<string, unknown>, headers: { 'Cache-Control': CACHE.notams } }
}

// ---------------------------------------------------------------------------
// Stocks (Finnhub)
// ---------------------------------------------------------------------------

export type ItemStatus = 'ok' | 'unknown_symbol' | 'error'

export interface NormalizedQuote {
  symbol: string
  status: ItemStatus
  price: number | null
  change: number | null
  changePercent: number | null
  previousClose: number | null
  asOf: string | null
}

export interface NormalizedProfile {
  symbol: string
  status: ItemStatus
  name: string | null
  currency: string | null
  exchange: string | null
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function round(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** Finnhub /quote body. c === 0 with pc === 0 (or missing) means unknown symbol. */
export function normalizeFinnhubQuote(symbol: string, body: unknown): NormalizedQuote {
  const b = obj(body)
  const price = finite(b?.c)
  const prev = finite(b?.pc)
  if (!b || price === null || (price === 0 && (prev === null || prev === 0))) {
    return { symbol, status: 'unknown_symbol', price: null, change: null, changePercent: null, previousClose: null, asOf: null }
  }
  let change = finite(b.d)
  if (change === null && prev !== null) change = price - prev
  let pct = finite(b.dp)
  if (pct === null && change !== null && prev) pct = (change / prev) * 100
  const t = finite(b.t)
  return {
    symbol,
    status: 'ok',
    price,
    change: change !== null ? round(change, 4) : null,
    changePercent: pct !== null ? round(pct, 2) : null,
    previousClose: prev,
    asOf: t ? new Date(t * 1000).toISOString() : null,
  }
}

/** Finnhub /stock/profile2 body; {} for unknown symbols. */
export function normalizeFinnhubProfile(symbol: string, body: unknown): NormalizedProfile {
  const b = obj(body)
  const name = s(b?.name, 200)
  if (!name) return { symbol, status: 'unknown_symbol', name: null, currency: null, exchange: null }
  return { symbol, status: 'ok', name, currency: s(b?.currency, 8), exchange: s(b?.exchange, 120) }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

/** Finnhub accepts the key as the X-Finnhub-Token header, which keeps it out of URLs. */
function finnhubHeaders(key: string): Record<string, string> {
  return { 'X-Finnhub-Token': key }
}

async function handleFinnhubBatch<T extends { status: ItemStatus }>(
  req: DataRequestInput,
  deps: DataDeps,
  opts: {
    path: string
    tag: string
    limiter: RateLimiter
    upstreamPath: (symbol: string) => string
    normalize: (symbol: string, body: unknown) => T
    failed: (symbol: string) => T
    listKey: 'quotes' | 'profiles'
    cache: string
    cachePartial: string
  },
): Promise<HandlerResult> {
  const log = deps.log ?? defaultLog
  const pre = preflight(req, opts.path, parseSymbols, opts.limiter, log, opts.tag)
  if (!pre.ok) return pre.result
  const symbols = pre.value

  const key = readFinnhubKey(deps.env ?? process.env)
  if (!key) {
    log(`${opts.tag} not_configured`)
    return err(503, 'not_configured', 'Stock quotes are not configured on this service')
  }

  const categories = new Set<string>()
  const items = await mapLimit(symbols, FINNHUB_CONCURRENCY, async (symbol) => {
    try {
      const body = await upstreamJson(`${FINNHUB_BASE}${opts.upstreamPath(symbol)}`, finnhubHeaders(key), deps)
      return opts.normalize(symbol, body)
    } catch (e) {
      categories.add(failureCategory(e))
      return opts.failed(symbol)
    }
  })
  for (const c of categories) log(`${opts.tag} ${c}`)
  const failures = items.filter((i) => i.status === 'error').length
  if (failures === items.length) return err(502, 'upstream_unavailable')
  return {
    status: 200,
    body: { version: 1, fetchedAt: (deps.now?.() ?? new Date()).toISOString(), [opts.listKey]: items },
    headers: { 'Cache-Control': failures > 0 ? opts.cachePartial : opts.cache },
  }
}

export const stocksLimiter = new RateLimiter(120, 60_000)
export const profilesLimiter = new RateLimiter(60, 60_000)

export function handleStocksRequest(req: DataRequestInput, deps: DataDeps = {}): Promise<HandlerResult> {
  return guard('stocks', deps, () => handleFinnhubBatch<NormalizedQuote>(req, deps, {
    path: '/api/data/stocks',
    tag: 'stocks',
    limiter: deps.limiter ?? stocksLimiter,
    upstreamPath: (sym) => `/quote?symbol=${encodeURIComponent(sym)}`,
    normalize: normalizeFinnhubQuote,
    failed: (symbol) => ({ symbol, status: 'error', price: null, change: null, changePercent: null, previousClose: null, asOf: null }),
    listKey: 'quotes',
    cache: CACHE.quotes,
    cachePartial: CACHE.quotesPartial,
  }))
}

export function handleStockProfilesRequest(req: DataRequestInput, deps: DataDeps = {}): Promise<HandlerResult> {
  return guard('stock_profiles', deps, () => handleFinnhubBatch<NormalizedProfile>(req, deps, {
    path: '/api/data/stock-profiles',
    tag: 'stock_profiles',
    limiter: deps.limiter ?? profilesLimiter,
    upstreamPath: (sym) => `/stock/profile2?symbol=${encodeURIComponent(sym)}`,
    normalize: normalizeFinnhubProfile,
    failed: (symbol) => ({ symbol, status: 'error', name: null, currency: null, exchange: null }),
    listKey: 'profiles',
    cache: CACHE.profiles,
    cachePartial: CACHE.quotesPartial,
  }))
}

// ---------------------------------------------------------------------------
// Vercel glue
// ---------------------------------------------------------------------------

export interface DataRequestLike {
  method?: string
  url?: string
  headers: Headers
  socket?: { remoteAddress?: string }
}

export function toDataRequestInput(req: DataRequestLike): DataRequestInput {
  return { method: req.method, url: req.url, headers: req.headers, remoteAddress: req.socket?.remoteAddress }
}

/**
 * Sets the result's Cache-Control (always present; `no-store` unless the
 * handler chose a CDN policy). No CORS headers: these routes are for mirrors
 * (server-to-server), not browsers.
 */
export function sendDataResult(res: ResponseLike, result: HandlerResult): void {
  res.setHeader('Cache-Control', CACHE.error)
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  for (const [k, v] of Object.entries(result.headers ?? {})) res.setHeader(k, v)
  res.status(result.status).json(result.body)
}
