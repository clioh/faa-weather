/**
 * SkyGlass sign-in service (cloud OAuth broker): shared, framework-free logic.
 *
 * The broker is stateless: it holds the app's Google client secret and adds it
 * to token requests made by mirrors. It never stores or logs codes, tokens,
 * PKCE verifiers or the secret. Only error categories are logged.
 *
 * This file lives under api/_lib/ so Vercel does not deploy it as a function
 * (paths under api/ containing "/_" are skipped by the builder detection).
 * Handlers in api/oauth/** stay thin and call into here.
 */

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const DEFAULT_GOOGLE_REDIRECT_URI = 'https://skyglass.dev/oauth/google'
export const DEFAULT_MICROSOFT_TENANT = 'common'
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
]
export const MICROSOFT_SCOPES = ['offline_access', 'User.Read', 'Calendars.Read']

export const MAX_BODY_BYTES = 8 * 1024
export const MAX_FIELD_LENGTH = 2048
export const UPSTREAM_TIMEOUT_MS = 10_000
export const PKCE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/

/** Fields of Google's token response that may be passed back to the mirror. */
export const ALLOWED_TOKEN_FIELDS = [
  'access_token',
  'expires_in',
  'refresh_token',
  'scope',
  'token_type',
  'id_token',
  'error',
  'error_description',
] as const

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

export interface GoogleEnv {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export interface MicrosoftEnv {
  clientId: string
  tenant: string
}

export interface OAuthEnv {
  google: GoogleEnv | null
  microsoft: MicrosoftEnv | null
}

type EnvSource = Record<string, string | undefined>

function envValue(env: EnvSource, name: string): string | undefined {
  const v = env[name]
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t : undefined
}

/** Google is configured only when both the client ID and secret are set. */
export function readOAuthEnv(env: EnvSource = process.env): OAuthEnv {
  const gId = envValue(env, 'GOOGLE_CLIENT_ID')
  const gSecret = envValue(env, 'GOOGLE_CLIENT_SECRET')
  const msId = envValue(env, 'MICROSOFT_CLIENT_ID')
  return {
    google:
      gId && gSecret
        ? {
            clientId: gId,
            clientSecret: gSecret,
            redirectUri: envValue(env, 'GOOGLE_REDIRECT_URI') ?? DEFAULT_GOOGLE_REDIRECT_URI,
          }
        : null,
    microsoft: msId
      ? { clientId: msId, tenant: envValue(env, 'MICROSOFT_TENANT') ?? DEFAULT_MICROSOFT_TENANT }
      : null,
  }
}

export interface PublicConfig {
  version: 1
  google: { clientId: string; redirectUri: string; scopes: string[] } | null
  microsoft: { clientId: string; tenant: string; scopes: string[] } | null
}

/** Public config: client IDs are identifiers, never include the secret. */
export function buildPublicConfig(env: OAuthEnv): PublicConfig {
  return {
    version: 1,
    google: env.google
      ? {
          clientId: env.google.clientId,
          redirectUri: env.google.redirectUri,
          scopes: [...GOOGLE_SCOPES],
        }
      : null,
    microsoft: env.microsoft
      ? {
          clientId: env.microsoft.clientId,
          tenant: env.microsoft.tenant,
          scopes: [...MICROSOFT_SCOPES],
        }
      : null,
  }
}

// ---------------------------------------------------------------------------
// Rate limiting (best effort, per function instance)
// ---------------------------------------------------------------------------

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000
  ) {}

  /** Returns 0 when allowed, otherwise the seconds until the window resets. */
  hit(key: string): number {
    const t = this.now()
    let entry = this.hits.get(key)
    if (!entry || entry.resetAt <= t) {
      if (this.hits.size >= this.maxKeys) this.prune(t)
      entry = { count: 0, resetAt: t + this.windowMs }
      this.hits.set(key, entry)
    }
    entry.count += 1
    if (entry.count > this.limit) return Math.max(1, Math.ceil((entry.resetAt - t) / 1000))
    return 0
  }

  private prune(t: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k)
    // Still full (many distinct live keys): drop the oldest entries.
    if (this.hits.size >= this.maxKeys) {
      const drop = this.hits.size - this.maxKeys + 1
      let i = 0
      for (const k of this.hits.keys()) {
        if (i++ >= drop) break
        this.hits.delete(k)
      }
    }
  }
}

type HeaderValue = string | string[] | undefined
export type Headers = Record<string, HeaderValue>

function header(headers: Headers, name: string): string | undefined {
  const v = headers[name.toLowerCase()]
  if (Array.isArray(v)) return v[0]
  return typeof v === 'string' ? v : undefined
}

