import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CalendarAccountStore } from './accounts-store.js';
import type { CalendarSettings } from './config.js';
import { readCalendarSettings } from './config.js';
import {
  AUTH_SERVICE_INVALID,
  AUTH_SERVICE_UNREACHABLE,
  AuthServiceClient,
  GOOGLE_UNAVAILABLE,
  MICROSOFT_UNAVAILABLE,
  normalizeAuthServiceUrl,
  parseAuthServiceConfig,
  sameSiteRedirect,
} from './auth-service.js';
import { CalendarService, decodeState, normalizeIcsUrl } from './service.js';
import { CalendarError, type ScheduleEvent } from './types.js';
import { mergeScheduleEvents, flightToScheduleEvent, scheduleWindow } from '../services/schedule.js';

// ---------------------------------------------------------------- fetch mock

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}
type Handler = (call: Call) => Response | undefined | Promise<Response | undefined>;

let calls: Call[] = [];
let handlers: Handler[] = [];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function xml(body: string, status = 207): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/xml' } });
}
function on(method: string, match: string | RegExp, respond: (call: Call) => Response): void {
  handlers.push((c) => {
    if (c.method !== method) return undefined;
    const ok = typeof match === 'string' ? c.url.split('?')[0] === match : match.test(c.url);
    return ok ? respond(c) : undefined;
  });
}

