/**
 * Client for the SkyGlass sign-in service (cloud OAuth broker at the
 * `skyglass_service` base URL, default https://skyglass.dev). The mirror holds no OAuth app credentials: public
 * client IDs/scopes come from GET /api/oauth/config, and Google code exchange
 * and refresh go through POST /api/oauth/google/token, which adds the client
 * secret server-side. See docs/CALENDAR.md.
 *
 * Never log tokens, codes or verifiers.
 */

import { httpRequest, parseJson, toTokenSet, type HttpResponse, type OAuthTokenResponse, type TokenSet } from './http.js';
import { CalendarAuthError, CalendarError } from './types.js';
import { DEFAULT_SKYGLASS_SERVICE, normalizeServiceUrl } from '../services/skyglass-service.js';

export const DEFAULT_AUTH_SERVICE = DEFAULT_SKYGLASS_SERVICE;

export const AUTH_SERVICE_UNREACHABLE = "Can't reach the SkyGlass sign-in service. Check the mirror's internet connection.";
export const AUTH_SERVICE_INVALID = 'The skyglass_service setting must be an https:// URL. See docs/CLOUD_SERVICE.md.';
export const GOOGLE_UNAVAILABLE = "Google sign-in isn't available right now.";
export const MICROSOFT_UNAVAILABLE = "Outlook sign-in isn't available right now.";

/** Successful config is cached 10 minutes; failures ~1 minute so a blip doesn't stick. */
export const CONFIG_TTL_MS = 10 * 60 * 1000;
export const CONFIG_FAILURE_TTL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const SERVICE = 'the SkyGlass sign-in service';

export interface GoogleClientConfig {
  clientId: string;
  redirectUri: string;
  scopes: string[];
}

export interface MicrosoftClientConfig {
  clientId: string;
  tenant: string;
  scopes: string[];
}

export interface AuthServiceConfig {
  google: GoogleClientConfig | null;
  microsoft: MicrosoftClientConfig | null;
}

/** Validates the `skyglass_service` base URL (https, or http for localhost only). */
export const normalizeAuthServiceUrl = normalizeServiceUrl;

function str(v: unknown, max = 2048): string | null {
  return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;
}

function scopes(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 20) return null;
  const out = v.map((x) => str(x, 512));
  return out.every((x): x is string => x !== null) ? out : null;
}

/** Parse the /api/oauth/config body; malformed provider blocks count as "not available". */
export function parseAuthServiceConfig(json: unknown): AuthServiceConfig | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as { version?: unknown; google?: unknown; microsoft?: unknown };
  if (o.version !== 1) return null;

  let google: GoogleClientConfig | null = null;
  if (o.google && typeof o.google === 'object') {
    const g = o.google as Record<string, unknown>;
    const clientId = str(g.clientId);
    const redirectUri = str(g.redirectUri);
    const sc = scopes(g.scopes);
    if (clientId && redirectUri && /^https:\/\//.test(redirectUri) && sc) google = { clientId, redirectUri, scopes: sc };
  }

  let microsoft: MicrosoftClientConfig | null = null;
  if (o.microsoft && typeof o.microsoft === 'object') {
    const m = o.microsoft as Record<string, unknown>;
    const clientId = str(m.clientId);
    const tenant = str(m.tenant ?? 'common', 128);
    const sc = scopes(m.scopes);
    if (clientId && tenant && /^[A-Za-z0-9.-]+$/.test(tenant) && sc) microsoft = { clientId, tenant, scopes: sc };
  }

  return { google, microsoft };
}

type CacheEntry =
  | { base: string; ok: true; config: AuthServiceConfig; expiresAt: number }
  | { base: string; ok: false; error: string; expiresAt: number };

export interface AuthServiceClientOptions {
  /** Current base URL (from config), or null when skyglass_service is invalid. */
  baseUrl: () => string | null;
  now?: () => number;
}

export class AuthServiceClient {
  private readonly baseUrl: () => string | null;
  private readonly now: () => number;
  private cache: CacheEntry | null = null;
  private lastGood: { base: string; config: AuthServiceConfig } | null = null;
  private inflight: { base: string; promise: Promise<AuthServiceConfig> } | null = null;

  constructor(opts: AuthServiceClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.now = opts.now ?? Date.now;
  }

  private base(): string {
    const b = this.baseUrl();
    if (!b) throw new CalendarError(AUTH_SERVICE_INVALID, 503);
    return b;
  }

  /** Drop the cached config (e.g. the broker said a provider is not configured). */
  invalidate(): void {
    this.cache = null;
  }

  /**
   * The sign-in service config (cached). Throws CalendarError with a human
   * message when the service can't be reached or answers nonsense.
   * `allowStale` falls back to the last good config for this base URL
   * (used by background Microsoft token refresh, which doesn't need the cloud).
   */
  async getConfig(opts: { allowStale?: boolean } = {}): Promise<AuthServiceConfig> {
    const base = this.base();
    try {
      return await this.getConfigFresh(base);
    } catch (error) {
      if (opts.allowStale && this.lastGood?.base === base) return this.lastGood.config;
      throw error;
    }
  }

  private async getConfigFresh(base: string): Promise<AuthServiceConfig> {
    const c = this.cache;
    if (c && c.base === base && c.expiresAt > this.now()) {
      if (c.ok) return c.config;
      throw new CalendarError(c.error, 503);
    }
    if (this.inflight?.base === base) return this.inflight.promise;
    const promise = this.fetchConfig(base).finally(() => {
      if (this.inflight?.promise === promise) this.inflight = null;
    });
    this.inflight = { base, promise };
    return promise;
  }

