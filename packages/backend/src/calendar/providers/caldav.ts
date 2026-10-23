/**
 * Minimal CalDAV client (iCloud + generic servers) built on fetch and
 * fast-xml-parser.
 *
 * Discovery: current-user-principal → calendar-home-set → calendars (Depth 1),
 * trying the server URL and then /.well-known/caldav. Events: calendar-query
 * REPORT with a VEVENT time-range; recurrence is expanded locally (ical.js).
 */

import { createHash } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import {
  CalendarAuthError,
  CalendarError,
  type DiscoveredCalendar,
  type RawEvent,
  type TimeWindow,
} from '../types.js';
import { httpRequest, type HttpResponse } from '../http.js';
import { expandEvents, parseCalendars } from '../ical.js';

export const ICLOUD_CALDAV_URL = 'https://caldav.icloud.com/';

export interface CalDavCredentials {
  provider: 'icloud' | 'caldav';
  serverUrl: string;
  username: string;
  password: string;
}

const NS =
  'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/" xmlns:cs="http://calendarserver.org/ns/"';

const PROPFIND_PRINCIPAL = `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
const PROPFIND_HOME = `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
const PROPFIND_CALENDARS = `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/></d:prop></d:propfind>`;

function utcStamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function calendarQuery(window: TimeWindow): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?><c:calendar-query ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">` +
    `<c:time-range start="${utcStamp(window.start)}" end="${utcStamp(window.end)}"/>` +
    `</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`
  );
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  htmlEntities: true,
  isArray: (name) => ['response', 'propstat', 'href', 'comp'].includes(name),
});

type XmlNode = Record<string, unknown>;

function textOf(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return textOf(v[0]);
  if (v && typeof v === 'object' && '#text' in (v as XmlNode))
    return textOf((v as XmlNode)['#text']);
  return null;
}

interface DavResponse {
  href: string;
  props: XmlNode;
}

export function parseMultistatus(xml: string): DavResponse[] {
  let doc: XmlNode;
  try {
    doc = parser.parse(xml) as XmlNode;
  } catch {
    throw new CalendarError("The CalDAV server sent a response that couldn't be read");
  }
  const ms = doc.multistatus as XmlNode | undefined;
  const responses = (ms?.response as XmlNode[] | undefined) ?? [];
  const out: DavResponse[] = [];
  for (const r of responses) {
    const href = textOf(r.href);
    if (!href) continue;
    const props: XmlNode = {};
    for (const ps of (r.propstat as XmlNode[] | undefined) ?? []) {
      const status = textOf(ps.status) ?? '';
      if (status && !/\s2\d\d\s/.test(` ${status} `)) continue;
      const prop = ps.prop;
      if (prop && typeof prop === 'object') Object.assign(props, prop);
    }
    out.push({ href: href.trim(), props });
  }
  return out;
}

function hrefIn(prop: unknown): string | null {
  if (!prop || typeof prop !== 'object') return null;
  return textOf((prop as XmlNode).href)?.trim() || null;
}

function sameSite(a: URL, b: URL): boolean {
  if (a.host === b.host) return true;
  const tail = (h: string) => h.split('.').slice(-2).join('.');
  return b.protocol === 'https:' && tail(a.hostname) === tail(b.hostname);
}

export class CalDavClient {
  private readonly authHeader: string;
  private readonly origin: URL;
  private readonly service: string;

  constructor(private readonly creds: CalDavCredentials) {
    this.authHeader = `Basic ${Buffer.from(`${creds.username}:${creds.password}`, 'utf-8').toString('base64')}`;
    this.origin = new URL(creds.serverUrl);
    this.service = creds.provider === 'icloud' ? 'iCloud' : 'the CalDAV server';
  }

  /** Request with manual redirects; credentials only go to the same site. */
  async request(
    method: string,
    url: string,
    body: string | undefined,
    depth: '0' | '1'
  ): Promise<HttpResponse> {
    let current = new URL(url);
    for (let hop = 0; hop < 5; hop++) {
      const headers: Record<string, string> = {
        Depth: depth,
        Accept: 'application/xml, text/xml',
        'Content-Type': 'application/xml; charset=utf-8',
      };
      if (sameSite(this.origin, current)) headers.Authorization = this.authHeader;
      const res = await httpRequest(current.toString(), this.service, {
        method,
        headers,
        body,
        redirect: 'manual',
        timeoutMs: 20_000,
        maxBytes: 20 * 1024 * 1024,
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) break;
        current = new URL(loc, current);
        continue;
      }
      if (res.status === 401) {
        throw new CalendarAuthError(
          this.creds.provider === 'icloud'
            ? 'Apple ID or app-specific password was rejected'
            : 'Username or password was rejected'
        );
      }
      return { ...res, url: current.toString() };
    }
    throw new CalendarError(`Too many redirects from ${this.service}`);
  }

