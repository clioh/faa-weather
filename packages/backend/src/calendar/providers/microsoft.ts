/**
 * Outlook / Microsoft 365 via the OAuth device authorization grant
 * (public client, no secret) and Microsoft Graph. The client ID, tenant and
 * scopes come from the SkyGlass sign-in service config; all token calls go to
 * Microsoft directly.
 */

import { CalendarAuthError, CalendarError, type DiscoveredCalendar, type RawEvent, type TimeWindow } from '../types.js';
import {
  FORM_HEADERS,
  form,
  httpRequest,
  parseJson,
  toTokenSet,
  UnauthorizedError,
  type OAuthTokenResponse,
  type TokenSet,
} from '../http.js';
import type { MicrosoftClientConfig } from '../auth-service.js';
import { addDays, dateToInstant } from '../time.js';

/** Public client config from the SkyGlass sign-in service (no secret exists for this flow). */
export type MicrosoftConfig = MicrosoftClientConfig;
export const GRAPH_API = 'https://graph.microsoft.com/v1.0';
const SERVICE = 'Microsoft';

function authority(cfg: MicrosoftConfig): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant || 'common')}/oauth2/v2.0`;
}

export interface DeviceCodeStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds. */
  expiresIn: number;
  /** Seconds. */
  interval: number;
}

export async function startDeviceCode(cfg: MicrosoftConfig): Promise<DeviceCodeStart> {
  const res = await httpRequest(`${authority(cfg)}/devicecode`, SERVICE, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: form({ client_id: cfg.clientId, scope: cfg.scopes.join(' ') }),
  });
  const json = parseJson<{
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
  }>(res, SERVICE);
  if (!res.ok || !json.device_code || !json.user_code) {
    console.warn(`[calendar] Microsoft device code request failed: ${res.status} ${json.error ?? ''}`);
    if (json.error === 'invalid_client' || json.error === 'unauthorized_client') {
      throw new CalendarError(
        "Outlook sign-in isn't available right now.",
      );
    }
    throw new CalendarError("Couldn't start Microsoft sign-in. Please try again.");
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri || 'https://microsoft.com/devicelogin',
    expiresIn: Number(json.expires_in) || 900,
    interval: Number(json.interval) || 5,
  };
}

export type DevicePollResult =
  | { kind: 'token'; tokens: TokenSet }
  | { kind: 'pending' }
  | { kind: 'slow_down' }
  | { kind: 'expired' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

export async function pollDeviceToken(cfg: MicrosoftConfig, deviceCode: string): Promise<DevicePollResult> {
  const res = await httpRequest(`${authority(cfg)}/token`, SERVICE, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: form({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: cfg.clientId,
      device_code: deviceCode,
    }),
  });
  const json = parseJson<OAuthTokenResponse>(res, SERVICE);
  if (res.ok) {
    const tokens = toTokenSet(json);
    return tokens ? { kind: 'token', tokens } : { kind: 'error', message: 'Microsoft sign-in failed. Please try again.' };
  }
  switch (json.error) {
    case 'authorization_pending':
      return { kind: 'pending' };
    case 'slow_down':
      return { kind: 'slow_down' };
    case 'expired_token':
    case 'code_expired':
      return { kind: 'expired' };
    case 'authorization_declined':
    case 'access_denied':
      return { kind: 'denied' };
    default:
      console.warn(`[calendar] Microsoft device token poll failed: ${res.status} ${json.error ?? ''}`);
      return { kind: 'error', message: 'Microsoft sign-in failed. Please try again.' };
  }
}

export async function refreshMicrosoftToken(cfg: MicrosoftConfig, refreshToken: string): Promise<TokenSet> {
  const res = await httpRequest(`${authority(cfg)}/token`, SERVICE, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: form({
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      refresh_token: refreshToken,
      scope: cfg.scopes.join(' '),
    }),
  });
  const json = parseJson<OAuthTokenResponse>(res, SERVICE);
  if (json.error === 'invalid_grant' || json.error === 'interaction_required') {
    throw new CalendarAuthError('Microsoft sign-in expired. Reconnect this account.');
  }
  const tokens = res.ok ? toTokenSet(json) : null;
  if (!tokens) throw new CalendarError(`Couldn't refresh Microsoft sign-in (HTTP ${res.status})`);
  return tokens;
}

