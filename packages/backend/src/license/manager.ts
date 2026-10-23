/**
 * License manager: the mirror side of docs/LICENSING.md.
 *
 * - Key sources, in order: the key stored in the DB (entered from the app),
 *   then the pre-flashed key file (/boot/firmware/skyglass-license.txt).
 * - `activate` is called only for a newly entered key or a key file picked up
 *   for the first time. Periodic checks only call `refresh`, which never
 *   binds, so a license released on the website does not re-bind here.
 * - Every 200 response's token is verified (signature, fingerprint, exp)
 *   before it is trusted. A network error never downgrades a valid token;
 *   once the token's exp passes, the state becomes `expired` and refresh is
 *   retried hourly until it succeeds.
 * - A stored token signed for a different fingerprint (SD card or DB moved
 *   to another Pi) is not "expired": the stored key is activated once on
 *   this device, which binds a released (pending) license or reports
 *   bound_elsewhere accurately.
 * - A key file pickup is recorded outside data/ (keyFileMarkerPath), so
 *   losing the DB does not silently re-activate the card's key.
 * - Retry scheduling uses a monotonic clock; token expiry uses wall time.
 */

import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { performance } from 'perf_hooks';
import type { DeviceFingerprint } from './fingerprint.js';
import { normalizeLicenseKey, keyLast4 } from './key.js';
import { decodeTokenPayload, verifyToken, type TokenPayload } from './token.js';

export type LicenseState =
  | 'disabled'
  | 'unlicensed'
  | 'active'
  | 'expired'
  | 'released'
  | 'revoked'
  | 'bound_elsewhere';

type StoredState = Exclude<LicenseState, 'disabled'>;
const STORED_STATES: readonly StoredState[] = [
  'unlicensed',
  'active',
  'expired',
  'released',
  'revoked',
  'bound_elsewhere',
];

/** GET /api/license/status and the WS `license` event payload. */
export interface LicenseStatus {
  enabled: boolean;
  state: LicenseState;
  keyLast4?: string;
  activatedAt?: string;
  expiresAt?: string;
  lastCheckedAt?: string;
  message?: string;
  /**
   * A pre-installed key file (kits) is waiting to be activated: the mirror
   * retries on its own, so the phone should show a waiting state rather than
   * ask for a key.
   */
  keyFilePending: boolean;
  supportEmail: string;
  manageUrl: string;
}

export type LicenseErrorCode =
  | 'invalid_key'
  | 'not_found'
  | 'bound_to_another_device'
  | 'revoked'
  | 'rate_limited'
  | 'network_error'
  | 'server_error'
  | 'disabled';

export type SubmitKeyResult =
  | { ok: true; status: LicenseStatus }
  | {
      ok: false;
      code: LicenseErrorCode;
      message: string;
      httpStatus: number;
      status: LicenseStatus;
    };

/** Persisted row (db/index.ts license_state). */
export interface LicenseRecord {
  license_key: string | null;
  token: string | null;
  state: string;
  activated_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
}

export interface LicenseStore {
  load(): LicenseRecord | null;
  save(record: LicenseRecord): void;
}

export interface LicenseManagerDeps {
  store: LicenseStore;
  config: () => { enabled: boolean; server: string };
  fingerprint: () => DeviceFingerprint;
  fetch?: typeof fetch;
  /** Wall clock (ms) for token exp and timestamps. */
  now?: () => number;
  /** Monotonic clock (ms) for retry scheduling; defaults to performance.now. */
  monotonic?: () => number;
  mirrorId?: () => string | undefined;
  appVersion?: () => string | undefined;
  /** Pre-flashed key file; defaults to SKYGLASS_LICENSE_FILE or /boot/firmware/skyglass-license.txt. */
  keyFilePath?: () => string;
  /**
   * Records that the key file was picked up (sha256 of the key); defaults to
   * SKYGLASS_LICENSE_KEYFILE_MARKER or ~/.skyglass/license-keyfile-used.
   */
  keyFileMarkerPath?: () => string;
}

export const SUPPORT_EMAIL = 'support@skyglass.dev';
export const DEFAULT_KEY_FILE = '/boot/firmware/skyglass-license.txt';

