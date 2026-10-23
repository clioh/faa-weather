/**
 * The SkyGlass cloud service (config `skyglass_service`, default
 * https://skyglass.dev). It holds every third-party credential so the mirror
 * holds none: calendar sign-in (/api/oauth/*, see calendar/auth-service.ts),
 * NOTAMs and stock quotes (/api/data/*). See docs/CLOUD_SERVICE.md.
 *
 * Requests from the mirror never carry an API key.
 */

import type { Config } from '../config/index.js';
import { USER_AGENT, readBodyCapped } from './upstream.js';

export const DEFAULT_SKYGLASS_SERVICE = 'https://skyglass.dev';
export const SKYGLASS_SERVICE_TIMEOUT_MS = 10_000;

/**
 * Validate a service base URL: https only, except http for localhost/127.0.0.1
 * (development). Returns it without a trailing slash, or null when invalid
 * (including an unresolved `${VAR}`).
 */
export function normalizeServiceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || /\$\{[^}]*\}/.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash) return null;
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/** `skyglass_service` from config: unset/blank → default; invalid → null. */
export function skyglassServiceUrl(
  config: Partial<Pick<Config, 'skyglass_service'>>
): string | null {
  const raw = config.skyglass_service;
  const unset = raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim());
  return unset ? DEFAULT_SKYGLASS_SERVICE : normalizeServiceUrl(raw);
}

/**
 * Why a call didn't produce data:
 * - invalid_config: `skyglass_service` is not a valid https URL
 * - not_configured: the service answered 503 not_configured (no upstream credentials there)
 * - unreachable: network error, timeout, or 5xx
 * - rate_limited: 429 from the service
 * - rejected: 4xx (e.g. the service rejected the input)
 * - bad_response: 2xx that isn't JSON
 */
export type ServiceFailure =
  | 'invalid_config'
  | 'not_configured'
  | 'unreachable'
  | 'rate_limited'
  | 'rejected'
  | 'bad_response';

export type ServiceResult =
  | { ok: true; json: unknown }
  | { ok: false; reason: ServiceFailure; status?: number };

/** GET `{base}{pathAndQuery}` as JSON. Never throws. */
export async function getSkyglassJson(
  base: string | null,
  pathAndQuery: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<ServiceResult> {
  if (!base) return { ok: false, reason: 'invalid_config' };
  let res: Response;
  try {
    res = await fetch(`${base}${pathAndQuery}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(opts.timeoutMs ?? SKYGLASS_SERVICE_TIMEOUT_MS),
      // The data endpoints 308 non-canonical queries to their canonical form; nothing secret is sent.
      redirect: 'follow',
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  let text = '';
  try {
    text = await readBodyCapped(res, opts.maxBytes ?? 1024 * 1024);
  } catch {
    return { ok: false, reason: res.ok ? 'bad_response' : 'unreachable', status: res.status };
  }
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (res.ok)
    return json === null
      ? { ok: false, reason: 'bad_response', status: res.status }
      : { ok: true, json };
  const code = json && typeof json === 'object' ? (json as { error?: unknown }).error : undefined;
  if (res.status === 503 && code === 'not_configured')
    return { ok: false, reason: 'not_configured', status: 503 };
  if (res.status === 429) return { ok: false, reason: 'rate_limited', status: 429 };
  if (res.status >= 400 && res.status < 500)
    return { ok: false, reason: 'rejected', status: res.status };
  return { ok: false, reason: 'unreachable', status: res.status };
}