  private async fetchConfig(base: string): Promise<AuthServiceConfig> {
    let config: AuthServiceConfig | null = null;
    try {
      const res = await httpRequest(`${base}/api/oauth/config`, SERVICE, {
        headers: { Accept: 'application/json' },
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxBytes: 64 * 1024,
      });
      if (res.ok) config = parseAuthServiceConfig(safeJson(res));
      if (!config) console.warn(`[calendar] sign-in service config unusable (HTTP ${res.status})`);
    } catch (error) {
      console.warn(`[calendar] sign-in service unreachable: ${error instanceof Error ? error.message : 'error'}`);
    }
    if (this.baseUrl() !== base) {
      // config changed while we were fetching; don't cache under the old base
      if (config) return config;
      throw new CalendarError(AUTH_SERVICE_UNREACHABLE, 503);
    }
    if (config) {
      this.cache = { base, ok: true, config, expiresAt: this.now() + CONFIG_TTL_MS };
      this.lastGood = { base, config };
      return config;
    }
    this.cache = { base, ok: false, error: AUTH_SERVICE_UNREACHABLE, expiresAt: this.now() + CONFIG_FAILURE_TTL_MS };
    throw new CalendarError(AUTH_SERVICE_UNREACHABLE, 503);
  }

  // ---------------------------------------------------------------- Google token broker

  /** authorization_code + PKCE verifier → tokens. The broker adds client_id/secret/redirect_uri. */
  async exchangeGoogleCode(code: string, codeVerifier: string): Promise<TokenSet> {
    const { res, json } = await this.postGoogleToken({ grant_type: 'authorization_code', code, code_verifier: codeVerifier });
    const tokens = res.ok ? toTokenSet(json) : null;
    if (tokens) return tokens;
    console.warn(`[calendar] Google code exchange failed: ${res.status} ${json.error ?? ''}`);
    throw new CalendarError(this.googleFailureMessage(res.status, json) ?? 'Google sign-in failed. Please try again.', 502);
  }

  async refreshGoogleToken(refreshToken: string): Promise<TokenSet> {
    const { res, json } = await this.postGoogleToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (res.status >= 400 && res.status < 500 && json.error === 'invalid_grant') {
      throw new CalendarAuthError('Google sign-in expired. Reconnect this account.');
    }
    const tokens = res.ok ? toTokenSet(json) : null;
    if (tokens) return tokens;
    console.warn(`[calendar] Google token refresh failed: ${res.status} ${json.error ?? ''}`);
    throw new CalendarError(this.googleFailureMessage(res.status, json) ?? `Couldn't refresh Google sign-in (HTTP ${res.status})`);
  }

  private googleFailureMessage(status: number, json: OAuthTokenResponse): string | null {
    if (status === 503 || json.error === 'not_configured' || json.error === 'invalid_client' || json.error === 'unauthorized_client') {
      this.invalidate();
      return GOOGLE_UNAVAILABLE;
    }
    if (status === 429) return 'Too many sign-in requests. Wait a minute and try again.';
    if (status >= 500) return 'Google sign-in is temporarily unavailable. Try again in a few minutes.';
    return null;
  }

  private async postGoogleToken(body: Record<string, string>): Promise<{ res: HttpResponse; json: OAuthTokenResponse }> {
    let url = `${this.base()}/api/oauth/google/token`;
    let res: HttpResponse | null = null;
    // Redirects are handled by hand so tokens/codes only ever follow one
    // method-preserving hop (307/308) to the same host or its www. variant
    // over https (e.g. skyglass.dev -> www.skyglass.dev).
    for (let hop = 0; hop < 2; hop++) {
      try {
        res = await httpRequest(url, SERVICE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
          timeoutMs: REQUEST_TIMEOUT_MS,
          maxBytes: 64 * 1024,
          redirect: 'manual',
        });
      } catch {
        throw new CalendarError(AUTH_SERVICE_UNREACHABLE, 502);
      }
      if (res.status < 300 || res.status >= 400) break;
      const next = hop === 0 ? sameSiteRedirect(url, res.status, res.headers.get('location')) : null;
      if (!next) {
        console.warn(`[calendar] sign-in service token endpoint redirected (HTTP ${res.status}); set skyglass_service to its final URL`);
        throw new CalendarError(AUTH_SERVICE_UNREACHABLE, 502);
      }
      url = next;
    }
    const parsed = safeJson(res!);
    const json = parsed && typeof parsed === 'object' ? (parsed as OAuthTokenResponse) : {};
    return { res: res!, json };
  }
}

/** The redirect target if it's a 307/308 to https on the same host or its www. twin, else null. */
export function sameSiteRedirect(from: string, status: number, location: string | null): string | null {
  if ((status !== 307 && status !== 308) || !location) return null;
  let src: URL;
  let dst: URL;
  try {
    src = new URL(from);
    dst = new URL(location, from);
  } catch {
    return null;
  }
  if (dst.protocol !== 'https:' && dst.protocol !== src.protocol) return null;
  if (dst.protocol !== 'https:' && dst.hostname !== src.hostname) return null;
  const strip = (h: string) => h.replace(/^www\./, '');
  if (strip(dst.hostname) !== strip(src.hostname) || dst.username || dst.password) return null;
  return dst.toString();
}

function safeJson(res: HttpResponse): unknown {
  try {
    return parseJson<unknown>(res, SERVICE);
  } catch {
    return null;
  }
}
