/**
 * Small fetch wrapper for calendar providers: hard timeout, body size cap,
 * and human-readable errors (never raw upstream text).
 */

import { readBodyCapped, USER_AGENT, UpstreamError } from '../services/upstream.js';
import { CalendarError } from './types.js';

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  redirect?: 'follow' | 'manual';
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
  url: string;
}

/** Thrown by provider API helpers on HTTP 401 so the caller can refresh the token and retry. */
export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

export async function httpRequest(url: string, service: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  const { method = 'GET', headers = {}, body, timeoutMs = 15_000, maxBytes = 10 * 1024 * 1024, redirect = 'follow' } = opts;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { 'User-Agent': USER_AGENT, ...headers },
      body,
      redirect,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new CalendarError(timedOut ? `${service} took too long to respond` : `Couldn't reach ${service}`, timedOut ? 504 : 502);
  }
  let text: string;
  try {
    text = await readBodyCapped(res, maxBytes);
  } catch (error) {
    if (error instanceof UpstreamError) throw new CalendarError(`${service} sent too much data`);
    throw new CalendarError(`Couldn't read the response from ${service}`);
  }
  return { status: res.status, ok: res.ok, headers: res.headers, text, url: res.url || url };
}

export function parseJson<T>(res: HttpResponse, service: string): T {
  try {
    return JSON.parse(res.text) as T;
  } catch {
    throw new CalendarError(`${service} returned an unexpected response`);
  }
}

export function form(data: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) if (v !== undefined) p.set(k, v);
  return p.toString();
}

export const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Seconds until the access token expires (the service turns this into an absolute time). */
  expiresIn: number;
}

export interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export function toTokenSet(json: OAuthTokenResponse): TokenSet | null {
  if (!json.access_token) return null;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || undefined,
    expiresIn: Math.max(60, Number(json.expires_in) || 3600),
  };
}