beforeEach(() => {
  calls = [];
  handlers = [];
  vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const call: Call = { url: String(input), method: init.method ?? 'GET', headers, body: String(init.body ?? '') };
    calls.push(call);
    for (const h of handlers) {
      const r = await h(call);
      if (r) return r;
    }
    return new Response('not mocked', { status: 599 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------- service factory

const TZ = 'America/New_York';
const NOW = Date.parse('2026-10-21T14:00:00Z'); // 10:00 EDT

const AUTH = 'https://auth.test';
const BROKER_CONFIG_URL = `${AUTH}/api/oauth/config`;
const BROKER_TOKEN_URL = `${AUTH}/api/oauth/google/token`;

function settings(overrides: Partial<CalendarSettings> = {}): CalendarSettings {
  return { refreshMinutes: 10, timezone: TZ, authService: AUTH, ...overrides };
}

const GOOGLE_CFG = {
  clientId: 'gid.apps.googleusercontent.com',
  redirectUri: 'https://skyglass.dev/oauth/google',
  scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly'],
};
const MS_CFG = { clientId: 'ms-client', tenant: 'common', scopes: ['offline_access', 'User.Read', 'Calendars.Read'] };

/** Mock GET /api/oauth/config on the sign-in service. */
function mockBrokerConfig(cfg: { google?: unknown; microsoft?: unknown } = {}) {
  on('GET', BROKER_CONFIG_URL, () =>
    json({ version: 1, google: 'google' in cfg ? cfg.google : GOOGLE_CFG, microsoft: 'microsoft' in cfg ? cfg.microsoft : MS_CFG }),
  );
}

/** Mock POST /api/oauth/google/token on the sign-in service (JSON body, no client credentials). */
function mockBrokerToken() {
  on('POST', BROKER_TOKEN_URL, (c) => {
    const b = JSON.parse(c.body) as Record<string, string>;
    if (b.grant_type === 'authorization_code') {
      return json({ access_token: 'ya29.access', refresh_token: '1//refresh', expires_in: 3599, token_type: 'Bearer' });
    }
    return json({ access_token: 'ya29.refreshed', expires_in: 3599 });
  });
}

/** No request the mirror makes may carry OAuth app credentials. */
function expectNoClientCredentials() {
  for (const c of calls) {
    expect(c.body).not.toMatch(/client_secret/i);
    expect(c.body).not.toMatch(/gsecret/);
    if (c.url === BROKER_TOKEN_URL) {
      const keys = Object.keys(JSON.parse(c.body) as object).sort();
      expect(keys.every((k) => ['code', 'code_verifier', 'grant_type', 'refresh_token'].includes(k))).toBe(true);
    }
  }
  expect(calls.some((c) => c.url.startsWith('https://oauth2.googleapis.com/token'))).toBe(false);
}

async function startUrl(service: CalendarService, returnUrl = 'skyglass://oauth/google'): Promise<URL> {
  return new URL((await service.googleStart(returnUrl)).authUrl);
}
async function startState(service: CalendarService): Promise<string> {
  return (await startUrl(service)).searchParams.get('state')!;
}

let dir: string;
let now: number;
let notifications: number;

function makeService(s: CalendarSettings = settings(), extra: { sleeps?: number[] } = {}) {
  const store = new CalendarAccountStore(path.join(dir, 'calendar-accounts.json'));
  const service = new CalendarService({
    store,
    getSettings: () => s,
    notify: () => {
      notifications++;
    },
    now: () => now,
    sleep: async (ms) => {
      extra.sleeps?.push(ms);
    },
    resolveHost: async () => ['93.184.216.34'],
  });
  return { service, store };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-calsvc-'));
  now = NOW;
  notifications = 0;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function expectNoSecrets(value: unknown, ...secrets: string[]) {
  const s = JSON.stringify(value);
  for (const secret of secrets) expect(s).not.toContain(secret);
}

// ---------------------------------------------------------------- config

describe('readCalendarSettings', () => {
  it('defaults the sign-in service to skyglass.dev', () => {
    const s = readCalendarSettings({});
    expect(s.authService).toBe('https://skyglass.dev');
    expect(s.refreshMinutes).toBe(10);
    expect(readCalendarSettings({ skyglass_service: '  ' }).authService).toBe('https://skyglass.dev');
  });

  it('reads refresh_minutes, timezone and a custom https skyglass_service', () => {
    const s = readCalendarSettings({
      location: { latitude: 0, longitude: 0, timezone: 'Europe/Berlin' },
      calendar: { refresh_minutes: 5 },
      skyglass_service: 'https://auth.example.org/',
    });
    expect(s).toEqual({ refreshMinutes: 5, timezone: 'Europe/Berlin', authService: 'https://auth.example.org' });
  });

  it('requires https except for localhost/127.0.0.1', () => {
    expect(normalizeAuthServiceUrl('http://localhost:5174')).toBe('http://localhost:5174');
    expect(normalizeAuthServiceUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000');
    expect(normalizeAuthServiceUrl('https://example.org/prefix/')).toBe('https://example.org/prefix');
    for (const bad of ['http://skyglass.dev', 'http://192.168.1.2', 'ftp://x', 'skyglass.dev', 'https://u:p@x.org', 'https://x.org/?a=1', '${AUTH}']) {
      expect(normalizeAuthServiceUrl(bad)).toBeNull();
    }
    expect(readCalendarSettings({ skyglass_service: 'http://skyglass.dev' }).authService).toBeNull();
  });

  it('ignores the removed calendar.auth_service key (clean break)', () => {
    const legacy = { calendar: { refresh_minutes: 5, auth_service: 'https://old.example.org' } } as unknown as Parameters<typeof readCalendarSettings>[0];
    expect(readCalendarSettings(legacy).authService).toBe('https://skyglass.dev');
  });
});

describe('sign-in service config', () => {
  it('parses the config and drops malformed providers', () => {
    expect(parseAuthServiceConfig({ version: 1, google: GOOGLE_CFG, microsoft: MS_CFG })).toEqual({ google: GOOGLE_CFG, microsoft: MS_CFG });
    expect(parseAuthServiceConfig({ version: 1, google: null, microsoft: null })).toEqual({ google: null, microsoft: null });
    expect(parseAuthServiceConfig({ version: 1, google: { clientId: 'x', redirectUri: 'http://insecure', scopes: ['a'] }, microsoft: { clientId: 'm', scopes: [] } })).toEqual({
      google: null,
      microsoft: null,
    });
    expect(parseAuthServiceConfig({ version: 2 })).toBeNull();
    expect(parseAuthServiceConfig('nope')).toBeNull();
  });

  it('caches the config for 10 minutes', async () => {
    mockBrokerConfig();
    const client = new AuthServiceClient({ baseUrl: () => AUTH, now: () => now });
    const [a, b] = await Promise.all([client.getConfig(), client.getConfig()]);
    expect(a).toEqual({ google: GOOGLE_CFG, microsoft: MS_CFG });
    expect(b).toEqual(a);
    now += 9 * 60 * 1000;
    await client.getConfig();
    expect(calls.filter((c) => c.url === BROKER_CONFIG_URL)).toHaveLength(1);
    now += 2 * 60 * 1000;
    await client.getConfig();
    expect(calls.filter((c) => c.url === BROKER_CONFIG_URL)).toHaveLength(2);
    expect(calls[0].headers['user-agent']).toMatch(/SkyGlass/);
  });

  it('caches failures for about a minute, then retries; allowStale serves the last good config', async () => {
    let up = true;
    handlers.push((c) => {
      if (c.url !== BROKER_CONFIG_URL) return undefined;
      if (!up) throw new TypeError('fetch failed');
      return json({ version: 1, google: GOOGLE_CFG, microsoft: MS_CFG });
    });
    const client = new AuthServiceClient({ baseUrl: () => AUTH, now: () => now });
    await client.getConfig();
    up = false;
    now += 11 * 60 * 1000; // success expired
    await expect(client.getConfig()).rejects.toMatchObject({ message: AUTH_SERVICE_UNREACHABLE });
    expect(calls).toHaveLength(2);
    now += 30 * 1000;
    await expect(client.getConfig()).rejects.toMatchObject({ message: AUTH_SERVICE_UNREACHABLE });
    expect(calls).toHaveLength(2); // failure cached
    expect(await client.getConfig({ allowStale: true })).toEqual({ google: GOOGLE_CFG, microsoft: MS_CFG });
    up = true;
    now += 31 * 1000;
    expect(await client.getConfig()).toEqual({ google: GOOGLE_CFG, microsoft: MS_CFG });
    expect(calls.filter((c) => c.url === BROKER_CONFIG_URL)).toHaveLength(3);
  });

  it('treats non-200 and non-JSON answers as unreachable', async () => {
    on('GET', BROKER_CONFIG_URL, () => new Response('<html>oops</html>', { status: 500 }));
    const client = new AuthServiceClient({ baseUrl: () => AUTH, now: () => now });
    await expect(client.getConfig()).rejects.toMatchObject({ message: AUTH_SERVICE_UNREACHABLE });
  });
});

describe('providers', () => {
  it('reports google/microsoft available when the sign-in service config has them', async () => {
    mockBrokerConfig();
    const { service } = makeService();
    const providers = await service.providers();
    expect(providers.map((p) => [p.id, p.method, p.available, p.reason])).toEqual([
      ['google', 'oauth', true, null],
      ['microsoft', 'device-code', true, null],
      ['icloud', 'password', true, null],
      ['caldav', 'password', true, null],
      ['ics', 'url', true, null],
    ]);
  });

  it('reports "not available right now" for providers the service has not configured', async () => {
    mockBrokerConfig({ google: null, microsoft: null });
    const { service } = makeService();
    const providers = await service.providers();
    expect(providers[0]).toMatchObject({ id: 'google', available: false, reason: GOOGLE_UNAVAILABLE });
    expect(providers[1]).toMatchObject({ id: 'microsoft', available: false, reason: MICROSOFT_UNAVAILABLE });
    expect(GOOGLE_UNAVAILABLE).toBe("Google sign-in isn't available right now.");
    expect(providers.slice(2).every((p) => p.available)).toBe(true);
  });

  it('reports the unreachable reason when the service is down, without blocking past the wait', async () => {
    handlers.push(() => {
      throw new TypeError('fetch failed');
    });
    const { service } = makeService();
    const providers = await service.providers();
    expect(providers.slice(0, 2).map((p) => [p.available, p.reason])).toEqual([
      [false, "Can't reach the SkyGlass sign-in service. Check the mirror's internet connection."],
      [false, AUTH_SERVICE_UNREACHABLE],
    ]);

    // A hanging service: the route answers after waitMs anyway.
    handlers = [() => new Promise<Response>(() => undefined)];
    const { service: slow } = makeService();
    const t0 = Date.now();
    const p2 = await slow.providers(50);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(p2[0]).toMatchObject({ available: false, reason: AUTH_SERVICE_UNREACHABLE });
    expect(p2[2]).toMatchObject({ id: 'icloud', available: true });
  });

  it('explains an invalid skyglass_service setting', async () => {
    const { service } = makeService(settings({ authService: null }));
    const providers = await service.providers();
    expect(providers[0]).toMatchObject({ available: false, reason: AUTH_SERVICE_INVALID });
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- Google

function mockGoogle(email = 'Pilot@Example.com') {
  mockBrokerConfig();
  mockBrokerToken();
  on('GET', 'https://openidconnect.googleapis.com/v1/userinfo', () => json({ email, email_verified: true }));
  on('GET', 'https://www.googleapis.com/calendar/v3/users/me/calendarList', () =>
    json({
      items: [
        { id: 'pilot@example.com', summary: 'pilot@example.com', backgroundColor: '#9FE1E7', primary: true },
        { id: 'en.usa#holiday@group.v.calendar.google.com', summary: 'Holidays in United States', backgroundColor: '#16a765' },
        { id: 'family123@group.calendar.google.com', summary: 'Family' },
      ],
    }),
  );
  on('GET', /calendar\/v3\/calendars\/.+\/events/, (c) => {
    expect(c.url).toContain('singleEvents=true');
    if (c.url.includes('family123')) {
      return json({ items: [{ id: 'fam1', summary: 'Dinner', start: { dateTime: '2026-10-21T18:00:00-04:00' }, end: { dateTime: '2026-10-21T20:00:00-04:00' } }] });
    }
    return json({
      items: [
        { id: 'e1', summary: 'Recurrent training', location: 'Sim bldg', start: { dateTime: '2026-10-22T09:00:00-04:00' }, end: { dateTime: '2026-10-22T17:00:00-04:00' } },
        { id: 'e2', summary: 'Day off', start: { date: '2026-10-23' }, end: { date: '2026-10-24' } },
        { id: 'e3', summary: 'Cancelled', status: 'cancelled', start: { dateTime: '2026-10-22T09:00:00Z' }, end: { dateTime: '2026-10-22T10:00:00Z' } },
        { id: 'e4', summary: 'Declined', attendees: [{ self: true, responseStatus: 'declined' }], start: { dateTime: '2026-10-22T11:00:00Z' }, end: { dateTime: '2026-10-22T12:00:00Z' } },
      ],
    });
  });
}

describe('Google sign-in', () => {
  it('rejects return URLs outside the app schemes', async () => {
    mockBrokerConfig();
    const { service } = makeService();
    for (const bad of ['https://evil.example/cb', 'javascript://x', 'skyglassx://oauth', '']) {
      await expect(service.googleStart(bad)).rejects.toThrow(CalendarError);
    }
    for (const good of ['skyglass://oauth/google', 'exp://192.168.1.5:8081/--/oauth/google', 'exp+skyglass://oauth/google']) {
      expect((await service.googleStart(good)).authUrl).toMatch(/^https:\/\/accounts\.google\.com\//);
    }
  });

  it('fails clearly when the service has no Google config or is unreachable', async () => {
    mockBrokerConfig({ google: null });
    const { service } = makeService();
    await expect(service.googleStart('skyglass://oauth/google')).rejects.toMatchObject({ status: 400, message: GOOGLE_UNAVAILABLE });

    handlers = [
      () => {
        throw new TypeError('fetch failed');
      },
    ];
    const { service: offline } = makeService();
    await expect(offline.googleStart('skyglass://oauth/google')).rejects.toMatchObject({ message: AUTH_SERVICE_UNREACHABLE });
  });

  it('builds the auth URL from the service config (custom client/scopes)', async () => {
    mockBrokerConfig({ google: { clientId: 'other-id.apps.googleusercontent.com', redirectUri: 'https://auth.example.org/oauth/google', scopes: ['openid', 'email', 'x'] } });
    const { service } = makeService();
    const u = await startUrl(service);
    expect(u.searchParams.get('client_id')).toBe('other-id.apps.googleusercontent.com');
    expect(u.searchParams.get('redirect_uri')).toBe('https://auth.example.org/oauth/google');
    expect(u.searchParams.get('scope')).toBe('openid email x');
    expect(u.searchParams.get('client_secret')).toBeNull();
  });

  it('builds a PKCE auth URL and completes through the sign-in service', async () => {
    mockGoogle();
    const { service, store } = makeService();
    const u = await startUrl(service);
    expect(u.searchParams.get('client_id')).toBe('gid.apps.googleusercontent.com');
    expect(u.searchParams.get('redirect_uri')).toBe('https://skyglass.dev/oauth/google');
    expect(u.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/calendar.readonly');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const state = u.searchParams.get('state')!;
    expect(decodeState(state)?.r).toBe('skyglass://oauth/google');

    expect(notifications).toBe(0);
    const { account, created } = await service.googleComplete('auth-code', state);
    expect(created).toBe(true);
    expect(notifications).toBeGreaterThan(0); // WS 'calendar' broadcast on account change

    const tokenCall = calls.find((c) => c.url === BROKER_TOKEN_URL)!;
    expect(tokenCall.method).toBe('POST');
    expect(tokenCall.headers['content-type']).toBe('application/json');
    const p = JSON.parse(tokenCall.body) as Record<string, string>;
    expect(Object.keys(p).sort()).toEqual(['code', 'code_verifier', 'grant_type']);
    expect(p.grant_type).toBe('authorization_code');
    expect(p.code).toBe('auth-code');
    const verifier = p.code_verifier;
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(u.searchParams.get('code_challenge'));

    expect(account.email).toBe('pilot@example.com');
    expect(account.provider).toBe('google');
    expect(account.calendars).toEqual([
      { id: 'pilot@example.com', name: 'pilot@example.com', color: '#9fe1e7', enabled: true },
      { id: 'en.usa#holiday@group.v.calendar.google.com', name: 'Holidays in United States', color: '#16a765', enabled: false },
      { id: 'family123@group.calendar.google.com', name: 'Family', color: expect.stringMatching(/^#[0-9a-f]{6}$/), enabled: true },
    ]);
    expectNoSecrets(account, 'ya29', '1//refresh', verifier);
    expect(store.get(account.id)?.secrets.refreshToken).toBe('1//refresh');

    // state is single use
    await expect(service.googleComplete('auth-code', state)).rejects.toMatchObject({ status: 400 });

    // reconnecting the same Google account replaces tokens instead of duplicating
    store.update(account.id, (a) => {
      a.status = 'reauth';
    });
    const second = await service.googleComplete('code-2', await startState(service));
    expect(second.created).toBe(false);
    expect(second.account.id).toBe(account.id);
    expect(second.account.status).toBe('ok');
    expect(service.listAccounts()).toHaveLength(1);
    await service.syncAccount(account.id);
    expectNoClientCredentials();
  });

  it('rejects tampered, unknown and expired state', async () => {
    mockGoogle();
    const { service } = makeService();
    await expect(service.googleComplete('c', 'garbage')).rejects.toMatchObject({ status: 400 });
    const state = await startState(service);
    const { n } = decodeState(state)!;
    const tampered = Buffer.from(JSON.stringify({ n, r: 'exp://evil' })).toString('base64url');
    await expect(service.googleComplete('c', tampered)).rejects.toMatchObject({ status: 400 });
    now += 11 * 60 * 1000;
    await expect(service.googleComplete('c', state)).rejects.toMatchObject({ status: 400 });
    expect(calls.some((c) => c.url === BROKER_TOKEN_URL)).toBe(false);
  });

  it('returns 502 when the code exchange fails', async () => {
    mockBrokerConfig();
    on('POST', BROKER_TOKEN_URL, () => json({ error: 'invalid_grant', error_description: 'Bad Request' }, 400));
    const { service } = makeService();
    await expect(service.googleComplete('c', await startState(service))).rejects.toMatchObject({
      status: 502,
      message: 'Google sign-in failed. Please try again.',
    });
  });

  it.each([
    [503, { error: 'not_configured' }, GOOGLE_UNAVAILABLE],
    [502, { error: 'upstream_unavailable' }, /temporarily unavailable/],
    [429, { error: 'rate_limited' }, /Too many/],
  ])('maps a broker %i on code exchange to a readable 502', async (status, body, message) => {
    mockBrokerConfig();
    on('POST', BROKER_TOKEN_URL, () => json(body, status));
    const { service } = makeService();
    await expect(service.googleComplete('c', await startState(service))).rejects.toMatchObject({
      status: 502,
      message: typeof message === 'string' ? message : expect.stringMatching(message),
    });
  });

  it('follows one 307/308 hop to the www. host only; never elsewhere', async () => {
    mockBrokerConfig();
    on('POST', BROKER_TOKEN_URL, () => new Response('', { status: 308, headers: { Location: 'https://elsewhere.example/token' } }));
    const { service } = makeService();
    await expect(service.googleComplete('c', await startState(service))).rejects.toMatchObject({ message: AUTH_SERVICE_UNREACHABLE });
    expect(calls.some((c) => c.url.includes('elsewhere'))).toBe(false);

    expect(sameSiteRedirect('https://skyglass.dev/api/oauth/google/token', 307, 'https://www.skyglass.dev/api/oauth/google/token')).toBe(
      'https://www.skyglass.dev/api/oauth/google/token',
    );
    expect(sameSiteRedirect('https://skyglass.dev/x', 302, 'https://www.skyglass.dev/x')).toBeNull(); // 302 may drop the body
    expect(sameSiteRedirect('https://skyglass.dev/x', 307, 'http://www.skyglass.dev/x')).toBeNull();
    expect(sameSiteRedirect('https://skyglass.dev/x', 307, 'https://skyglass.dev.evil.example/x')).toBeNull();
  });

  it('exchanges through an apex -> www redirect', async () => {
    const apex = 'https://skyglass.test';
    on('GET', `${apex}/api/oauth/config`, () => json({ version: 1, google: GOOGLE_CFG, microsoft: null }));
    on('POST', `${apex}/api/oauth/google/token`, () => new Response('', { status: 307, headers: { Location: 'https://www.skyglass.test/api/oauth/google/token' } }));
    on('POST', 'https://www.skyglass.test/api/oauth/google/token', (c) => {
      expect(JSON.parse(c.body)).toMatchObject({ grant_type: 'authorization_code', code: 'c' });
      return json({ access_token: 'ya29.access', refresh_token: '1//refresh', expires_in: 3599 });
    });
    on('GET', 'https://openidconnect.googleapis.com/v1/userinfo', () => json({ email: 'a@b.c' }));
    on('GET', 'https://www.googleapis.com/calendar/v3/users/me/calendarList', () => json({ items: [] }));
    const { service } = makeService(settings({ authService: apex }));
    const { created } = await service.googleComplete('c', await startState(service));
    expect(created).toBe(true);
  });

  it('syncs enabled calendars, refreshes via the service, and marks invalid_grant as reauth', async () => {
    mockGoogle();
    const { service, store } = makeService();
    const { account } = await service.googleComplete('code', await startState(service));
    await service.syncAccount(account.id);

    const { events, accounts } = await service.getEvents(scheduleWindow('7', TZ, now));
    expect(events.map((e) => e.title)).toEqual(['Dinner', 'Recurrent training', 'Day off']);
    const dayOff = events.find((e) => e.title === 'Day off')!;
    expect(dayOff).toMatchObject({ allDay: true, startDate: '2026-10-23', endDate: '2026-10-24', startTime: '2026-10-23T04:00:00.000Z' });
    const training = events.find((e) => e.title === 'Recurrent training')!;
    expect(training).toMatchObject({
      source: 'google',
      accountId: account.id,
      calendarId: 'pilot@example.com',
      calendarName: 'pilot@example.com',
      color: '#9fe1e7',
      location: 'Sim bldg',
      startTime: '2026-10-22T13:00:00.000Z',
      isFlightDuty: false,
    });
    expect(training.id.startsWith(`${account.id}:`)).toBe(true);
    expect(accounts).toEqual([{ id: account.id, label: 'Google', provider: 'google', status: 'ok' }]);
    // the holiday calendar is disabled, so it is never fetched
    expect(calls.some((c) => c.url.includes('holiday'))).toBe(false);

    // Expired access token → refresh_token grant
    now += 2 * 60 * 60 * 1000;
    calls = [];
    await service.syncAccount(account.id);
    const refresh = calls.find((c) => c.url === BROKER_TOKEN_URL)!;
    expect(JSON.parse(refresh.body)).toEqual({ grant_type: 'refresh_token', refresh_token: '1//refresh' });
    expect(store.get(account.id)?.secrets.accessToken).toBe('ya29.refreshed');
    expectNoClientCredentials();

    // Refresh token revoked → reauth, cached events still served
    handlers.unshift((c) => (c.url === BROKER_TOKEN_URL ? json({ error: 'invalid_grant' }, 400) : undefined));
    now += 2 * 60 * 60 * 1000;
    await service.syncAccount(account.id);
    const after = service.getAccount(account.id);
    expect(after.status).toBe('reauth');
    expect(after.error).toMatch(/Reconnect/);
    const stillThere = await service.getEvents({ start: Date.parse('2026-10-21T00:00:00Z'), end: Date.parse('2026-10-25T00:00:00Z') });
    expect(stillThere.events.length).toBe(3);
  });

  it.each([
    ['broker 502', () => json({ error: 'upstream_unavailable' }, 502), /temporarily unavailable/],
    ['broker 503', () => json({ error: 'not_configured' }, 503), /isn't available right now/],
    [
      'network error',
      () => {
        throw new TypeError('fetch failed');
      },
      /Can't reach the SkyGlass sign-in service/,
    ],
  ])('a refresh failure (%s) sets status error and keeps cached events', async (_name, respond, message) => {
    mockGoogle();
    const { service } = makeService();
    const { account } = await service.googleComplete('code', await startState(service));
    await service.syncAccount(account.id);
    const before = await service.getEvents(scheduleWindow('7', TZ, now));
    expect(before.events).toHaveLength(3);

    handlers.unshift((c) => (c.url === BROKER_TOKEN_URL ? respond() : undefined));
    now += 2 * 60 * 60 * 1000; // access token expired → refresh needed
    await service.syncAccount(account.id);
    const after = service.getAccount(account.id);
    expect(after.status).toBe('error');
    expect(after.error).toMatch(message);
    const { events, accounts } = await service.getEvents({ start: Date.parse('2026-10-21T00:00:00Z'), end: Date.parse('2026-10-25T00:00:00Z') });
    expect(events.map((e) => e.title)).toEqual(before.events.map((e) => e.title));
    expect(accounts[0].status).toBe('error');
  });

  it('a 401 after refresh sets reauth', async () => {
    mockGoogle();
    const { service } = makeService();
    const { account } = await service.googleComplete('code', await startState(service));
    await service.syncAccount(account.id);
    handlers.unshift((c) => (c.url.includes('/calendar/v3/calendars/') ? new Response('', { status: 401 }) : undefined));
    await service.syncAccount(account.id);
    expect(service.getAccount(account.id).status).toBe('reauth');
  });

  it('PATCH toggles calendars and locks colors; DELETE revokes best-effort', async () => {
    mockGoogle();
    on('POST', 'https://oauth2.googleapis.com/revoke', () => new Response('', { status: 200 }));
    const { service } = makeService();
    const { account } = await service.googleComplete('code', await startState(service));
    await service.syncAccount(account.id);

    const patched = service.patchAccount(account.id, {
      label: 'Personal',
      calendars: [
        { id: 'family123@group.calendar.google.com', enabled: false },
        { id: 'pilot@example.com', color: '#FF0000' },
      ],
    });
    expect(patched.label).toBe('Personal');
    expect(patched.calendars.find((c) => c.id === 'pilot@example.com')?.color).toBe('#ff0000');
    const { events } = await service.getEvents(scheduleWindow('7', TZ, now));
    expect(events.map((e) => e.title)).toEqual(['Recurrent training', 'Day off']);
    expect(events[0].color).toBe('#ff0000');

    // rediscovery keeps the user's color and enabled choices
    await service.syncNow(account.id);
    const synced = service.getAccount(account.id);
    expect(synced.calendars.find((c) => c.id === 'pilot@example.com')?.color).toBe('#ff0000');
    expect(synced.calendars.find((c) => c.id === 'family123@group.calendar.google.com')?.enabled).toBe(false);

    expect(() => service.patchAccount(account.id, { calendars: [{ id: 'nope', enabled: true }] })).toThrow(CalendarError);

    await service.deleteAccount(account.id);
    const revoke = calls.find((c) => c.url.startsWith('https://oauth2.googleapis.com/revoke'))!;
    expect(new URLSearchParams(revoke.body).get('token')).toBe('1//refresh');
    expectNoClientCredentials();
    expect(service.listAccounts()).toEqual([]);
    await expect(service.deleteAccount(account.id)).rejects.toMatchObject({ status: 404 });
  });
});

// ---------------------------------------------------------------- Microsoft

function mockMicrosoftGraph() {
  on('GET', 'https://graph.microsoft.com/v1.0/me', () => json({ mail: null, userPrincipalName: 'Pilot@Outlook.com' }));
  on('GET', 'https://graph.microsoft.com/v1.0/me/calendars', () =>
    json({
      value: [
        { id: 'AAMk-default', name: 'Calendar', hexColor: '', isDefaultCalendar: true },
        { id: 'AAMk-bday', name: 'Birthdays', hexColor: '#ff8c00', isDefaultCalendar: false },
      ],
    }),
  );
  on('GET', /graph\.microsoft\.com\/v1\.0\/me\/calendars\/.+\/calendarView/, (c) => {
    expect(c.headers['prefer']).toBe('outlook.timezone="UTC"');
    return json({
      value: [
        { id: 'm1', subject: 'Line check', start: { dateTime: '2026-10-22T15:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-22T16:00:00.0000000', timeZone: 'UTC' }, location: { displayName: 'Ops' } },
        { id: 'm2', subject: 'Holiday', isAllDay: true, start: { dateTime: '2026-10-24T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-25T00:00:00.0000000', timeZone: 'UTC' } },
        { id: 'm3', subject: 'Cancelled', isCancelled: true, start: { dateTime: '2026-10-22T15:00:00.0000000' }, end: { dateTime: '2026-10-22T16:00:00.0000000' } },
      ],
    });
  });
}

describe('Microsoft device code flow', () => {
  function mockDeviceCode() {
    mockBrokerConfig();
    on('POST', 'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode', (c) => {
      const p = new URLSearchParams(c.body);
      expect(p.get('client_id')).toBe('ms-client');
      expect(p.get('scope')).toBe('offline_access User.Read Calendars.Read');
      return json({ device_code: 'DEVCODE', user_code: 'ABCD-1234', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5 });
    });
  }

  function tokenSequence(responses: Response[]) {
    let i = 0;
    on('POST', 'https://login.microsoftonline.com/common/oauth2/v2.0/token', (c) => {
      const p = new URLSearchParams(c.body);
      if (p.get('grant_type') === 'refresh_token') return json({ access_token: 'ms-refreshed', refresh_token: 'ms-rt-2', expires_in: 3600 });
      expect(p.get('device_code')).toBe('DEVCODE');
      return responses[Math.min(i++, responses.length - 1)];
    });
  }

  it('polls through authorization_pending and slow_down, then creates the account', async () => {
    mockDeviceCode();
    tokenSequence([
      json({ error: 'authorization_pending' }, 400),
      json({ error: 'slow_down' }, 400),
      json({ error: 'authorization_pending' }, 400),
      json({ access_token: 'ms-access', refresh_token: 'ms-rt', expires_in: 3600 }),
    ]);
    mockMicrosoftGraph();
    const sleeps: number[] = [];
    const { service } = makeService(settings(), { sleeps });
    const start = await service.microsoftStart();
    expect(start).toMatchObject({ userCode: 'ABCD-1234', verificationUri: 'https://microsoft.com/devicelogin' });
    expect(Date.parse(start.expiresAt)).toBe(NOW + 900_000);

    await vi.waitFor(() => expect(service.microsoftStatus(start.sessionId).status).toBe('complete'));
    // interval honored, +5 s after slow_down
    expect(sleeps).toEqual([5000, 5000, 10000, 10000]);
    const status = service.microsoftStatus(start.sessionId);
    expect(status.error).toBeNull();
    expect(status.account).toMatchObject({ provider: 'microsoft', email: 'pilot@outlook.com', label: 'Outlook' });
    expect(status.account!.calendars).toEqual([
      { id: 'AAMk-default', name: 'Calendar', color: expect.stringMatching(/^#[0-9a-f]{6}$/), enabled: true },
      { id: 'AAMk-bday', name: 'Birthdays', color: '#ff8c00', enabled: false },
    ]);
    expectNoSecrets(status, 'ms-access', 'ms-rt', 'DEVCODE');

    await service.syncAccount(status.account!.id);
    const { events } = await service.getEvents(scheduleWindow('7', TZ, now));
    expect(events.map((e) => [e.title, e.startTime, e.allDay, e.startDate])).toEqual([
      ['Line check', '2026-10-22T15:00:00.000Z', false, null],
      ['Holiday', '2026-10-24T04:00:00.000Z', true, '2026-10-24'],
    ]);
  });

  it.each([
    ['expired_token', 'expired'],
    ['authorization_declined', 'denied'],
    ['invalid_client', 'error'],
  ])('maps %s to %s', async (error, expected) => {
    mockDeviceCode();
    tokenSequence([json({ error: 'authorization_pending' }, 400), json({ error }, 400)]);
    const { service } = makeService();
    const start = await service.microsoftStart();
    await vi.waitFor(() => expect(service.microsoftStatus(start.sessionId).status).toBe(expected));
    const status = service.microsoftStatus(start.sessionId);
    expect(status.account).toBeNull();
    expect(typeof status.error).toBe('string');
    expect(service.listAccounts()).toEqual([]);
  });

  it('expires when the code lifetime passes', async () => {
    mockDeviceCode();
    tokenSequence([json({ error: 'authorization_pending' }, 400)]);
    const { service } = makeService();
    const start = await service.microsoftStart();
    now += 901_000;
    await vi.waitFor(() => expect(service.microsoftStatus(start.sessionId).status).toBe('expired'));
  });

  it('unknown sessions are 404 and unconfigured Microsoft is a clear 400', async () => {
    mockBrokerConfig({ microsoft: null });
    const { service } = makeService();
    expect(() => service.microsoftStatus('nope')).toThrow(expect.objectContaining({ status: 404 }));
    await expect(service.microsoftStart()).rejects.toMatchObject({ status: 400, message: MICROSOFT_UNAVAILABLE });
  });

  it('uses the client id, tenant and scopes from the sign-in service, also for refresh', async () => {
    mockBrokerConfig({ microsoft: { clientId: 'broker-ms-id', tenant: 'organizations', scopes: ['offline_access', 'User.Read', 'Calendars.Read'] } });
    on('POST', 'https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode', (c) => {
      const p = new URLSearchParams(c.body);
      expect(p.get('client_id')).toBe('broker-ms-id');
      expect(p.get('scope')).toBe('offline_access User.Read Calendars.Read');
      return json({ device_code: 'DEVCODE', user_code: 'WXYZ-9876', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5 });
    });
    on('POST', 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token', (c) => {
      const p = new URLSearchParams(c.body);
      expect(p.get('client_id')).toBe('broker-ms-id');
      expect(p.has('client_secret')).toBe(false);
      if (p.get('grant_type') === 'refresh_token') return json({ access_token: 'ms-refreshed', expires_in: 3600 });
      return json({ access_token: 'ms-access', refresh_token: 'ms-rt', expires_in: 3600 });
    });
    mockMicrosoftGraph();
    const { service, store } = makeService();
    const start = await service.microsoftStart();
    await vi.waitFor(() => expect(service.microsoftStatus(start.sessionId).status).toBe('complete'));
    const id = service.microsoftStatus(start.sessionId).account!.id;
    await service.syncAccount(id);

    // Sign-in service down later: Microsoft refresh still works with the last good config.
    handlers.unshift((c) => {
      if (c.url === BROKER_CONFIG_URL) throw new TypeError('fetch failed');
      return undefined;
    });
    now += 2 * 60 * 60 * 1000; // config cache + access token both expired
    await service.syncAccount(id);
    expect(store.get(id)?.secrets.accessToken).toBe('ms-refreshed');
    expect(service.getAccount(id).status).toBe('ok');
    expect(calls.some((c) => c.url.includes('/common/'))).toBe(false);
  });
});

// ---------------------------------------------------------------- CalDAV (iCloud)

const PRINCIPAL_XML = `<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>/</href><propstat><prop><current-user-principal><href>/123456/principal/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
const HOME_XML = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/123456/principal/</d:href><d:propstat><d:prop><cal:calendar-home-set><d:href>https://p01-caldav.icloud.com:443/123456/calendars/</d:href></cal:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
const CALENDARS_XML = `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">
<response><href>/123456/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/123456/calendars/home/</href><propstat><prop><resourcetype><collection/><C:calendar/></resourcetype><displayname>Home &amp; Family</displayname><A:calendar-color>#FF2968FF</A:calendar-color><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/123456/calendars/work/</href><propstat><prop><resourcetype><collection/><C:calendar/></resourcetype><displayname>Work</displayname><C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat><propstat><prop><A:calendar-color/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response>
<response><href>/123456/calendars/tasks/</href><propstat><prop><resourcetype><collection/><C:calendar/></resourcetype><displayname>Reminders</displayname><C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>`;

function reportXml(summary: string, start: string): string {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${summary}`,
    `SUMMARY:${summary}`,
    `DTSTART:${start}`,
    'DURATION:PT1H',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  return `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><href>/x.ics</href><propstat><prop><getetag>"1"</getetag><C:calendar-data>${ics.replace(/&/g, '&amp;')}</C:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
}

function mockICloud(password = 'abcd-efgh-ijkl-mnop') {
  const expected = `Basic ${Buffer.from(`pilot@icloud.com:${password}`).toString('base64')}`;
  const authed = (c: Call, r: () => Response) => (c.headers['authorization'] === expected ? r() : new Response('', { status: 401 }));
  on('PROPFIND', 'https://caldav.icloud.com/', (c) => authed(c, () => xml(PRINCIPAL_XML)));
  on('PROPFIND', 'https://caldav.icloud.com/123456/principal/', (c) => authed(c, () => xml(HOME_XML)));
  on('PROPFIND', 'https://p01-caldav.icloud.com/123456/calendars/', (c) => {
    expect(c.headers['depth']).toBe('1');
    return authed(c, () => xml(CALENDARS_XML));
  });
  on('REPORT', 'https://p01-caldav.icloud.com/123456/calendars/home/', (c) => {
    expect(c.body).toContain('<c:time-range start="');
    return authed(c, () => xml(reportXml('Kids & soccer', '20261022T220000Z')));
  });
  on('REPORT', 'https://p01-caldav.icloud.com/123456/calendars/work/', (c) =>
    authed(c, () => xml(reportXml('Standup', '20261022T130000Z'))),
  );
}

describe('CalDAV (iCloud)', () => {
  it('discovers principal → home → event calendars and syncs enabled ones', async () => {
    mockICloud();
    const { service } = makeService();
    const { account, created } = await service.addCalDav({ provider: 'icloud', username: 'pilot@icloud.com', password: 'abcd-efgh-ijkl-mnop' });
    expect(created).toBe(true);
    expect(account).toMatchObject({ provider: 'icloud', label: 'iCloud', email: 'pilot@icloud.com' });
    expect(account.calendars.map((c) => [c.name, c.enabled])).toEqual([
      ['Home & Family', true],
      ['Work', true],
    ]);
    expect(account.calendars[0].color).toBe('#ff2968');
    expect(account.calendars[0].id).toMatch(/^[0-9a-f]{16}$/);
    expectNoSecrets(account, 'abcd-efgh', 'p01-caldav');
    await service.syncAccount(account.id);

    let { events } = await service.getEvents(scheduleWindow('7', TZ, now));
    expect(events.map((e) => [e.title, e.calendarName])).toEqual([
      ['Standup', 'Work'],
      ['Kids & soccer', 'Home & Family'],
    ]);

    // Enabled-calendar filtering
    service.patchAccount(account.id, { calendars: [{ id: account.calendars[1].id, enabled: false }] });
    ({ events } = await service.getEvents(scheduleWindow('7', TZ, now)));
    expect(events.map((e) => e.title)).toEqual(['Kids & soccer']);
    expect(events[0]).toMatchObject({ source: 'icloud', color: '#ff2968', endTime: '2026-10-22T23:00:00.000Z' });
  });

  it('rejects bad credentials with the contract message', async () => {
    mockICloud();
    const { service } = makeService();
    await expect(
      service.addCalDav({ provider: 'icloud', username: 'pilot@icloud.com', password: 'wrong' }),
    ).rejects.toMatchObject({ status: 400, message: 'Apple ID or app-specific password was rejected' });
    expect(service.listAccounts()).toEqual([]);
  });

  it('requires a server URL for generic CalDAV', async () => {
    const { service } = makeService();
    await expect(service.addCalDav({ provider: 'caldav', username: 'u', password: 'p' })).rejects.toMatchObject({ status: 400 });
  });
});

// ---------------------------------------------------------------- ICS

describe('ICS links', () => {
  const FEED = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'X-WR-CALNAME:Crew roster',
    'BEGIN:VEVENT',
    'UID:r1',
    'SUMMARY:Trip 4411',
    'DTSTART:20261022T110000Z',
    'DTEND:20261024T200000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('normalizes webcal:// and creates a one-calendar account', async () => {
    expect(normalizeIcsUrl('webcal://p01-calendars.icloud.com/published/2/abc')).toBe('https://p01-calendars.icloud.com/published/2/abc');
    on('GET', 'https://calendar.example.com/secret/basic.ics', () => new Response(FEED, { status: 200 }));
    const { service, store } = makeService();
    const account = await service.addIcs({ url: 'webcal://calendar.example.com/secret/basic.ics' });
    expect(account).toMatchObject({ provider: 'ics', label: 'Crew roster', email: null, status: 'ok' });
    expect(account.calendars).toHaveLength(1);
    expectNoSecrets(account, 'secret/basic');
    expect(store.get(account.id)?.secrets.icsUrl).toBe('https://calendar.example.com/secret/basic.ics');
    const { events } = await service.getEvents(scheduleWindow('3', TZ, now));
    expect(events.map((e) => e.title)).toEqual(['Trip 4411']);
    expect(calls).toHaveLength(1); // served from the cache seeded at creation
  });

  it('rejects links that are not calendars or point at private hosts', async () => {
    on('GET', 'https://example.com/page', () => new Response('<html></html>', { status: 200 }));
    const { service } = makeService();
    await expect(service.addIcs({ url: 'https://example.com/page' })).rejects.toMatchObject({ status: 400, message: "That link didn't return a calendar" });
    await expect(service.addIcs({ url: 'http://192.168.1.10/cal.ics' })).rejects.toMatchObject({ status: 400 });
    expect(service.listAccounts()).toEqual([]);
  });
});

// ---------------------------------------------------------------- merge + window

describe('schedule merge', () => {
  function ev(title: string, startTime: string, extra: Partial<ScheduleEvent> = {}): ScheduleEvent {
    return {
      id: title,
      source: 'google',
      accountId: 'a',
      calendarId: 'c',
      calendarName: 'C',
      color: '#7ad7ff',
      title,
      location: null,
      startTime,
      endTime: startTime,
      allDay: false,
      startDate: null,
      endDate: null,
      isFlightDuty: false,
      ...extra,
    };
  }

  it('sorts calendar and xlsx events by start, all-day first on ties', () => {
    const flight = flightToScheduleEvent({
      id: 'f1',
      source: 'xlsx',
      title: 'FLT 123 JFK-BOS',
      startTime: new Date('2026-10-22T12:00:00Z'),
      endTime: new Date('2026-10-22T13:30:00Z'),
      allDay: false,
      flightNumber: '123',
      departure: 'JFK',
      arrival: 'BOS',
      reportTime: new Date('2026-10-22T11:00:00Z'),
    });
    expect(flight).toMatchObject({
      id: 'xlsx:f1',
      source: 'xlsx',
      accountId: null,
      calendarId: null,
      color: null,
      isFlightDuty: true,
      reportTime: '2026-10-22T11:00:00.000Z',
      startDate: null,
    });
    const merged = mergeScheduleEvents(
      [ev('Late', '2026-10-22T18:00:00.000Z'), ev('B timed', '2026-10-22T04:00:00.000Z'), ev('A all day', '2026-10-22T04:00:00.000Z', { allDay: true })],
      [flight],
    );
    expect(merged.map((e) => e.title)).toEqual(['A all day', 'B timed', 'FLT 123 JFK-BOS', 'Late']);
  });

  it('clamps days to 1..30 and starts at local midnight', () => {
    const w = scheduleWindow('99', TZ, NOW);
    expect(new Date(w.start).toISOString()).toBe('2026-10-21T04:00:00.000Z');
    expect(w.end).toBe(NOW + 30 * 86_400_000);
    expect(scheduleWindow(undefined, TZ, NOW).end).toBe(NOW + 7 * 86_400_000);
    expect(scheduleWindow('0', TZ, NOW).end).toBe(NOW + 86_400_000);
  });

  it('returns quickly with an empty list when there are no accounts', async () => {
    const { service } = makeService();
    const res = await service.getEvents(scheduleWindow('7', TZ, now));
    expect(res).toEqual({ events: [], accounts: [], updatedAt: new Date(NOW).toISOString() });
  });
});