const HOUR = 60 * 60 * 1000;
export const REFRESH_INTERVAL_MS = 24 * HOUR;
export const RETRY_INTERVAL_MS = HOUR;
export const KEY_FILE_RETRY_MS = 5 * 60 * 1000;
/** Right after boot the network is often not up yet: retry the key file (or a re-bind) every 30 s for 10 min. */
export const KEY_FILE_FAST_RETRY_MS = 30_000;
export const KEY_FILE_FAST_WINDOW_MS = 10 * 60 * 1000;
const TICK_MS = 5 * 60 * 1000;
const FAST_TICK_MS = KEY_FILE_FAST_RETRY_MS;
const REQUEST_TIMEOUT_MS = 10_000;

const MESSAGES: Record<LicenseState, string | undefined> = {
  disabled: undefined,
  unlicensed: 'Enter your license key in the SkyGlass app.',
  active: undefined,
  expired: 'Reconnect to verify. This mirror has not reached the license server in over 30 days.',
  released:
    'This license was released from this mirror. Enter a license key in the SkyGlass app to continue.',
  revoked: `This license has been revoked. Contact ${SUPPORT_EMAIL} for help.`,
  bound_elsewhere:
    'This license is active on another mirror. Release it at skyglass.dev/license, then enter the key again.',
};
const KEY_FILE_ACTIVATING = 'Activating the pre-installed license…';
const KEY_FILE_OFFLINE =
  'Connect the mirror to the internet to activate the pre-installed license.';
const KEY_FILE_USED =
  'The pre-installed license was already used on this mirror. Enter your license key in the SkyGlass app.';
const REBIND_CHECKING = 'Checking the license for this mirror…';

const ACTIVATE_REJECTIONS = [
  'not_found',
  'bound_to_another_device',
  'revoked',
  'rate_limited',
] as const;
const REFRESH_REJECTIONS = ['not_found', 'released', 'revoked'] as const;

type CallResult =
  | { kind: 'ok'; token: string; payload: TokenPayload; activatedAt?: string }
  | { kind: 'rejected'; code: string; message?: string }
  | { kind: 'error'; network: boolean; message: string };

