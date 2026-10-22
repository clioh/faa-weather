/**
 * Calendar accounts service: connect flows, per-account event cache,
 * background sync with token refresh, and the merged event view used by
 * GET /api/schedule.
 */

import { createHash, randomBytes, randomUUID } from 'crypto';
import { CalendarAccountStore, toPublicAccount } from './accounts-store.js';
import { normalizeColor, paletteColor } from './colors.js';
import type { CalendarSettings } from './config.js';
import { UnauthorizedError, type TokenSet } from './http.js';
import { IcsParseError, parseIcs } from './ical.js';
import { startOfToday } from './time.js';
import {
  CalendarAuthError,
  CalendarError,
  type CachedEvent,
  type CalendarAccount,
  type CalendarProviderId,
  type DiscoveredCalendar,
  type RawEvent,
  type ScheduleAccountSummary,
  type ScheduleEvent,
  type StoredAccount,
  type StoredCalendar,
  type TimeWindow,
} from './types.js';
import {
  AUTH_SERVICE_UNREACHABLE,
  AuthServiceClient,
  GOOGLE_UNAVAILABLE,
  MICROSOFT_UNAVAILABLE,
  type AuthServiceConfig,
} from './auth-service.js';
import { buildGoogleAuthUrl, fetchGoogleEmail, fetchGoogleEvents, listGoogleCalendars, revokeGoogleToken } from './providers/google.js';
import {
  fetchMicrosoftEmail,
  fetchMicrosoftEvents,
  listMicrosoftCalendars,
  pollDeviceToken,
  refreshMicrosoftToken,
  startDeviceCode,
  type MicrosoftConfig,
} from './providers/microsoft.js';
import { CalDavClient, caldavServerUrl } from './providers/caldav.js';
import { safeFetchText, UnsafeUrlError } from '../services/ssrf.js';
import { UpstreamError } from '../services/upstream.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const GOOGLE_SESSION_TTL_MS = 10 * 60 * 1000;
const MS_SESSION_KEEP_MS = 15 * 60 * 1000;
const DISCOVERY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETURN_URL_PATTERN = /^(skyglass|exp|exp\+skyglass):\/\//;
const ICS_CALENDAR_ID = 'feed';

/** Longest GET /api/calendar/providers waits for the sign-in service config. */
const PROVIDERS_WAIT_MS = 5000;

export class AccountNotFoundError extends CalendarError {
  constructor() {
    super('Calendar account not found', 404);
    this.name = 'AccountNotFoundError';
  }
}

export interface ProviderInfo {
  id: CalendarProviderId;
  name: string;
  method: 'oauth' | 'device-code' | 'password' | 'url';
  available: boolean;
  reason: string | null;
}

export interface MicrosoftSessionStatus {
  status: 'pending' | 'complete' | 'expired' | 'denied' | 'error';
  account: CalendarAccount | null;
  error: string | null;
}

interface MicrosoftSession {
  id: string;
  cfg: MicrosoftConfig;
  deviceCode: string;
  expiresAt: number;
  interval: number;
  status: MicrosoftSessionStatus['status'];
  accountId: string | null;
  error: string | null;
  finishedAt: number | null;
}

interface GoogleSession {
  verifier: string;
  returnUrl: string;
  expiresAt: number;
}

interface CacheEntry {
  events: CachedEvent[];
  signature: string;
  syncedAt: number;
}

interface Adapter {
  discover(): Promise<DiscoveredCalendar[]>;
  fetchEvents(calendar: StoredCalendar, window: TimeWindow): Promise<RawEvent[]>;
}

export interface CalendarServiceDeps {
  store: CalendarAccountStore;
  getSettings: () => CalendarSettings;
  /** Called with the WS 'calendar' payload whenever accounts or the event set change. */
  notify?: (payload: { updatedAt: string }) => void;
  now?: () => number;
  /** Delay used between Microsoft device-code polls (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
  /** DNS resolver for the ICS SSRF guard (tests). */
  resolveHost?: (host: string) => Promise<string[]>;
  /** SkyGlass sign-in service client; defaults to one using settings.authService. */
  authService?: AuthServiceClient;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function shortHash(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 16);
}

export function encodeState(nonce: string, returnUrl: string): string {
  return base64url(Buffer.from(JSON.stringify({ n: nonce, r: returnUrl }), 'utf-8'));
}