/** Client IP: first hop of x-forwarded-for, then x-real-ip, then the socket. */
export function clientIp(headers: Headers, remoteAddress?: string): string {
  const xff = header(headers, 'x-forwarded-for')
  const first = xff?.split(',')[0]?.trim()
  if (first) return first
  const real = header(headers, 'x-real-ip')?.trim()
  if (real) return real
  return remoteAddress || 'unknown'
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface HandlerResult {
  status: number
  body: Record<string, unknown>
  headers?: Record<string, string>
}

export function errorResult(
  status: number,
  error: string,
  error_description?: string,
  headers?: Record<string, string>
): HandlerResult {
  return { status, body: error_description ? { error, error_description } : { error }, headers }
}

export type Logger = (category: string) => void

const defaultLog: Logger = (category) => console.warn(`[oauth] ${category}`)

// ---------------------------------------------------------------------------
// Request input (decoupled from VercelRequest so it is testable)
// ---------------------------------------------------------------------------

export interface RequestInput {
  method?: string
  headers: Headers
  remoteAddress?: string
  /** Lazily read the parsed body; may throw (e.g. invalid JSON). */
  readBody: () => unknown
}

// ---------------------------------------------------------------------------
// GET /api/oauth/config
// ---------------------------------------------------------------------------

export interface ConfigDeps {
  env?: EnvSource
  limiter?: RateLimiter
}

export const configLimiter = new RateLimiter(60, 60_000)

export function handleConfigRequest(req: RequestInput, deps: ConfigDeps = {}): HandlerResult {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return errorResult(405, 'method_not_allowed', undefined, { Allow: 'GET' })
  }
  const limiter = deps.limiter ?? configLimiter
  const retry = limiter.hit(clientIp(req.headers, req.remoteAddress))
  if (retry)
    return errorResult(429, 'rate_limited', 'Too many requests', { 'Retry-After': String(retry) })
  const body = buildPublicConfig(readOAuthEnv(deps.env ?? process.env))
  return { status: 200, body: body as unknown as Record<string, unknown> }
}

// ---------------------------------------------------------------------------
// POST /api/oauth/google/token
// ---------------------------------------------------------------------------

export type TokenGrant =
  | { grant_type: 'authorization_code'; code: string; code_verifier: string }
  | { grant_type: 'refresh_token'; refresh_token: string }

export type ValidationResult =
  | { ok: true; grant: TokenGrant }
  | { ok: false; result: HandlerResult }

function invalid(description: string): ValidationResult {
  return { ok: false, result: errorResult(400, 'invalid_request', description) }
}

function isJsonContentType(ct: string | undefined): boolean {
  if (!ct) return false
  const mime = ct.split(';')[0].trim().toLowerCase()
  return mime === 'application/json'
}

function stringField(body: Record<string, unknown>, name: string): string | null {
  const v = body[name]
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_FIELD_LENGTH) return null
  return v
}

/**
 * Validates content type, size and shape. Fields other than the ones the grant
 * needs (e.g. a caller-supplied redirect_uri or client_id) are ignored.
 */
