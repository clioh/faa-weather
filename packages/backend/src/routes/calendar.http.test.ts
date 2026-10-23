/**
 * HTTP-level tests for /api/calendar/* and /api/schedule over the REAL
 * server.ts route stack.
 *
 * - server.ts is imported with SKYGLASS_NO_LISTEN=1 and listened on 127.0.0.1:0;
 *   loopback requests without X-Forwarded-For pass the pairing gate as "local"
 *   and skip the rate limiters (calendarConnectLimiter, uploadLimiter).
 * - The calendar account store is redirected to a temp file (calendar/instance.ts
 *   hardcodes the repo `data/` dir), so data/calendar-accounts.json is never touched.
 * - Outbound network: global fetch is stubbed (sign-in service, Microsoft,
 *   iCloud) and the SSRF fetcher used for ICS links is mocked. No real network.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

const h = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-calendar-http-'));
  process.env.SKYGLASS_NO_LISTEN = '1';
  process.env.SKYGLASS_PAIRED_DEVICES_FILE = path.join(tmp, 'paired-devices.json');
  process.env.SKYGLASS_SCHEDULE_FILE = path.join(tmp, 'flight-schedule.xlsx');
  process.env.SKYGLASS_INTERNAL_TOKEN_FILE = path.join(tmp, 'internal-token');
  return {
    tmp,
    calendarFile: path.join(tmp, 'calendar-accounts.json'),
    todosFile: path.join(tmp, 'todos.json'),
    photosDir: path.join(tmp, 'photos'),
    /** skyglass_service returned by the mocked loadConfig (switch + emit 'changed' to change it). */
    service: { base: 'https://svc.skyglass.test' },
  };
});

const ssrf = vi.hoisted(() => ({
  safeFetchText: vi.fn<(url: string, opts?: unknown) => Promise<string>>(),
}));

vi.mock('../db/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/index.js')>()),
  getMirrorId: () => '00000000-0000-4000-8000-000000000000',
  getMirrorName: () => 'Test Mirror',
}));

vi.mock('../config/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../config/index.js')>();
  return {
    ...mod,
    loadConfig: () => {
      const c = mod.loadConfig();
      return {
        ...c,
        skyglass_service: h.service.base,
        location: { ...c.location, timezone: 'UTC' },
        calendar: { refresh_minutes: 10 },
      };
    },
  };
});

vi.mock('../calendar/accounts-store.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../calendar/accounts-store.js')>();
  class TempAccountStore extends mod.CalendarAccountStore {
    constructor() {
      super(h.calendarFile);
    }
  }
  return { ...mod, CalendarAccountStore: TempAccountStore };
});

vi.mock('../services/todos.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/todos.js')>();
  class TempTodoStore extends mod.TodoStore {
    constructor() {
      super(h.todosFile);
    }
  }
  return { ...mod, TodoStore: TempTodoStore };
});

vi.mock('../services/photos.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/photos.js')>();
  class TempPhotoStore extends mod.PhotoStore {
    constructor() {
      super(h.photosDir);
    }
  }
  return { ...mod, PhotoStore: TempPhotoStore };
});

vi.mock('../services/ssrf.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/ssrf.js')>()),
  safeFetchText: ssrf.safeFetchText,
}));

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

const { app } = await import('../server.js');
const { calendarService } = await import('../calendar/instance.js');
const { configEvents } = await import('../config/index.js');
const { UpstreamError } = await import('../services/upstream.js');
const { UnsafeUrlError } = await import('../services/ssrf.js');
const { AUTH_SERVICE_UNREACHABLE } = await import('../calendar/auth-service.js');

const REPO_DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../data');
const realFetch = globalThis.fetch;

type Upstream = (url: string, init?: RequestInit) => Promise<Response>;
const upstream = vi.fn<Upstream>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const OAUTH_CONFIG = {
  version: 1,
  google: { clientId: 'gid.apps.googleusercontent.com', redirectUri: 'https://skyglass.test/oauth/google', scopes: ['openid', 'email'] },
  microsoft: { clientId: 'ms-client', tenant: 'common', scopes: ['Calendars.Read', 'offline_access'] },
};

