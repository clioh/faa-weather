/**
 * Google Calendar via plain REST (no googleapis dependency).
 * Auth-code + PKCE. The mirror builds the auth URL from the SkyGlass sign-in
 * service's public client config and keeps the verifier; code exchange and
 * refresh go through the service (auth-service.ts), which holds the client
 * secret. Revocation needs no secret and goes to Google directly.
 */

import {
  CalendarError,
  type DiscoveredCalendar,
  type RawEvent,
  type TimeWindow,
} from '../types.js';
import { FORM_HEADERS, form, httpRequest, parseJson, UnauthorizedError } from '../http.js';
import type { GoogleClientConfig } from '../auth-service.js';
import { addDays, dateToInstant } from '../time.js';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

const SERVICE = 'Google';

export function buildGoogleAuthUrl(
  cfg: GoogleClientConfig,
  state: string,
  codeChallenge: string
): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: cfg.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${GOOGLE_AUTH_URL}?${p.toString()}`;
}

async function apiGet<T>(url: string, accessToken: string): Promise<T> {
  const res = await httpRequest(url, SERVICE, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const reason = (() => {
      try {
        return (JSON.parse(res.text) as { error?: { message?: string } }).error?.message;
      } catch {
        return undefined;
      }
    })();
    if (res.status === 403 && reason && /has not been used|disabled/i.test(reason)) {
      throw new CalendarError(
        "Google Calendar access isn't enabled for SkyGlass right now. Try again later."
      );
    }
    throw new CalendarError(`Google Calendar returned an error (HTTP ${res.status})`);
  }
  return parseJson<T>(res, SERVICE);
}

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const info = await apiGet<{ email?: string }>(GOOGLE_USERINFO_URL, accessToken);
  return typeof info.email === 'string' ? info.email.toLowerCase() : null;
}

interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  primary?: boolean;
  deleted?: boolean;
  hidden?: boolean;
}

const SYSTEM_CALENDAR = /#(holiday|contacts|weeknum)@group\.v\.calendar\.google\.com$/;

export async function listGoogleCalendars(accessToken: string): Promise<DiscoveredCalendar[]> {
  const out: DiscoveredCalendar[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const p = new URLSearchParams({ maxResults: '250' });
    if (pageToken) p.set('pageToken', pageToken);
    const json = await apiGet<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(
      `${GOOGLE_CALENDAR_API}/users/me/calendarList?${p}`,
      accessToken
    );
    for (const c of json.items ?? []) {
      if (!c.id || c.deleted) continue;
      out.push({
        id: c.id,
        name: c.summaryOverride || c.summary || c.id,
        color: c.backgroundColor ?? null,
        primary: !!c.primary,
        system: SYSTEM_CALENDAR.test(c.id),
      });
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  eventType?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
}

export function mapGoogleEvent(e: GoogleEvent, tz: string): RawEvent | null {
  if (!e.id || e.status === 'cancelled' || e.eventType === 'workingLocation') return null;
  if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null;
  const title = e.summary?.trim() || '(No title)';
  const location = e.location?.trim() || null;
  if (e.start?.date) {
    const startDate = e.start.date;
    let endDate = e.end?.date ?? addDays(startDate, 1);
    if (endDate <= startDate) endDate = addDays(startDate, 1);
    return {
      key: e.id,
      title,
      location,
      start: dateToInstant(startDate, tz),
      end: dateToInstant(endDate, tz),
      allDay: true,
      startDate,
      endDate,
    };
  }
  const start = Date.parse(e.start?.dateTime ?? '');
  if (!Number.isFinite(start)) return null;
  const endParsed = Date.parse(e.end?.dateTime ?? '');
  const end = Number.isFinite(endParsed) && endParsed >= start ? endParsed : start;
  return { key: e.id, title, location, start, end, allDay: false, startDate: null, endDate: null };
}

export async function fetchGoogleEvents(
  accessToken: string,
  calendarId: string,
  window: TimeWindow,
  tz: string
): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const p = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: new Date(window.start).toISOString(),
      timeMax: new Date(window.end).toISOString(),
      maxResults: '250',
    });
    if (pageToken) p.set('pageToken', pageToken);
    const json = await apiGet<{ items?: GoogleEvent[]; nextPageToken?: string }>(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${p}`,
      accessToken
    );
    for (const e of json.items ?? []) {
      const ev = mapGoogleEvent(e, tz);
      if (ev) out.push(ev);
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** Best effort: revoke the refresh token (or access token) at Google. */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await httpRequest(GOOGLE_REVOKE_URL, SERVICE, {
      method: 'POST',
      headers: FORM_HEADERS,
      body: form({ token }),
      timeoutMs: 5000,
    });
  } catch {
    // ignore
  }
}