export function validateTokenRequest(req: RequestInput): ValidationResult {
  if (!isJsonContentType(header(req.headers, 'content-type'))) {
    return {
      ok: false,
      result: errorResult(415, 'invalid_request', 'Content-Type must be application/json'),
    }
  }
  const declared = header(req.headers, 'content-length')
  if (declared !== undefined && Number(declared) > MAX_BODY_BYTES)
    return invalid('Request body too large')

  let raw: unknown
  try {
    raw = req.readBody()
  } catch {
    return invalid('Request body must be valid JSON')
  }
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    const text = raw.toString()
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return invalid('Request body too large')
    try {
      raw = JSON.parse(text)
    } catch {
      return invalid('Request body must be valid JSON')
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return invalid('Request body must be a JSON object')
  const body = raw as Record<string, unknown>
  let size: number
  try {
    size = Buffer.byteLength(JSON.stringify(body))
  } catch {
    return invalid('Request body must be a JSON object')
  }
  if (size > MAX_BODY_BYTES) return invalid('Request body too large')

  const grantType = body.grant_type
  if (grantType === 'authorization_code') {
    const code = stringField(body, 'code')
    if (!code) return invalid('code is required')
    const verifier = stringField(body, 'code_verifier')
    if (!verifier) return invalid('code_verifier is required')
    if (!PKCE_VERIFIER_RE.test(verifier))
      return invalid('code_verifier is not a valid PKCE verifier')
    return { ok: true, grant: { grant_type: 'authorization_code', code, code_verifier: verifier } }
  }
  if (grantType === 'refresh_token') {
    const token = stringField(body, 'refresh_token')
    if (!token) return invalid('refresh_token is required')
    return { ok: true, grant: { grant_type: 'refresh_token', refresh_token: token } }
  }
  if (typeof grantType !== 'string' || !grantType) return invalid('grant_type is required')
  return { ok: false, result: errorResult(400, 'unsupported_grant_type') }
}

/** Form body sent to Google. client_id, secret and redirect_uri come only from env. */
export function buildGoogleTokenForm(grant: TokenGrant, google: GoogleEnv): URLSearchParams {
  const form = new URLSearchParams()
  form.set('client_id', google.clientId)
  form.set('client_secret', google.clientSecret)
  form.set('grant_type', grant.grant_type)
  if (grant.grant_type === 'authorization_code') {
    form.set('code', grant.code)
    form.set('code_verifier', grant.code_verifier)
    form.set('redirect_uri', google.redirectUri)
  } else {
    form.set('refresh_token', grant.refresh_token)
  }
  return form
}

/** Keep only allowed scalar fields of Google's response. */
export function filterTokenBody(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  const src = input as Record<string, unknown>
  for (const key of ALLOWED_TOKEN_FIELDS) {
    const v = src[key]
    if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) out[key] = v
  }
  return out
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface UpstreamOptions {
  fetch?: FetchLike
  timeoutMs?: number
  log?: Logger
}

const UPSTREAM_UNAVAILABLE = (): HandlerResult => errorResult(502, 'upstream_unavailable')

export async function exchangeGoogleToken(
  grant: TokenGrant,
  google: GoogleEnv,
  opts: UpstreamOptions = {}
): Promise<HandlerResult> {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init))
  const log = opts.log ?? defaultLog
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? UPSTREAM_TIMEOUT_MS)
  try {
    let res: Response
    try {
      res = await doFetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: buildGoogleTokenForm(grant, google).toString(),
        signal: controller.signal,
        redirect: 'error',
      })
    } catch {
      log(
        controller.signal.aborted
          ? 'google_token upstream_timeout'
          : 'google_token upstream_network_error'
      )
      return UPSTREAM_UNAVAILABLE()
    }

    if (res.status >= 500 || res.status < 200 || (res.status >= 300 && res.status < 400)) {
      log(`google_token upstream_status_${res.status}`)
      return UPSTREAM_UNAVAILABLE()
    }

    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      log(
        controller.signal.aborted
          ? 'google_token upstream_timeout'
          : 'google_token upstream_bad_json'
      )
      return UPSTREAM_UNAVAILABLE()
    }
    const body = filterTokenBody(parsed)

    if (res.status >= 400) {
      // Google's own error (e.g. invalid_grant): pass status and JSON through.
      const code =
        typeof body.error === 'string' && /^[a-z_]{1,64}$/.test(body.error) ? body.error : 'unknown'
      log(`google_token upstream_${res.status} ${code}`)
      if (!body.error) body.error = 'upstream_error'
      return { status: res.status, body }
    }

    if (typeof body.access_token !== 'string') {
      log('google_token upstream_missing_access_token')
      return UPSTREAM_UNAVAILABLE()
    }
    return { status: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

export interface TokenDeps extends UpstreamOptions {
  env?: EnvSource
  limiter?: RateLimiter
}

export const tokenLimiter = new RateLimiter(30, 60_000)

export async function handleGoogleTokenRequest(
  req: RequestInput,
  deps: TokenDeps = {}
): Promise<HandlerResult> {
  const log = deps.log ?? defaultLog
  if (req.method !== 'POST')
    return errorResult(405, 'method_not_allowed', undefined, { Allow: 'POST' })

  const limiter = deps.limiter ?? tokenLimiter
  const retry = limiter.hit(clientIp(req.headers, req.remoteAddress))
  if (retry) {
    log('google_token rate_limited')
    return errorResult(429, 'rate_limited', 'Too many requests', { 'Retry-After': String(retry) })
  }

  const google = readOAuthEnv(deps.env ?? process.env).google
  if (!google) {
    log('google_token not_configured')
    return errorResult(503, 'not_configured', 'Google sign-in is not configured on this service')
  }

  const v = validateTokenRequest(req)
  if (!v.ok) return v.result

  try {
    return await exchangeGoogleToken(v.grant, google, { ...deps, log })
  } catch {
    log('google_token internal_error')
    return errorResult(500, 'internal_error')
  }
}

// ---------------------------------------------------------------------------
// Vercel glue
// ---------------------------------------------------------------------------

/** Minimal shapes of VercelRequest/VercelResponse used here. */
export interface RequestLike {
  method?: string
  headers: Headers
  socket?: { remoteAddress?: string }
  body?: unknown
}

export interface ResponseLike {
  setHeader(name: string, value: string): unknown
  status(code: number): ResponseLike
  json(body: unknown): unknown
}

export function toRequestInput(req: RequestLike): RequestInput {
  return {
    method: req.method,
    headers: req.headers,
    remoteAddress: req.socket?.remoteAddress,
    // VercelRequest.body is a getter that parses lazily and throws on bad JSON.
    readBody: () => req.body,
  }
}

export function sendResult(res: ResponseLike, result: HandlerResult): void {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  for (const [k, v] of Object.entries(result.headers ?? {})) res.setHeader(k, v)
  res.status(result.status).json(result.body)
}