  private async propfind(
    url: string,
    body: string,
    depth: '0' | '1'
  ): Promise<{ responses: DavResponse[]; url: string } | null> {
    const res = await this.request('PROPFIND', url, body, depth);
    if (res.status !== 207) return null;
    return { responses: parseMultistatus(res.text), url: res.url };
  }

  private async findPrincipal(): Promise<string | null> {
    const candidates = [
      this.creds.serverUrl,
      new URL('/.well-known/caldav', this.origin).toString(),
    ];
    for (const candidate of candidates) {
      try {
        const r = await this.propfind(candidate, PROPFIND_PRINCIPAL, '0');
        const href = r?.responses
          .map((x) => hrefIn(x.props['current-user-principal']))
          .find(Boolean);
        if (r && href) return new URL(href, r.url).toString();
      } catch (error) {
        if (error instanceof CalendarAuthError) throw error;
      }
    }
    return null;
  }

  private async findHome(principal: string | null): Promise<string> {
    const target = principal ?? this.creds.serverUrl;
    const r = await this.propfind(target, PROPFIND_HOME, '0');
    const href = r?.responses.map((x) => hrefIn(x.props['calendar-home-set'])).find(Boolean);
    if (r && href) return new URL(href, r.url).toString();
    return target;
  }

  async discover(): Promise<DiscoveredCalendar[]> {
    const principal = await this.findPrincipal();
    const home = await this.findHome(principal);
    const r = await this.propfind(home, PROPFIND_CALENDARS, '1');
    if (!r) throw new CalendarError(`Couldn't find any calendars on ${this.service}`, 400);
    const out: DiscoveredCalendar[] = [];
    for (const resp of r.responses) {
      const rt = resp.props.resourcetype;
      if (!rt || typeof rt !== 'object' || !('calendar' in (rt as XmlNode))) continue;
      const compSet = resp.props['supported-calendar-component-set'];
      if (compSet && typeof compSet === 'object') {
        const comps = ((compSet as XmlNode).comp as XmlNode[] | undefined) ?? [];
        const names = comps.map((c) => String(c['@_name'] ?? '').toUpperCase());
        if (names.length > 0 && !names.includes('VEVENT')) continue;
      }
      const url = new URL(resp.href, r.url).toString();
      const name =
        textOf(resp.props.displayname)?.trim() ||
        decodeURIComponent(url.replace(/\/$/, '').split('/').pop() || 'Calendar');
      out.push({
        id: calendarIdForUrl(url),
        url,
        name,
        color: textOf(resp.props['calendar-color'])?.trim() || null,
        primary: false,
        system: /birthday|holiday/i.test(name) || /contact_birthdays/.test(url),
      });
    }
    if (out.length === 0)
      throw new CalendarError(`Couldn't find any calendars on ${this.service}`, 400);
    if (!out.some((c) => c.primary)) {
      const first = out.find((c) => !c.system) ?? out[0];
      first.primary = true;
    }
    return out;
  }

  async fetchEvents(calendarUrl: string, window: TimeWindow, tz: string): Promise<RawEvent[]> {
    const res = await this.request('REPORT', calendarUrl, calendarQuery(window), '1');
    if (res.status === 404)
      throw new CalendarError(
        'A calendar on this account no longer exists. Sync again to refresh the list.'
      );
    if (res.status !== 207)
      throw new CalendarError(`${this.service} returned an error (HTTP ${res.status})`);
    const calendars = [];
    for (const resp of parseMultistatus(res.text)) {
      const data = textOf(resp.props['calendar-data']);
      if (!data) continue;
      try {
        calendars.push(...parseCalendars(data));
      } catch {
        // skip unparseable resource
      }
    }
    return expandEvents(calendars, window, tz);
  }
}

export function calendarIdForUrl(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

/** Normalize the server URL for a provider (iCloud is fixed). */
export function caldavServerUrl(provider: 'icloud' | 'caldav', serverUrl?: string): string {
  if (provider === 'icloud') return ICLOUD_CALDAV_URL;
  let raw = (serverUrl ?? '').trim();
  if (!raw) throw new CalendarError('Enter the CalDAV server address', 400);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CalendarError("That server address isn't a valid URL", 400);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CalendarError('The server address must start with https:// or http://', 400);
  }
  return url.toString();
}