function routeUpstream(routes: Array<[string, (url: string, init?: RequestInit) => Response | Promise<Response>]>): void {
  upstream.mockImplementation(async (url, init) => {
    for (const [prefix, handler] of routes) if (url.startsWith(prefix)) return handler(url, init);
    throw new TypeError(`fetch failed (unrouted in test: ${url})`);
  });
}
const defaultRoutes = () => routeUpstream([[`${h.service.base}/api/oauth/config`, () => json(OAUTH_CONFIG)]]);

const DAY = 24 * 60 * 60 * 1000;
const icsStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function icsFeed(name: string, events: Array<{ uid: string; title: string; start: number; hours?: number; location?: string }>): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SkyGlass Test//EN', `X-WR-CALNAME:${name}`];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${icsStamp(Date.now())}`,
      `DTSTART:${icsStamp(e.start)}`,
      `DTEND:${icsStamp(e.start + (e.hours ?? 1) * 3600_000)}`,
      `SUMMARY:${e.title}`,
      ...(e.location ? [`LOCATION:${e.location}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
// Whole hours so DTSTART round-trips exactly.
const tomorrow = Math.floor((Date.now() + DAY) / 3600_000) * 3600_000;

function snapshot(p: string): string {
  try {
    const s = fs.statSync(p);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return 'missing';
  }
}
const repoCalendarFile = path.join(REPO_DATA, 'calendar-accounts.json');
const repoCalendarBefore = snapshot(repoCalendarFile);

let server: Server;
let base: string;
const api = (p: string, init?: RequestInit) => realFetch(`${base}${p}`, init);
const sendJson = (method: string, p: string, body: unknown) =>
  api(p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const readStore = () => JSON.parse(fs.readFileSync(h.calendarFile, 'utf-8')) as { version: number; accounts: Array<Record<string, unknown>> };

async function setServiceBase(next: string): Promise<void> {
  h.service.base = next;
  configEvents.emit('changed');
}

beforeAll(async () => {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return upstream(url, init);
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  upstream.mockReset();
  defaultRoutes();
  ssrf.safeFetchText.mockReset();
  ssrf.safeFetchText.mockRejectedValue(new UpstreamError('Upstream unreachable'));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  // Stop background sync / device-code polling before the network stub goes away.
  calendarService.stop();
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(h.tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------- providers

describe('GET /api/calendar/providers', () => {
  it('lists every provider with availability from the sign-in service', async () => {
    const res = await api('/api/calendar/providers');
    expect(res.status).toBe(200);
    const { providers } = await res.json();
    expect(providers.map((p: { id: string }) => p.id)).toEqual(['google', 'microsoft', 'icloud', 'caldav', 'ics']);
    for (const p of providers) {
      expect(Object.keys(p).sort()).toEqual(['available', 'id', 'method', 'name', 'reason']);
      expect(p).toMatchObject({ available: true, reason: null });
    }
    expect(upstream).toHaveBeenCalledWith(`${h.service.base}/api/oauth/config`, expect.anything());
  });

  it('degrades (200, Google/Outlook unavailable with a reason) when the sign-in service is down', async () => {
    await setServiceBase('https://down.skyglass.test');
    try {
      const res = await api('/api/calendar/providers');
      expect(res.status).toBe(200);
      const byId = Object.fromEntries((await res.json()).providers.map((p: { id: string }) => [p.id, p]));
      expect(byId.google).toMatchObject({ available: false, reason: AUTH_SERVICE_UNREACHABLE });
      expect(byId.microsoft).toMatchObject({ available: false, reason: AUTH_SERVICE_UNREACHABLE });
      expect(byId.icloud).toMatchObject({ available: true, reason: null });
      expect(byId.ics).toMatchObject({ available: true, reason: null });

      const start = await sendJson('POST', '/api/calendar/google/start', { returnUrl: 'skyglass://oauth' });
      expect(start.status).toBe(503);
      expect(await start.json()).toEqual({ error: AUTH_SERVICE_UNREACHABLE });
    } finally {
      await setServiceBase('https://svc.skyglass.test');
    }
  });
});

// ---------------------------------------------------------------- google / microsoft

describe('Google and Microsoft sign-in routes', () => {
  it('POST /google/start returns an auth URL with PKCE and the service redirect URI', async () => {
    const res = await sendJson('POST', '/api/calendar/google/start', { returnUrl: 'skyglass://calendar/done' });
    expect(res.status).toBe(200);
    const { authUrl } = await res.json();
    const u = new URL(authUrl);
    expect(u.origin).toBe('https://accounts.google.com');
    expect(u.searchParams.get('client_id')).toBe(OAUTH_CONFIG.google.clientId);
    expect(u.searchParams.get('redirect_uri')).toBe(OAUTH_CONFIG.google.redirectUri);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBeTruthy();
  });

  it('validates Google bodies with 400 { error }', async () => {
    const cases: Array<[string, unknown, string]> = [
      ['/api/calendar/google/start', {}, 'returnUrl is required'],
      ['/api/calendar/google/start', { returnUrl: 'https://evil.test/cb' }, 'Invalid return URL'],
      ['/api/calendar/google/complete', { state: 's' }, 'Missing authorization code'],
      ['/api/calendar/google/complete', { code: 'c' }, 'Missing state'],
    ];
    for (const [p, body, error] of cases) {
      const res = await sendJson('POST', p, body);
      expect(res.status, `${p} ${JSON.stringify(body)}`).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
  });

  it('POST /google/complete with an unknown state is 400 and creates nothing', async () => {
    const res = await sendJson('POST', '/api/calendar/google/complete', { code: 'abc', state: 'not-a-real-state' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/expired/);
    expect((await (await api('/api/calendar/accounts')).json()).accounts).toEqual([]);
  });

  it('POST /microsoft/start returns a device code and the session is pending', async () => {
    routeUpstream([
      [`${h.service.base}/api/oauth/config`, () => json(OAUTH_CONFIG)],
      ['https://login.microsoftonline.com/common/oauth2/v2.0/devicecode', () =>
        json({ device_code: 'dev-code', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 600 })],
    ]);
    const res = await api('/api/calendar/microsoft/start', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'sessionId', 'userCode', 'verificationUri']);
    expect(body).toMatchObject({ userCode: 'ABCD-EFGH', verificationUri: 'https://microsoft.com/devicelogin' });
    expect(JSON.stringify(body)).not.toContain('dev-code');

    const status = await api(`/api/calendar/microsoft/status/${body.sessionId}`);
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ status: 'pending', account: null, error: null });
  });

  it('POST /microsoft/start maps a Microsoft failure to 502 and an unknown session to 404', async () => {
    routeUpstream([
      [`${h.service.base}/api/oauth/config`, () => json(OAUTH_CONFIG)],
      ['https://login.microsoftonline.com/', () => json({ error: 'server_error', error_description: 'internal detail' }, 500)],
    ]);
    const res = await api('/api/calendar/microsoft/start', { method: 'POST' });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: "Couldn't start Microsoft sign-in. Please try again." });

    const missing = await api('/api/calendar/microsoft/status/nope');
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatch(/not found/);
  });
});

// ---------------------------------------------------------------- CalDAV

describe('POST /api/calendar/caldav', () => {
  it('validates bodies with 400 { error }', async () => {
    const cases: Array<[unknown, string]> = [
      [{ provider: 'exchange', username: 'u', password: 'p' }, "provider must be 'icloud' or 'caldav'"],
      [{ provider: 'caldav', username: 'u', password: 'p' }, 'Enter the CalDAV server address'],
      [{ provider: 'icloud', password: 'p' }, 'Username is required'],
      [{ provider: 'icloud', username: 'u' }, 'Password is required'],
      [{ provider: 'icloud', username: 'u', password: 'p', label: 'x'.repeat(61) }, 'Label is too long (max 60 characters)'],
      [{ provider: 'caldav', serverUrl: 'ftp://dav.test', username: 'u', password: 'p' }, 'The server address must start with https:// or http://'],
    ];
    for (const [body, error] of cases) {
      const res = await sendJson('POST', '/api/calendar/caldav', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
  });

  it('turns rejected credentials into 400 and an unreachable server into 502, storing nothing', async () => {
    routeUpstream([['https://caldav.icloud.com/', () => new Response('', { status: 401 })]]);
    const rejected = await sendJson('POST', '/api/calendar/caldav', { provider: 'icloud', username: 'pilot@icloud.com', password: 'wrong' });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: 'Apple ID or app-specific password was rejected' });

    routeUpstream([]); // every request fails like a dead network
    const down = await sendJson('POST', '/api/calendar/caldav', {
      provider: 'caldav',
      serverUrl: 'https://dav.example.org/',
      username: 'u',
      password: 'p',
    });
    expect(down.status).toBeGreaterThanOrEqual(400);
    const body = await down.json();
    expect(typeof body.error).toBe('string');
    expect(JSON.stringify(body)).not.toContain('unrouted in test');
    expect((await (await api('/api/calendar/accounts')).json()).accounts).toEqual([]);
  });
});

// ---------------------------------------------------------------- ICS + account lifecycle + schedule

describe('ICS accounts, account changes and /api/schedule', () => {
  let accountId = '';
  const FEED_URL = 'https://calendar.example.org/crew.ics';

  beforeAll(() => fs.rmSync(h.calendarFile, { force: true }));

  it('starts with no accounts', async () => {
    const res = await api('/api/calendar/accounts');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
  });

  it('validates ICS bodies with 400 { error }', async () => {
    const cases: Array<[unknown, string]> = [
      [{}, 'Calendar link is required'],
      [{ url: '   ' }, 'Calendar link is required'],
      [{ url: 'ftp://cal.test/x.ics' }, 'Calendar link must start with https://, http:// or webcal://'],
      [{ url: 'javascript:alert(1)' }, 'Calendar link must start with https://, http:// or webcal://'],
      [{ url: `https://x.test/${'a'.repeat(4096)}` }, 'Calendar link is too long'],
      [{ url: FEED_URL, label: '' }, 'Label is required'],
    ];
    for (const [body, error] of cases) {
      const res = await sendJson('POST', '/api/calendar/ics', body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    expect(ssrf.safeFetchText).not.toHaveBeenCalled();
  });

  it('maps ICS download failures to 400 with a readable message', async () => {
    ssrf.safeFetchText.mockRejectedValueOnce(new UpstreamError('Upstream returned 404'));
    let res = await sendJson('POST', '/api/calendar/ics', { url: FEED_URL });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Couldn't download the calendar (returned 404)" });

    ssrf.safeFetchText.mockRejectedValueOnce(new UnsafeUrlError('Private or local addresses are not allowed'));
    res = await sendJson('POST', '/api/calendar/ics', { url: 'http://192.168.1.10/cal.ics' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That link can't be used: private or local addresses are not allowed" });

    ssrf.safeFetchText.mockResolvedValueOnce('<html>not a calendar</html>');
    res = await sendJson('POST', '/api/calendar/ics', { url: FEED_URL });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That link didn't return a calendar" });

    expect((await (await api('/api/calendar/accounts')).json()).accounts).toEqual([]);
  });

  it('adds an ICS link (webcal normalized), persists it and never returns the secret URL', async () => {
    ssrf.safeFetchText.mockResolvedValue(
      icsFeed('Crew Days', [{ uid: 'sim-1@test', title: 'Sim check', start: tomorrow, hours: 2, location: 'KSAN' }]),
    );
    const res = await sendJson('POST', '/api/calendar/ics', { url: 'webcal://calendar.example.org/crew.ics' });
    expect(res.status).toBe(201);
    const { account } = await res.json();
    expect(Object.keys(account).sort()).toEqual(['calendars', 'createdAt', 'email', 'error', 'id', 'label', 'lastSyncAt', 'provider', 'status']);
    expect(account).toMatchObject({ provider: 'ics', label: 'Crew Days', status: 'ok', error: null, email: null });
    expect(account.calendars).toHaveLength(1);
    expect(Object.keys(account.calendars[0]).sort()).toEqual(['color', 'enabled', 'id', 'name']);
    expect(account.calendars[0]).toMatchObject({ name: 'Crew Days', enabled: true });
    expect(account.calendars[0].color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(JSON.stringify(account)).not.toContain('calendar.example.org');
    expect(ssrf.safeFetchText).toHaveBeenCalledWith(FEED_URL, expect.anything());
    accountId = account.id;

    const stored = readStore();
    expect(stored.accounts).toHaveLength(1);
    expect(stored.accounts[0]).toMatchObject({ id: accountId, provider: 'ics', secrets: { icsUrl: FEED_URL } });
    expect(fs.statSync(h.calendarFile).mode & 0o777).toBe(0o600);

    const list = await (await api('/api/calendar/accounts')).json();
    expect(list.accounts).toEqual([account]);
    expect(JSON.stringify(list)).not.toContain('icsUrl');
  });

  it('GET /api/schedule merges the calendar events', async () => {
    const res = await api('/api/schedule?days=3');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['accounts', 'count', 'events', 'updatedAt']);
    expect(body.count).toBe(1);
    expect(body.accounts).toEqual([{ id: accountId, label: 'Crew Days', provider: 'ics', status: 'ok' }]);
    expect(body.events[0]).toMatchObject({
      source: 'ics',
      accountId,
      calendarName: 'Crew Days',
      title: 'Sim check',
      location: 'KSAN',
      startTime: new Date(tomorrow).toISOString(),
      endTime: new Date(tomorrow + 2 * 3600_000).toISOString(),
      allDay: false,
      isFlightDuty: false,
    });
    expect(body.events[0].id.startsWith(`${accountId}:`)).toBe(true);
    expect(Number.isFinite(Date.parse(body.updatedAt))).toBe(true);
  });

  it('GET /api/schedule honors the window and tolerates bad `days`', async () => {
    // days is clamped to 1..30; tomorrow+1h is outside a 1-day window only if it starts after now+1d.
    const far = await (await api('/api/schedule?days=30')).json();
    expect(far.count).toBe(1);
    for (const q of ['days=abc', 'days=-5', 'days=9999', 'days[]=1']) {
      const res = await api(`/api/schedule?${q}`);
      expect(res.status, q).toBe(200);
      expect(Array.isArray((await res.json()).events), q).toBe(true);
    }
  });

  it('XLSX endpoints: empty flight list and upload validation', async () => {
    expect(await (await api('/api/schedule/flights')).json()).toEqual({ count: 0, flights: [] });
    expect(await (await api('/api/schedule/next-flight')).json()).toEqual({ flight: null });
    const status = await (await api('/api/schedule/status')).json();
    expect(status).toEqual({
      initialized: true,
      calendarAccounts: [{ id: accountId, provider: 'ics', label: 'Crew Days', status: 'ok', lastSyncAt: expect.any(String) }],
      flightSchedule: { eventsLoaded: 0 },
    });

    const none = await api('/api/schedule/upload', { method: 'POST', body: new FormData() });
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: 'No file uploaded' });
    const analyze = await api('/api/schedule/analyze', { method: 'POST', body: new FormData() });
    expect(analyze.status).toBe(400);
    expect(await analyze.json()).toEqual({ error: 'No file uploaded' });

    const big = new FormData();
    big.append('schedule', new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]), 'roster.xlsx');
    const tooLarge = await api('/api/schedule/upload', { method: 'POST', body: big });
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: 'File must be 10 MB or smaller' });

    const cleared = await api('/api/schedule', { method: 'DELETE' });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ success: true });
  });

  it('PATCH renames, recolors and disables calendars; the change persists and reads back', async () => {
    const feedId = (await (await api('/api/calendar/accounts')).json()).accounts[0].calendars[0].id;
    const res = await sendJson('PATCH', `/api/calendar/accounts/${accountId}`, {
      label: '  Airline crew  ',
      calendars: [{ id: feedId, color: '#12AB34' }],
    });
    expect(res.status).toBe(200);
    const { account } = await res.json();
    expect(account.label).toBe('Airline crew');
    expect(account.calendars[0].color.toLowerCase()).toBe('#12ab34');

    const readBack = (await (await api('/api/calendar/accounts')).json()).accounts[0];
    expect(readBack).toEqual(account);
    const stored = readStore().accounts[0] as { label: string; calendars: Array<{ color: string; colorLocked?: boolean }> };
    expect(stored.label).toBe('Airline crew');
    expect(stored.calendars[0]).toMatchObject({ colorLocked: true });

    const disabled = await sendJson('PATCH', `/api/calendar/accounts/${accountId}`, { calendars: [{ id: feedId, enabled: false }] });
    expect((await disabled.json()).account.calendars[0].enabled).toBe(false);
    const schedule = await (await api('/api/schedule')).json();
    expect(schedule.count).toBe(0);
    expect(schedule.accounts[0].label).toBe('Airline crew');

    // Re-enabling triggers a background sync (refetches the feed).
    const enabled = await sendJson('PATCH', `/api/calendar/accounts/${accountId}`, { calendars: [{ id: feedId, enabled: true }] });
    expect((await enabled.json()).account.calendars[0].enabled).toBe(true);
    await vi.waitFor(async () => expect((await (await api('/api/schedule')).json()).count).toBe(1));
  });

  it('PATCH validates input: 400 for bad bodies, 404 for unknown or unsafe ids', async () => {
    const bad: Array<[unknown, string]> = [
      [{ label: '' }, 'Label is required'],
      [{ label: 'x'.repeat(61) }, 'Label is too long (max 60 characters)'],
      [{ calendars: [{ id: 'feed', color: 'red' }] }, 'Color must be #rrggbb'],
      [{ calendars: [{ id: 'no-such-calendar', enabled: true }] }, 'Unknown calendar'],
    ];
    for (const [body, error] of bad) {
      const res = await sendJson('PATCH', `/api/calendar/accounts/${accountId}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    for (const id of ['00000000-0000-4000-8000-00000000dead', '..%2F..%2Fpaired-devices', 'a.b']) {
      const res = await sendJson('PATCH', `/api/calendar/accounts/${id}`, { label: 'x' });
      expect(res.status, id).toBe(404);
      expect(await res.json()).toEqual({ error: 'Calendar account not found' });
      expect((await api(`/api/calendar/accounts/${id}/sync`, { method: 'POST' })).status, id).toBe(404);
      expect((await api(`/api/calendar/accounts/${id}`, { method: 'DELETE' })).status, id).toBe(404);
    }
    expect(readStore().accounts[0]).toMatchObject({ label: 'Airline crew' });
  });

  it('POST /sync refetches; an upstream failure keeps the last events and reports status error', async () => {
    ssrf.safeFetchText.mockResolvedValue(
      icsFeed('Crew Days', [
        { uid: 'sim-1@test', title: 'Sim check', start: tomorrow, hours: 2 },
        { uid: 'line-1@test', title: 'Line check', start: tomorrow + 4 * 3600_000 },
      ]),
    );
    const ok = await api(`/api/calendar/accounts/${accountId}/sync`, { method: 'POST' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).account).toMatchObject({ id: accountId, status: 'ok', error: null });
    expect((await (await api('/api/schedule')).json()).events.map((e: { title: string }) => e.title)).toEqual(['Sim check', 'Line check']);

    ssrf.safeFetchText.mockRejectedValue(new UpstreamError('Upstream returned 500'));
    const failed = await api(`/api/calendar/accounts/${accountId}/sync`, { method: 'POST' });
    expect(failed.status).toBe(200);
    const { account } = await failed.json();
    expect(account.status).toBe('error');
    expect(account.error).toMatch(/Couldn't download the calendar/);
    expect(readStore().accounts[0]).toMatchObject({ status: 'error' });
    const schedule = await (await api('/api/schedule')).json();
    expect(schedule.events.map((e: { title: string }) => e.title)).toEqual(['Sim check', 'Line check']);
    expect(schedule.accounts[0].status).toBe('error');
  });

  it('DELETE removes the account (204) from the API and the file', async () => {
    const res = await api(`/api/calendar/accounts/${accountId}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(await (await api('/api/calendar/accounts')).json()).toEqual({ accounts: [] });
    expect(readStore().accounts).toEqual([]);
    const schedule = await (await api('/api/schedule')).json();
    expect(schedule).toMatchObject({ count: 0, events: [], accounts: [] });
    expect((await api(`/api/calendar/accounts/${accountId}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('/api/schedule with an XLSX roster', () => {
  it('XLSX upload persists flight duties that read back through /flights, /next-flight and /api/schedule', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Roster');
    sheet.addRow(['Date', 'Flight', 'Dep', 'Arr', 'ETD', 'ETA', 'Aircraft']);
    const day = new Date(Date.now() + 2 * DAY);
    sheet.addRow([new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())), 'SG123', 'KSAN', 'KSFO', '14:00', '15:30', 'B738']);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());

    const analyzeForm = new FormData();
    analyzeForm.append('file', new Blob([new Uint8Array(xlsx)]), 'roster.xlsx');
    const analyze = await api('/api/schedule/analyze', { method: 'POST', body: analyzeForm });
    expect(analyze.status).toBe(200);
    expect((await analyze.json()).headers).toEqual(['Date', 'Flight', 'Dep', 'Arr', 'ETD', 'ETA', 'Aircraft']);

    const form = new FormData();
    form.append('schedule', new Blob([new Uint8Array(xlsx)]), 'roster.xlsx');
    const res = await api('/api/schedule/upload', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, eventsLoaded: 1 });
    expect(body.events[0]).toMatchObject({ source: 'xlsx', isFlightDuty: true, flightNumber: 'SG123', departure: 'KSAN', arrival: 'KSFO', aircraftType: 'B738' });

    const flights = await (await api('/api/schedule/flights?days=7')).json();
    expect(flights.count).toBe(1);
    expect(flights.flights[0].id).toBe(body.events[0].id);
    expect((await (await api('/api/schedule/next-flight')).json()).flight.id).toBe(body.events[0].id);
    const merged = await (await api('/api/schedule?days=7')).json();
    expect(merged.events.map((e: { source: string }) => e.source)).toEqual(['xlsx']);
    expect((await (await api('/api/schedule/status')).json()).flightSchedule).toEqual({ eventsLoaded: 1 });

    // A corrupt file or a workbook with no flights is a 400 and keeps the loaded schedule.
    const empty = new ExcelJS.Workbook();
    empty.addWorksheet('Roster').addRow(['Date', 'Flight', 'Dep', 'Arr', 'ETD', 'ETA', 'Aircraft']);
    const bad = [Buffer.from('not an xlsx'), Buffer.from(await empty.xlsx.writeBuffer())];
    for (const file of bad) {
      const badForm = new FormData();
      badForm.append('schedule', new Blob([new Uint8Array(file)]), 'roster.xlsx');
      const rejected = await api('/api/schedule/upload', { method: 'POST', body: badForm });
      expect(rejected.status).toBe(400);
      expect(typeof (await rejected.json()).error).toBe('string');
    }
    expect((await (await api('/api/schedule/status')).json()).flightSchedule).toEqual({ eventsLoaded: 1 });
  });
});

describe('repo data/ directory', () => {
  it('data/calendar-accounts.json was not touched', () => {
    expect(snapshot(repoCalendarFile)).toBe(repoCalendarBefore);
  });
});