const EMPTY: LicenseRecord = {
  license_key: null,
  token: null,
  state: 'unlicensed',
  activated_at: null,
  last_checked_at: null,
  last_error: null,
};

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export class LicenseManager {
  private rec: LicenseRecord = { ...EMPTY };
  private loaded = false;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private chain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(status: LicenseStatus) => void>();
  private lastEmitted = '';
  /** In-memory: when (monotonic ms) the last background network call ran and whether it failed. */
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private lastAttemptFailed = false;
  /** Monotonic start of this boot's fast-retry window (reset by start()). */
  private startedAt: number;
  /** Key file was unreadable/invalid this boot; don't keep re-reading it. */
  private keyFileInvalid = false;
  /** A valid, not yet used key file is waiting for activation. */
  private keyFilePending = false;
  /** The key file matches the pickup marker: it was already used on this mirror. */
  private keyFileUsed = false;
  /** The stored token was issued to another fingerprint: activate the stored key here. */
  private needsRebind = false;

  constructor(private readonly deps: LicenseManagerDeps) {
    this.startedAt = this.mono();
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private mono(): number {
    return this.deps.monotonic ? this.deps.monotonic() : performance.now();
  }

  private inFastWindow(): boolean {
    return this.mono() - this.startedAt < KEY_FILE_FAST_WINDOW_MS;
  }

  private enabled(): boolean {
    return this.deps.config().enabled;
  }

  private keyFilePath(): string {
    return this.deps.keyFilePath?.() ?? process.env.SKYGLASS_LICENSE_FILE ?? DEFAULT_KEY_FILE;
  }

  private keyFileMarkerPath(): string {
    return (
      this.deps.keyFileMarkerPath?.() ??
      process.env.SKYGLASS_LICENSE_KEYFILE_MARKER ??
      join(homedir(), '.skyglass', 'license-keyfile-used')
    );
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Load persisted state and start background checks. Never waits on the network. */
  start(): void {
    this.ensureLoaded();
    if (!this.enabled()) return;
    this.startedAt = this.mono();
    this.running = true;
    void this.safeTick().finally(() => this.schedule());
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Every 30 s during the first 10 min after start (key file / re-bind), then every 5 min. */
  private schedule(): void {
    if (!this.running) return;
    const delay = this.inFastWindow() ? FAST_TICK_MS : TICK_MS;
    this.timer = setTimeout(() => {
      void this.safeTick().finally(() => this.schedule());
    }, delay);
    this.timer.unref?.();
  }

  /** A background tick must never reject: there is no one to handle it. */
  private async safeTick(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      console.error('[License] Background check failed:', error);
    }
  }

  onChange(listener: (status: LicenseStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    let stored: LicenseRecord | null = null;
    try {
      stored = this.deps.store.load();
    } catch (error) {
      console.error('[License] Could not load the stored license state:', error);
    }
    if (stored) {
      this.rec = {
        ...stored,
        state: STORED_STATES.includes(stored.state as StoredState) ? stored.state : 'unlicensed',
      };
    }
    // Re-derive active/expired from the token itself rather than trusting the
    // stored label (clock moved on, key rotated). A token issued to another
    // fingerprint (card or DB moved to another Pi) is not "expired": keep the
    // key and activate it here once (tick/refreshNow). The foreign token is
    // kept until that answer so a restart in between re-detects the move.
    const state = this.rec.state;
    if (this.rec.token && (state === 'active' || state === 'expired' || state === 'unlicensed')) {
      const check = verifyToken(this.rec.token, this.deps.fingerprint().value, this.now());
      if (!check.ok && check.reason === 'wrong_device' && this.rec.license_key) {
        console.warn(
          '[License] Stored token belongs to another device; activating the stored key here'
        );
        this.needsRebind = true;
        if (state !== 'unlicensed') this.persist({ ...this.rec, state: 'unlicensed' });
      } else if (state === 'active' || state === 'expired') {
        const next = check.ok ? 'active' : 'expired';
        if (next !== state) this.persist({ ...this.rec, state: next });
      }
    }
    if (!this.rec.license_key) this.probeKeyFile();
    this.lastEmitted = JSON.stringify(this.buildStatus());
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  getStatus(): LicenseStatus {
    this.ensureLoaded();
    this.checkExpiry();
    return this.buildStatus();
  }

  /**
   * True once a license has been activated on this mirror (setup's license
   * step). Stays true when it later lapses, so the mirror shows the license
   * screen rather than the setup wizard. Always true when disabled.
   */
  isActivated(): boolean {
    this.ensureLoaded();
    if (!this.enabled()) return true;
    return Boolean(this.rec.license_key && this.rec.activated_at);
  }

  /** POST /api/license/key: normalize and activate a key entered in the app. */
  submitKey(input: unknown): Promise<SubmitKeyResult> {
    return this.exclusive(async () => {
      this.ensureLoaded();
      if (!this.enabled()) {
        return this.fail('disabled', 'Licensing is disabled on this mirror.', 409);
      }
      const key = normalizeLicenseKey(input);
      if (!key) {
        return this.fail(
          'invalid_key',
          'That is not a valid license key (format XXXX-XXXX-XXXX-XXXX).',
          400
        );
      }

      const result = await this.call('activate', key, ACTIVATE_REJECTIONS);
      if (result.kind === 'ok') {
        this.acceptToken(key, result);
        return { ok: true, status: this.buildStatus() };
      }
      if (result.kind === 'error') {
        console.warn(`[License] Activation failed: ${result.message}`);
        return result.network
          ? this.fail(
              'network_error',
              'Could not reach the license server. Check the mirror’s internet connection and try again.',
              503
            )
          : this.fail(
              'server_error',
              'The license server returned an unexpected response. Try again later.',
              502
            );
      }

      const code = result.code as (typeof ACTIVATE_REJECTIONS)[number];
      if (code === 'rate_limited') {
        return this.fail(
          code,
          result.message || 'Too many activation attempts. Try again in an hour.',
          429
        );
      }
      const httpStatus = code === 'not_found' ? 404 : code === 'revoked' ? 403 : 409;
      const message =
        result.message ||
        (code === 'not_found'
          ? 'License key not found. Check the key and try again.'
          : code === 'revoked'
            ? MESSAGES.revoked!
            : MESSAGES.bound_elsewhere!);
      // Never replace a license that is working here, or one that was ever
      // activated here (released/revoked: activated_at is the "ever
      // activated" marker that keeps the mirror out of the setup wizard),
      // with a rejected key, and don't persist a mistyped key at all.
      const hasWorkingLicense = this.rec.state === 'active' || this.rec.state === 'expired';
      const everActivated = Boolean(this.rec.license_key && this.rec.activated_at);
      if (!hasWorkingLicense && !everActivated && code !== 'not_found') {
        this.persist({
          license_key: key,
          token: null,
          state: code === 'revoked' ? 'revoked' : 'bound_elsewhere',
          activated_at: null,
          last_checked_at: iso(this.now()),
          last_error: message,
        });
      }
      return this.fail(code, message, httpStatus);
    });
  }

  /** POST /api/license/refresh: check now (refresh only; activates only an unused key file). */
  refreshNow(): Promise<LicenseStatus> {
    return this.exclusive(async () => {
      this.ensureLoaded();
      if (!this.enabled()) return this.buildStatus();
      if (this.needsRebind) await this.doRebind();
      else if (!this.rec.license_key) await this.tryKeyFile(true);
      // A refresh can't help a key that was never bound here (it would only
      // answer `released`); those need a key entered from the app.
      else if (this.rec.state !== 'bound_elsewhere' && this.rec.state !== 'unlicensed')
        await this.doRefresh();
      return this.getStatus();
    });
  }

  /** One background step: expiry check plus any refresh/key-file attempt that is due. */
  tick(): Promise<void> {
    return this.exclusive(async () => {
      this.ensureLoaded();
      if (!this.enabled()) return;
      this.checkExpiry();
      const since = this.mono() - this.lastAttemptAt;
      const state = this.rec.state;
      const activateRetryMs = this.inFastWindow() ? KEY_FILE_FAST_RETRY_MS : KEY_FILE_RETRY_MS;

      if (this.needsRebind) {
        if (since >= activateRetryMs) await this.doRebind();
        return;
      }
      if (!this.rec.license_key) {
        if (since >= activateRetryMs) await this.tryKeyFile(false);
        return;
      }
      if (state === 'active') {
        if (since >= (this.lastAttemptFailed ? RETRY_INTERVAL_MS : REFRESH_INTERVAL_MS))
          await this.doRefresh();
      } else if (state === 'expired') {
        if (since >= RETRY_INTERVAL_MS) await this.doRefresh();
      }
      // released / revoked / bound_elsewhere / unlicensed-with-key: nothing to
      // poll; a new key from the app (activate) or a manual refresh moves on.
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private fail(code: LicenseErrorCode, message: string, httpStatus: number): SubmitKeyResult {
    return { ok: false, code, message, httpStatus, status: this.getStatus() };
  }

  private persist(next: LicenseRecord): void {
    this.rec = next;
    try {
      this.deps.store.save(next);
    } catch (error) {
      // Keep the in-memory state (it is what the mirror shows) and try again
      // on the next change; a DB error must not take the backend down.
      console.error('[License] Could not save the license state:', error);
    }
    this.emitIfChanged();
  }

  private emitIfChanged(): void {
    const status = this.buildStatus();
    const json = JSON.stringify(status);
    if (json === this.lastEmitted) return;
    this.lastEmitted = json;
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (error) {
        console.error('[License] Listener failed:', error);
      }
    }
  }

  /** active → expired once the token's exp passes (offline > 30 days). */
  private checkExpiry(): void {
    if (this.rec.state !== 'active') return;
    const exp = decodeTokenPayload(this.rec.token)?.exp;
    if (exp === undefined || this.now() >= exp * 1000) {
      console.warn('[License] Token expired; reconnect to verify');
      this.persist({ ...this.rec, state: 'expired' });
    }
  }

  private acceptToken(key: string, result: Extract<CallResult, { kind: 'ok' }>): void {
    const sameKey = this.rec.license_key === key;
    this.needsRebind = false;
    this.keyFilePending = false;
    this.persist({
      license_key: key,
      token: result.token,
      state: 'active',
      activated_at:
        result.activatedAt ??
        (sameKey ? this.rec.activated_at : null) ??
        iso(result.payload.iat * 1000),
      last_checked_at: iso(this.now()),
      last_error: null,
    });
  }

  private async doRefresh(): Promise<void> {
    const key = this.rec.license_key;
    if (!key) return;
    this.lastAttemptAt = this.mono();
    const result = await this.call('refresh', key, REFRESH_REJECTIONS);
    this.lastAttemptFailed = result.kind === 'error';

    if (result.kind === 'ok') {
      this.acceptToken(key, result);
      return;
    }
    if (result.kind === 'error') {
      // Network/server trouble never downgrades a valid token.
      console.warn(`[License] Refresh failed: ${result.message}`);
      this.persist({ ...this.rec, last_error: result.message });
      this.checkExpiry();
      return;
    }
    const state: StoredState =
      result.code === 'released'
        ? 'released'
        : result.code === 'revoked'
          ? 'revoked'
          : 'unlicensed';
    console.warn(`[License] Refresh rejected: ${result.code}`);
    this.persist({
      ...this.rec,
      token: null,
      state,
      last_checked_at: iso(this.now()),
      last_error:
        result.code === 'not_found'
          ? 'This license key is no longer valid. Enter your current key in the SkyGlass app.'
          : (result.message ?? null),
    });
  }

  /**
   * The stored token was issued to another fingerprint: activate the stored
   * key on this device (never refresh, which can only answer `released`).
   * Retried on network errors until the server answers.
   */
  private async doRebind(): Promise<void> {
    const key = this.rec.license_key;
    if (!key) {
      this.needsRebind = false;
      return;
    }
    this.lastAttemptAt = this.mono();
    const result = await this.call('activate', key, ACTIVATE_REJECTIONS);
    this.lastAttemptFailed = result.kind === 'error';
    if (result.kind === 'ok') {
      this.acceptToken(key, result);
      return;
    }
    if (result.kind === 'error' || result.code === 'rate_limited') {
      console.warn(
        `[License] Re-activation on this device deferred: ${result.kind === 'error' ? result.message : 'rate limited'}`
      );
      this.emitIfChanged();
      return;
    }
    this.needsRebind = false;
    console.warn(`[License] Re-activation on this device rejected: ${result.code}`);
    this.persist({
      ...this.rec,
      token: null,
      state:
        result.code === 'bound_to_another_device'
          ? 'bound_elsewhere'
          : result.code === 'revoked'
            ? 'revoked'
            : 'unlicensed',
      last_checked_at: iso(this.now()),
      last_error:
        result.code === 'not_found'
          ? 'This license key is no longer valid. Enter your current key in the SkyGlass app.'
          : (result.message ?? null),
    });
  }

  /**
   * Read the key file (no network). Returns the key when it is valid and has
   * not been picked up on this mirror before; updates keyFilePending.
   */
  private probeKeyFile(): string | null {
    const path = this.keyFilePath();
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      this.keyFilePending = false;
      return null; // no key file: wait for the app
    }
    const key =
      normalizeLicenseKey(text.trim()) ??
      text
        .split(/\r?\n/)
        .map((line) => normalizeLicenseKey(line.trim()))
        .find((k): k is string => Boolean(k)) ??
      null;
    if (!key) {
      this.keyFilePending = false;
      if (!this.keyFileInvalid) {
        this.keyFileInvalid = true;
        console.warn(`[License] ${path} does not contain a valid license key`);
        this.persist({
          ...this.rec,
          last_error: 'The pre-installed license file does not contain a valid key.',
        });
      }
      return null;
    }
    this.keyFileInvalid = false;
    if (this.readKeyFileMarker() === sha256(key)) {
      // Picked up before and the DB lost it (or was reset): a released
      // license must not silently re-bind here. The key has to come from the app.
      if (!this.keyFileUsed)
        console.warn(
          '[License] The key file was already used on this mirror; not activating it again'
        );
      this.keyFileUsed = true;
      this.keyFilePending = false;
      return null;
    }
    this.keyFileUsed = false;
    this.keyFilePending = true;
    return key;
  }

  private readKeyFileMarker(): string | null {
    try {
      return readFileSync(this.keyFileMarkerPath(), 'utf8').trim() || null;
    } catch {
      return null;
    }
  }

  private writeKeyFileMarker(key: string): void {
    const path = this.keyFileMarkerPath();
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${sha256(key)}\n`, { mode: 0o600 });
    } catch (error) {
      console.warn(`[License] Could not record the key file pickup at ${path}:`, error);
    }
  }

  /** First-boot pickup of a pre-flashed key; retried until the server answers. */
  private async tryKeyFile(force: boolean): Promise<void> {
    if (this.rec.license_key || (this.keyFileInvalid && !force)) return;
    const key = this.probeKeyFile();
    if (!key) {
      this.emitIfChanged();
      return;
    }

    console.log('[License] Activating pre-installed license key');
    this.lastAttemptAt = this.mono();
    const result = await this.call('activate', key, ACTIVATE_REJECTIONS);
    this.lastAttemptFailed = result.kind === 'error';
    if (result.kind === 'ok') {
      this.writeKeyFileMarker(key);
      this.acceptToken(key, result);
      return;
    }
    if (result.kind === 'error' || result.code === 'rate_limited') {
      const reason = result.kind === 'error' ? result.message : 'rate limited';
      console.warn(`[License] Key file activation deferred: ${reason}`);
      this.emitIfChanged(); // message: activating… / connect to the internet
      return;
    }
    // A definitive answer: store the key so it is never activated again.
    this.writeKeyFileMarker(key);
    this.keyFilePending = false;
    const state: StoredState =
      result.code === 'bound_to_another_device'
        ? 'bound_elsewhere'
        : result.code === 'revoked'
          ? 'revoked'
          : 'unlicensed';
    this.persist({
      license_key: key,
      token: null,
      state,
      activated_at: null,
      last_checked_at: iso(this.now()),
      last_error:
        result.code === 'not_found'
          ? 'The pre-installed license key was not recognized. Enter your key in the SkyGlass app.'
          : (result.message ?? null),
    });
  }

  private async call(
    action: 'activate' | 'refresh',
    key: string,
    rejections: readonly string[]
  ): Promise<CallResult> {
    const fp = this.deps.fingerprint();
    const body: Record<string, unknown> = {
      licenseKey: key,
      deviceFingerprint: fp.value,
      appVersion: this.deps.appVersion?.(),
    };
    if (action === 'activate') {
      body.fingerprintType = fp.type;
      body.mirrorId = this.deps.mirrorId?.();
    }

    const url = `${this.deps.config().server}/api/license/${action}`;
    const doFetch = this.deps.fetch ?? fetch;
    let res: Response;
    try {
      // skyglass.dev 307-redirects to www; fetch follows it and 307 keeps the POST.
      res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        kind: 'error',
        network: true,
        message: `License server unreachable: ${(error as Error).message}`,
      };
    }

    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      // non-JSON (proxy error page etc.)
    }
    const status = typeof data?.status === 'string' ? data.status : undefined;
    const message = typeof data?.message === 'string' ? data.message : undefined;

    if (res.ok && status === 'active') {
      const check = verifyToken(data.token, fp.value, this.now());
      if (!check.ok) {
        console.error(`[License] Rejected token from ${action}: ${check.reason}`);
        return {
          kind: 'error',
          network: false,
          message: `License server returned an invalid token (${check.reason})`,
        };
      }
      return {
        kind: 'ok',
        token: data.token as string,
        payload: check.payload,
        activatedAt: typeof data.activatedAt === 'string' ? data.activatedAt : undefined,
      };
    }
    // Only a well-formed 4xx with a known status is a definitive answer; a
    // bare 404 page, a 429 or a 5xx is treated like a network error.
    if (res.status >= 400 && res.status < 500 && status && rejections.includes(status)) {
      return { kind: 'rejected', code: status, message };
    }
    return {
      kind: 'error',
      network: false,
      message: `License server ${action} failed: HTTP ${res.status}${status ? ` ${status}` : ''}`,
    };
  }

  private buildStatus(): LicenseStatus {
    const { server, enabled } = this.deps.config();
    const base = { supportEmail: SUPPORT_EMAIL, manageUrl: `${server}/license` };
    if (!enabled) return { enabled: false, state: 'disabled', keyFilePending: false, ...base };

    const state = this.rec.state as StoredState;
    // A foreign token (pending re-bind) says nothing about this mirror.
    const exp = this.needsRebind ? undefined : decodeTokenPayload(this.rec.token)?.exp;
    const keyFilePending = !this.rec.license_key && this.keyFilePending;
    let message: string | undefined;
    if (state !== 'unlicensed') message = MESSAGES[state];
    else if (this.needsRebind) message = REBIND_CHECKING;
    else if (keyFilePending) {
      // Right after boot the network is usually still coming up: only blame
      // the connection once the fast-retry window has passed.
      message =
        this.lastAttemptFailed && !this.inFastWindow() ? KEY_FILE_OFFLINE : KEY_FILE_ACTIVATING;
    } else if (!this.rec.license_key && this.keyFileUsed) message = KEY_FILE_USED;
    else message = this.rec.last_error ?? MESSAGES.unlicensed;
    return {
      enabled: true,
      state,
      keyLast4: this.rec.license_key ? keyLast4(this.rec.license_key) : undefined,
      activatedAt: this.rec.activated_at ?? undefined,
      expiresAt: exp !== undefined ? iso(exp * 1000) : undefined,
      lastCheckedAt: this.rec.last_checked_at ?? undefined,
      message,
      keyFilePending,
      ...base,
    };
  }
}