export function decodeState(state: string): { n: string; r: string } | null {
  try {
    const json = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as { n?: unknown; r?: unknown };
    if (typeof json.n === 'string' && typeof json.r === 'string') return { n: json.n, r: json.r };
  } catch {
    // fall through
  }
  return null;
}

export function isValidReturnUrl(url: string): boolean {
  return RETURN_URL_PATTERN.test(url);
}

/** Normalize a subscribe link: webcal:// → https://. */
export function normalizeIcsUrl(raw: string): string {
  const s = raw.trim();
  if (/^webcals?:\/\//i.test(s)) return s.replace(/^webcals?:\/\//i, 'https://');
  return s;
}

function overlaps(start: number, end: number, w: TimeWindow): boolean {
  if (end === start) return start >= w.start && start < w.end;
  return start < w.end && end > w.start;
}

function signatureOf(events: CachedEvent[]): string {
  const h = createHash('sha1');
  for (const e of [...events].sort((a, b) => a.start - b.start || a.key.localeCompare(b.key))) {
    h.update(`${e.calendarId}|${e.key}|${e.start}|${e.end}|${e.title}|${e.location ?? ''}|${e.allDay}\n`);
  }
  return h.digest('hex');
}

export function compareScheduleEvents(a: ScheduleEvent, b: ScheduleEvent): number {
  const d = Date.parse(a.startTime) - Date.parse(b.startTime);
  if (d !== 0) return d;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/**
 * Merge rediscovered calendars into the stored list: user choices (enabled,
 * locked color) survive, new calendars get defaults, vanished ones are dropped.
 */
export function mergeCalendars(
  existing: StoredCalendar[],
  discovered: DiscoveredCalendar[],
  paletteStart: number,
): StoredCalendar[] {
  let n = paletteStart;
  return discovered.map((d) => {
    const prev = existing.find((c) => c.id === d.id);
    const providerColor = normalizeColor(d.color);
    const color = prev?.colorLocked ? prev.color : (providerColor ?? prev?.color ?? paletteColor(n++));
    const cal: StoredCalendar = {
      id: d.id,
      name: d.name,
      color,
      enabled: prev ? prev.enabled : d.primary || !d.system,
      primary: d.primary,
    };
    if (prev?.colorLocked) cal.colorLocked = true;
    if (d.url) cal.url = d.url;
    return cal;
  });
}

export class CalendarService {
  private readonly store: CalendarAccountStore;
  private readonly getSettings: () => CalendarSettings;
  private readonly notifyFn: (payload: { updatedAt: string }) => void;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly resolveHost?: (host: string) => Promise<string[]>;
  private readonly auth: AuthServiceClient;

  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly googleSessions = new Map<string, GoogleSession>();
  private readonly msSessions = new Map<string, MicrosoftSession>();
  private timer: NodeJS.Timeout | null = null;
  private timerMinutes = 0;
  private stopped = false;

  constructor(deps: CalendarServiceDeps) {
    this.store = deps.store;
    this.getSettings = deps.getSettings;
    this.notifyFn = deps.notify ?? (() => undefined);
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms).unref?.()));
    this.resolveHost = deps.resolveHost;
    this.auth = deps.authService ?? new AuthServiceClient({ baseUrl: () => this.getSettings().authService, now: this.now });
  }

  // ---------------------------------------------------------------- lifecycle

  /** Start background refresh (every refresh_minutes) and an initial sync. */
  start(): void {
    this.stopped = false;
    this.reschedule();
    setTimeout(() => void this.syncAll(), 3000).unref?.();
  }

  /** Re-arm the refresh timer if refresh_minutes changed (config reload). */
  reschedule(): void {
    const minutes = this.getSettings().refreshMinutes;
    if (this.timer && minutes === this.timerMinutes) return;
    if (this.timer) clearInterval(this.timer);
    this.timerMinutes = minutes;
    this.timer = setInterval(() => void this.syncAll(), minutes * 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Current settings (timezone, refresh interval, sign-in service URL). */
  syncSettings(): CalendarSettings {
    return this.getSettings();
  }

  /** Broadcast that the merged schedule changed (e.g. a new XLSX upload). */
  notifyChanged(): void {
    this.notify();
  }

  private notify(): void {
    this.notifyFn({ updatedAt: this.updatedAt() });
  }

  private updatedAt(): string {
    const times = this.store
      .list()
      .map((a) => (a.lastSyncAt ? Date.parse(a.lastSyncAt) : NaN))
      .filter(Number.isFinite);
    return new Date(times.length ? Math.max(...times) : this.now()).toISOString();
  }

  // ---------------------------------------------------------------- providers + accounts

  /**
   * Provider list. Google/Outlook availability comes from the sign-in
   * service config; waits at most `waitMs` for it (cached afterwards).
   */
  async providers(waitMs = PROVIDERS_WAIT_MS): Promise<ProviderInfo[]> {
    let cfg: AuthServiceConfig | null = null;
    let unreachable: string | null = null;
    let timer: NodeJS.Timeout | undefined;
    try {
      cfg = await Promise.race([
        this.auth.getConfig(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new CalendarError(AUTH_SERVICE_UNREACHABLE, 503)), waitMs);
          timer.unref?.();
        }),
      ]);
    } catch (error) {
      unreachable = error instanceof CalendarError ? error.message : AUTH_SERVICE_UNREACHABLE;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const reason = (available: boolean, notAvailable: string) => (available ? null : (unreachable ?? notAvailable));
    return [
      { id: 'google', name: 'Google Calendar', method: 'oauth', available: !!cfg?.google, reason: reason(!!cfg?.google, GOOGLE_UNAVAILABLE) },
      {
        id: 'microsoft',
        name: 'Outlook / Microsoft 365',
        method: 'device-code',
        available: !!cfg?.microsoft,
        reason: reason(!!cfg?.microsoft, MICROSOFT_UNAVAILABLE),
      },
      { id: 'icloud', name: 'iCloud', method: 'password', available: true, reason: null },
      { id: 'caldav', name: 'Other CalDAV', method: 'password', available: true, reason: null },
      { id: 'ics', name: 'Calendar link', method: 'url', available: true, reason: null },
    ];
  }

  listAccounts(): CalendarAccount[] {
    return this.store.list().map(toPublicAccount);
  }

  getAccount(id: string): CalendarAccount {
    const a = this.store.get(id);
    if (!a) throw new AccountNotFoundError();
    return toPublicAccount(a);
  }

  patchAccount(
    id: string,
    patch: { label?: string; calendars?: Array<{ id: string; enabled?: boolean; color?: string }> },
  ): CalendarAccount {
    const account = this.store.get(id);
    if (!account) throw new AccountNotFoundError();
    for (const c of patch.calendars ?? []) {
      if (!account.calendars.some((x) => x.id === c.id)) throw new CalendarError('Unknown calendar', 400);
      if (c.color !== undefined && !normalizeColor(c.color)) throw new CalendarError('Color must be #rrggbb', 400);
    }
    let newlyEnabled = false;
    const updated = this.store.update(id, (a) => {
      if (patch.label !== undefined) a.label = patch.label.trim() || a.label;
      for (const c of patch.calendars ?? []) {
        const cal = a.calendars.find((x) => x.id === c.id)!;
        if (c.enabled !== undefined) {
          if (c.enabled && !cal.enabled) newlyEnabled = true;
          cal.enabled = c.enabled;
        }
        if (c.color !== undefined) {
          cal.color = normalizeColor(c.color)!;
          cal.colorLocked = true;
        }
      }
    })!;
    // Only enabled calendars are fetched, so a newly enabled one needs a sync.
    if (newlyEnabled) void this.syncAccount(id);
    this.notify();
    return toPublicAccount(updated);
  }

  async deleteAccount(id: string): Promise<void> {
    const removed = this.store.remove(id);
    if (!removed) throw new AccountNotFoundError();
    this.cache.delete(id);
    this.notify();
    if (removed.provider === 'google') {
      const token = removed.secrets.refreshToken ?? removed.secrets.accessToken;
      if (token) await revokeGoogleToken(token);
    }
  }

  /** Sync now, rediscovering the calendar list. */
  async syncNow(id: string): Promise<CalendarAccount> {
    if (!this.store.get(id)) throw new AccountNotFoundError();
    await this.syncAccount(id, true);
    return this.getAccount(id);
  }

  // ---------------------------------------------------------------- Google

  async googleStart(returnUrl: string): Promise<{ authUrl: string }> {
    if (!isValidReturnUrl(returnUrl)) throw new CalendarError('Invalid return URL', 400);
    const cfg = (await this.auth.getConfig()).google;
    if (!cfg) throw new CalendarError(GOOGLE_UNAVAILABLE, 400);
    this.pruneGoogleSessions();
    const nonce = base64url(randomBytes(16));
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    this.googleSessions.set(nonce, { verifier, returnUrl, expiresAt: this.now() + GOOGLE_SESSION_TTL_MS });
    return { authUrl: buildGoogleAuthUrl(cfg, encodeState(nonce, returnUrl), challenge) };
  }

  private pruneGoogleSessions(): void {
    const now = this.now();
    for (const [k, s] of this.googleSessions) if (s.expiresAt <= now) this.googleSessions.delete(k);
    while (this.googleSessions.size >= 50) {
      const oldest = this.googleSessions.keys().next().value;
      if (oldest === undefined) break;
      this.googleSessions.delete(oldest);
    }
  }

  async googleComplete(code: string, state: string): Promise<{ account: CalendarAccount; created: boolean }> {
    const decoded = decodeState(state);
    const session = decoded ? this.googleSessions.get(decoded.n) : undefined;
    if (!decoded || !session || session.expiresAt <= this.now() || session.returnUrl !== decoded.r) {
      throw new CalendarError('This sign-in has expired. Start again from the app.', 400);
    }
    this.googleSessions.delete(decoded.n); // single use

    // The sign-in service adds the client ID/secret and its fixed redirect URI.
    const tokens = await this.auth.exchangeGoogleCode(code, session.verifier);
    let email: string | null;
    let calendars: DiscoveredCalendar[];
    try {
      email = await fetchGoogleEmail(tokens.accessToken);
      calendars = await listGoogleCalendars(tokens.accessToken);
    } catch (error) {
      console.warn('[calendar] Google account lookup failed:', error instanceof Error ? error.message : error);
      throw new CalendarError(
        error instanceof CalendarError ? error.message : "Couldn't read your Google calendars. Please try again.",
        502,
      );
    }
    return this.upsertOAuthAccount('google', 'Google', email, tokens, calendars);
  }

  private upsertOAuthAccount(
    provider: 'google' | 'microsoft',
    defaultLabel: string,
    email: string | null,
    tokens: TokenSet,
    calendars: DiscoveredCalendar[],
  ): { account: CalendarAccount; created: boolean } {
    const now = this.now();
    const expiresAt = now + tokens.expiresIn * 1000;
    const existing = email
      ? this.store.list().find((a) => a.provider === provider && a.email?.toLowerCase() === email.toLowerCase())
      : undefined;
    let id: string;
    if (existing) {
      id = existing.id;
      this.store.update(id, (a) => {
        a.secrets = {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? a.secrets.refreshToken,
          expiresAt,
        };
        a.calendars = mergeCalendars(a.calendars, calendars, this.paletteStart(a.id));
        a.discoveredAt = now;
        a.status = 'ok';
        a.error = null;
      });
    } else {
      id = randomUUID();
      this.store.add({
        id,
        provider,
        label: defaultLabel,
        email,
        status: 'ok',
        error: null,
        lastSyncAt: null,
        createdAt: new Date(now).toISOString(),
        calendars: mergeCalendars([], calendars, this.paletteStart(id)),
        secrets: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt },
        discoveredAt: now,
      });
    }
    this.cache.delete(id);
    this.notify();
    void this.syncAccount(id);
    return { account: this.getAccount(id), created: !existing };
  }

  /** Palette offset so colorless calendars in different accounts get different colors. */
  private paletteStart(excludeId: string): number {
    return this.store
      .list()
      .filter((a) => a.id !== excludeId)
      .reduce((n, a) => n + a.calendars.length, 0);
  }

  // ---------------------------------------------------------------- Microsoft

  async microsoftStart(): Promise<{ sessionId: string; userCode: string; verificationUri: string; expiresAt: string }> {
    const cfg = (await this.auth.getConfig()).microsoft;
    if (!cfg) throw new CalendarError(MICROSOFT_UNAVAILABLE, 400);
    this.pruneMicrosoftSessions();
    const start = await startDeviceCode(cfg);
    const session: MicrosoftSession = {
      id: randomUUID(),
      cfg,
      deviceCode: start.deviceCode,
      expiresAt: this.now() + start.expiresIn * 1000,
      interval: Math.max(1, start.interval),
      status: 'pending',
      accountId: null,
      error: null,
      finishedAt: null,
    };
    this.msSessions.set(session.id, session);
    void this.pollMicrosoft(session);
    return {
      sessionId: session.id,
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  microsoftStatus(sessionId: string): MicrosoftSessionStatus {
    const s = this.msSessions.get(sessionId);
    if (!s) throw new CalendarError('Sign-in session not found. Start again from the app.', 404);
    if (s.status === 'pending' && this.now() >= s.expiresAt) this.finishMicrosoft(s, 'expired', 'The code expired. Start again.');
    const account = s.accountId && this.store.get(s.accountId) ? this.getAccount(s.accountId) : null;
    return { status: s.status, account, error: s.error };
  }

  private finishMicrosoft(s: MicrosoftSession, status: MicrosoftSession['status'], error: string | null): void {
    s.status = status;
    s.error = error;
    s.finishedAt = this.now();
  }

  private pruneMicrosoftSessions(): void {
    const now = this.now();
    for (const [k, s] of this.msSessions) {
      if ((s.finishedAt && now - s.finishedAt > MS_SESSION_KEEP_MS) || now - s.expiresAt > MS_SESSION_KEEP_MS) {
        this.msSessions.delete(k);
      }
    }
  }

  /** Background device-code polling honoring interval / slow_down / expiry. */
  async pollMicrosoft(s: MicrosoftSession): Promise<void> {
    let networkErrors = 0;
    while (s.status === 'pending' && !this.stopped) {
      await this.sleep(s.interval * 1000);
      if (s.status !== 'pending' || this.stopped) return;
      if (this.now() >= s.expiresAt) {
        this.finishMicrosoft(s, 'expired', 'The code expired. Start again.');
        return;
      }
      let result;
      try {
        result = await pollDeviceToken(s.cfg, s.deviceCode);
        networkErrors = 0;
      } catch (error) {
        if (++networkErrors >= 5) {
          this.finishMicrosoft(s, 'error', error instanceof Error ? error.message : 'Microsoft sign-in failed');
          return;
        }
        continue;
      }
      switch (result.kind) {
        case 'pending':
          break;
        case 'slow_down':
          s.interval += 5;
          break;
        case 'expired':
          this.finishMicrosoft(s, 'expired', 'The code expired. Start again.');
          return;
        case 'denied':
          this.finishMicrosoft(s, 'denied', 'Sign-in was declined.');
          return;
        case 'error':
          this.finishMicrosoft(s, 'error', result.message);
          return;
        case 'token':
          try {
            const email = await fetchMicrosoftEmail(result.tokens.accessToken);
            const calendars = await listMicrosoftCalendars(result.tokens.accessToken);
            const { account } = this.upsertOAuthAccount('microsoft', 'Outlook', email, result.tokens, calendars);
            s.accountId = account.id;
            this.finishMicrosoft(s, 'complete', null);
          } catch (error) {
            this.finishMicrosoft(
              s,
              'error',
              error instanceof CalendarError ? error.message : "Couldn't read your Outlook calendars. Please try again.",
            );
          }
          return;
      }
    }
  }

  // ---------------------------------------------------------------- CalDAV + ICS

  async addCalDav(input: {
    provider: 'icloud' | 'caldav';
    serverUrl?: string;
    username: string;
    password: string;
    label?: string;
  }): Promise<{ account: CalendarAccount; created: boolean }> {
    const serverUrl = caldavServerUrl(input.provider, input.serverUrl);
    const username = input.username.trim();
    const client = new CalDavClient({ provider: input.provider, serverUrl, username, password: input.password });
    let calendars: DiscoveredCalendar[];
    try {
      calendars = await client.discover();
    } catch (error) {
      if (error instanceof CalendarAuthError) throw new CalendarError(error.message, 400);
      throw error;
    }
    const now = this.now();
    const existing = this.store
      .list()
      .find(
        (a) =>
          a.provider === input.provider &&
          a.secrets.serverUrl === serverUrl &&
          a.secrets.username?.toLowerCase() === username.toLowerCase(),
      );
    let id: string;
    if (existing) {
      id = existing.id;
      this.store.update(id, (a) => {
        a.secrets = { ...a.secrets, username, password: input.password, serverUrl };
        a.calendars = mergeCalendars(a.calendars, calendars, this.paletteStart(id));
        a.discoveredAt = now;
        a.status = 'ok';
        a.error = null;
        if (input.label?.trim()) a.label = input.label.trim();
      });
    } else {
      id = randomUUID();
      this.store.add({
        id,
        provider: input.provider,
        label: input.label?.trim() || (input.provider === 'icloud' ? 'iCloud' : new URL(serverUrl).hostname),
        email: username,
        status: 'ok',
        error: null,
        lastSyncAt: null,
        createdAt: new Date(now).toISOString(),
        calendars: mergeCalendars([], calendars, this.paletteStart(id)),
        secrets: { username, password: input.password, serverUrl },
        discoveredAt: now,
      });
    }
    this.cache.delete(id);
    this.notify();
    void this.syncAccount(id);
    return { account: this.getAccount(id), created: !existing };
  }

  private async fetchIcsText(url: string): Promise<string> {
    try {
      return await safeFetchText(url, {
        timeoutMs: 15_000,
        maxBytes: 10 * 1024 * 1024,
        maxRedirects: 5,
        headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5' },
        resolve: this.resolveHost,
      });
    } catch (error) {
      if (error instanceof UnsafeUrlError) {
        throw new CalendarError(
          error.message === 'Invalid URL' ? "That isn't a valid link" : `That link can't be used: ${error.message.toLowerCase()}`,
          400,
        );
      }
      if (error instanceof UpstreamError) {
        throw new CalendarError(`Couldn't download the calendar (${error.message.replace(/^Upstream /, '').toLowerCase()})`, 400);
      }
      throw new CalendarError("Couldn't download the calendar", 400);
    }
  }

  async addIcs(input: { url: string; label?: string }): Promise<CalendarAccount> {
    const url = normalizeIcsUrl(input.url);
    const text = await this.fetchIcsText(url);
    const settings = this.getSettings();
    let parsed;
    try {
      parsed = parseIcs(text, this.syncWindow(), settings.timezone);
    } catch (error) {
      if (error instanceof IcsParseError) throw new CalendarError("That link didn't return a calendar", 400);
      throw error;
    }
    const now = this.now();
    const id = randomUUID();
    const name = input.label?.trim() || parsed.name || 'Calendar';
    this.store.add({
      id,
      provider: 'ics',
      label: name,
      email: null,
      status: 'ok',
      error: null,
      lastSyncAt: new Date(now).toISOString(),
      createdAt: new Date(now).toISOString(),
      calendars: [
        {
          id: ICS_CALENDAR_ID,
          name: parsed.name || name,
          color: normalizeColor(parsed.color) ?? paletteColor(this.paletteStart(id)),
          enabled: true,
          primary: true,
        },
      ],
      secrets: { icsUrl: url },
      discoveredAt: now,
    });
    const events = parsed.events.map((e) => ({ ...e, calendarId: ICS_CALENDAR_ID }));
    this.cache.set(id, { events, signature: signatureOf(events), syncedAt: now });
    this.notify();
    return this.getAccount(id);
  }

  // ---------------------------------------------------------------- sync engine

  /** The window cached per account: covers any GET /api/schedule?days=1..30. */
  syncWindow(): TimeWindow {
    const now = this.now();
    return { start: startOfToday(this.getSettings().timezone, now) - DAY_MS, end: now + 32 * DAY_MS };
  }

  async syncAll(): Promise<void> {
    this.reschedule();
    await Promise.allSettled(this.store.list().map((a) => this.syncAccount(a.id)));
  }

  /** Sync one account (deduplicated while in flight). */
  syncAccount(id: string, rediscover = false): Promise<void> {
    const running = this.inflight.get(id);
    if (running) return rediscover ? running.then(() => this.syncAccount(id, true)) : running;
    const p = this.doSync(id, rediscover).finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  private async doSync(id: string, rediscover: boolean): Promise<void> {
    const before = this.store.get(id);
    if (!before) return;
    const prevStatus = before.status;
    const prevError = before.error;
    const prev = this.cache.get(id);
    const window = this.syncWindow();
    let changed = false;

    try {
      const adapter = this.adapter(id, before.provider);
      if (rediscover || !before.discoveredAt || this.now() - before.discoveredAt > DISCOVERY_INTERVAL_MS || before.calendars.length === 0) {
        const discovered = await adapter.discover();
        this.store.update(id, (a) => {
          a.calendars = mergeCalendars(a.calendars, discovered, this.paletteStart(id));
          a.discoveredAt = this.now();
        });
      }
      const account = this.store.get(id);
      if (!account) return;

      const events: CachedEvent[] = [];
      const failures: string[] = [];
      for (const cal of account.calendars.filter((c) => c.enabled)) {
        try {
          const raw = await adapter.fetchEvents(cal, window);
          for (const e of raw) events.push({ ...e, calendarId: cal.id });
        } catch (error) {
          if (error instanceof CalendarAuthError) throw error;
          failures.push(`${cal.name}: ${error instanceof Error ? error.message : 'sync failed'}`);
          // keep serving what we had for this calendar
          for (const e of prev?.events ?? []) if (e.calendarId === cal.id) events.push(e);
        }
      }
      if (!this.store.get(id)) return; // deleted while syncing
      const signature = signatureOf(events);
      changed = signature !== prev?.signature;
      this.cache.set(id, { events, signature, syncedAt: this.now() });
      this.store.update(id, (a) => {
        a.lastSyncAt = new Date(this.now()).toISOString();
        a.status = failures.length ? 'error' : 'ok';
        a.error = failures.length ? failures.join('; ') : null;
      });
    } catch (error) {
      const reauth = error instanceof CalendarAuthError;
      const message =
        error instanceof CalendarError || error instanceof CalendarAuthError ? error.message : 'Sync failed';
      if (!(error instanceof CalendarError) && !reauth) console.error(`[calendar] sync ${id} failed:`, error);
      if (!this.store.get(id)) return;
      this.store.update(id, (a) => {
        a.status = reauth ? 'reauth' : 'error';
        a.error = message;
      });
      if (!prev) this.cache.set(id, { events: [], signature: signatureOf([]), syncedAt: this.now() });
    }
    const after = this.store.get(id);
    if (changed || (after && (after.status !== prevStatus || after.error !== prevError))) this.notify();
  }

  private adapter(id: string, provider: CalendarProviderId): Adapter {
    const tz = () => this.getSettings().timezone;
    const account = () => {
      const a = this.store.get(id);
      if (!a) throw new AccountNotFoundError();
      return a;
    };
    switch (provider) {
      case 'google':
        return {
          discover: () => this.withToken(id, (t) => listGoogleCalendars(t)),
          fetchEvents: (cal, w) => this.withToken(id, (t) => fetchGoogleEvents(t, cal.id, w, tz())),
        };
      case 'microsoft':
        return {
          discover: () => this.withToken(id, (t) => listMicrosoftCalendars(t)),
          fetchEvents: (cal, w) => this.withToken(id, (t) => fetchMicrosoftEvents(t, cal.id, w, tz())),
        };
      case 'icloud':
      case 'caldav': {
        const client = () => {
          const a = account();
          return new CalDavClient({
            provider,
            serverUrl: a.secrets.serverUrl ?? caldavServerUrl(provider, undefined),
            username: a.secrets.username ?? '',
            password: a.secrets.password ?? '',
          });
        };
        return {
          discover: () => client().discover(),
          fetchEvents: (cal, w) => {
            if (!cal.url) throw new CalendarError('Calendar address missing; sync again');
            return client().fetchEvents(cal.url, w, tz());
          },
        };
      }
      case 'ics':
        return {
          discover: async () => {
            const cal = account().calendars[0];
            return [{ id: ICS_CALENDAR_ID, name: cal?.name ?? 'Calendar', color: null, primary: true, system: false }];
          },
          fetchEvents: async (_cal, w) => {
            const url = account().secrets.icsUrl;
            if (!url) throw new CalendarError('Calendar link missing');
            const text = await this.fetchIcsText(url);
            try {
              return parseIcs(text, w, tz()).events;
            } catch (error) {
              if (error instanceof IcsParseError) throw new CalendarError("The calendar link didn't return a calendar");
              throw error;
            }
          },
        };
    }
  }

  /** Run `fn` with a fresh access token; refresh on expiry or a 401, then give up with reauth. */
  private async withToken<T>(id: string, fn: (token: string) => Promise<T>): Promise<T> {
    const a = this.store.get(id);
    if (!a) throw new AccountNotFoundError();
    let token = a.secrets.accessToken;
    if (!token || !a.secrets.expiresAt || a.secrets.expiresAt - 60_000 < this.now()) {
      token = await this.refreshToken(id);
    }
    try {
      return await fn(token);
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
    }
    token = await this.refreshToken(id);
    try {
      return await fn(token);
    } catch (error) {
      if (error instanceof UnauthorizedError) throw new CalendarAuthError();
      throw error;
    }
  }

  private async refreshToken(id: string): Promise<string> {
    const a = this.store.get(id);
    if (!a) throw new AccountNotFoundError();
    const refresh = a.secrets.refreshToken;
    if (!refresh) throw new CalendarAuthError();
    let tokens;
    if (a.provider === 'google') {
      tokens = await this.auth.refreshGoogleToken(refresh);
    } else if (a.provider === 'microsoft') {
      // Microsoft refresh talks to Microsoft directly; a briefly unreachable
      // sign-in service shouldn't stop it, so the last good config is fine.
      const cfg = (await this.auth.getConfig({ allowStale: true })).microsoft;
      if (!cfg) throw new CalendarError(MICROSOFT_UNAVAILABLE);
      tokens = await refreshMicrosoftToken(cfg, refresh);
    } else {
      throw new CalendarAuthError();
    }
    this.store.update(id, (acc) => {
      acc.secrets.accessToken = tokens.accessToken;
      acc.secrets.expiresAt = this.now() + tokens.expiresIn * 1000;
      if (tokens.refreshToken) acc.secrets.refreshToken = tokens.refreshToken;
    });
    return tokens.accessToken;
  }

  // ---------------------------------------------------------------- events

  /**
   * Events from enabled calendars overlapping `window`. Accounts without a
   * cache yet are synced first, but never for longer than `waitMs`.
   */
  async getEvents(
    window: TimeWindow,
    waitMs = 5000,
  ): Promise<{ events: ScheduleEvent[]; accounts: ScheduleAccountSummary[]; updatedAt: string }> {
    const all = this.store.list();
    const missing = all.filter((a) => !this.cache.has(a.id));
    if (missing.length > 0) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.allSettled(missing.map((a) => this.syncAccount(a.id))),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, waitMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
    }
    // Stale caches (e.g. the timer was delayed) refresh in the background.
    const staleMs = 2 * this.getSettings().refreshMinutes * 60_000;
    for (const a of all) {
      const c = this.cache.get(a.id);
      if (c && this.now() - c.syncedAt > staleMs) void this.syncAccount(a.id);
    }

    const accounts = this.store.list();
    const events: ScheduleEvent[] = [];
    for (const a of accounts) {
      const cached = this.cache.get(a.id);
      if (!cached) continue;
      const cals = new Map(a.calendars.filter((c) => c.enabled).map((c) => [c.id, c]));
      for (const e of cached.events) {
        const cal = cals.get(e.calendarId);
        if (!cal || !overlaps(e.start, e.end, window)) continue;
        events.push(toScheduleEvent(a, cal, e));
      }
    }
    events.sort(compareScheduleEvents);
    return {
      events,
      accounts: accounts.map((a) => ({ id: a.id, label: a.label, provider: a.provider, status: a.status })),
      updatedAt: this.updatedAt(),
    };
  }
}

function toScheduleEvent(a: StoredAccount, cal: StoredCalendar, e: CachedEvent): ScheduleEvent {
  return {
    id: `${a.id}:${shortHash(`${cal.id}|${e.key}`)}`,
    source: a.provider,
    accountId: a.id,
    calendarId: cal.id,
    calendarName: cal.name,
    color: cal.color,
    title: e.title,
    location: e.location,
    startTime: new Date(e.start).toISOString(),
    endTime: new Date(e.end).toISOString(),
    allDay: e.allDay,
    startDate: e.allDay ? e.startDate : null,
    endDate: e.allDay ? e.endDate : null,
    isFlightDuty: false,
  };
}