async function graphGet<T>(url: string, accessToken: string): Promise<T> {
  const res = await httpRequest(url, SERVICE, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      Prefer: 'outlook.timezone="UTC"',
    },
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new CalendarError(`Microsoft Graph returned an error (HTTP ${res.status})`);
  return parseJson<T>(res, SERVICE);
}

export async function fetchMicrosoftEmail(accessToken: string): Promise<string | null> {
  const me = await graphGet<{ mail?: string | null; userPrincipalName?: string | null }>(
    `${GRAPH_API}/me?$select=mail,userPrincipalName`,
    accessToken,
  );
  const email = me.mail || me.userPrincipalName;
  return email ? email.toLowerCase() : null;
}

interface GraphCalendar {
  id: string;
  name?: string;
  hexColor?: string;
  isDefaultCalendar?: boolean;
}

const SYSTEM_NAME = /birthday|holiday/i;

export async function listMicrosoftCalendars(accessToken: string): Promise<DiscoveredCalendar[]> {
  const out: DiscoveredCalendar[] = [];
  let url: string | undefined = `${GRAPH_API}/me/calendars?$select=id,name,hexColor,isDefaultCalendar&$top=100`;
  for (let page = 0; url && page < 10; page++) {
    const json: { value?: GraphCalendar[]; '@odata.nextLink'?: string } = await graphGet(url, accessToken);
    for (const c of json.value ?? []) {
      if (!c.id) continue;
      const name = c.name || 'Calendar';
      out.push({
        id: c.id,
        name,
        color: c.hexColor || null,
        primary: !!c.isDefaultCalendar,
        system: !c.isDefaultCalendar && SYSTEM_NAME.test(name),
      });
    }
    url = json['@odata.nextLink'];
  }
  return out;
}

interface GraphEvent {
  id: string;
  subject?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string };
  responseStatus?: { response?: string };
}

/** Graph returns "2026-10-21T14:00:00.0000000" (UTC with our Prefer header). */
function graphInstant(s: string | undefined): number {
  if (!s) return NaN;
  const m = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?/);
  if (!m) return NaN;
  const ms = m[2] ? m[2].slice(0, 4) : '';
  return Date.parse(`${m[1]}${ms}Z`);
}

export function mapGraphEvent(e: GraphEvent, tz: string): RawEvent | null {
  if (!e.id || e.isCancelled) return null;
  if (e.responseStatus?.response === 'declined') return null;
  const title = e.subject?.trim() || '(No title)';
  const location = e.location?.displayName?.trim() || null;
  if (e.isAllDay) {
    const startDate = e.start?.dateTime?.slice(0, 10);
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
    let endDate = e.end?.dateTime?.slice(0, 10) ?? addDays(startDate, 1);
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
  const start = graphInstant(e.start?.dateTime);
  if (!Number.isFinite(start)) return null;
  const endParsed = graphInstant(e.end?.dateTime);
  const end = Number.isFinite(endParsed) && endParsed >= start ? endParsed : start;
  return { key: e.id, title, location, start, end, allDay: false, startDate: null, endDate: null };
}

export async function fetchMicrosoftEvents(
  accessToken: string,
  calendarId: string,
  window: TimeWindow,
  tz: string,
): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  const p = new URLSearchParams({
    startDateTime: new Date(window.start).toISOString(),
    endDateTime: new Date(window.end).toISOString(),
    $select: 'id,subject,isAllDay,isCancelled,start,end,location,responseStatus',
    $top: '200',
  });
  let url: string | undefined = `${GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${p}`;
  for (let page = 0; url && page < 20; page++) {
    const json: { value?: GraphEvent[]; '@odata.nextLink'?: string } = await graphGet(url, accessToken);
    for (const e of json.value ?? []) {
      const ev = mapGraphEvent(e, tz);
      if (ev) out.push(ev);
    }
    url = json['@odata.nextLink'];
  }
  return out;
}
