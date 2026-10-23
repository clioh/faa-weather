/**
 * SkyGlass API Client
 * Handles communication with the mirror's backend API
 */

import { ModuleInstance, MirrorLayout } from './modules';
import { isMirrorId, locateMirror, subnetOf } from './mirrorLocator';
import { storage } from './storage';
import { pairingStore, usableMirrorId } from './pairingStore';

export type { ModuleInstance, MirrorLayout };

export interface MirrorDevice {
  /** The mirror's persistent id when known, else "host:port". */
  id: string;
  /** Persistent mirror id from /api/discovery or the mDNS TXT record. */
  mirrorId?: string | null;
  name: string;
  host: string;
  port: number;
  version?: string;
  setupComplete?: boolean;
  /** The setup hotspot's provisioning server: only WiFi setup works there. */
  provisioning?: boolean;
}

/**
 * Whether the mirror the client is pointed at can be reached.
 * - idle: no request has finished since the address was set
 * - searching: a request failed at the network level; looking for the mirror by id
 * - not-found: that search came back empty (requests fail until it's found)
 */
export type MirrorConnectionStatus = 'idle' | 'connected' | 'searching' | 'not-found';

export interface MirrorConnectionState {
  status: MirrorConnectionStatus;
  mirrorId: string | null;
  host: string;
  port: number;
}

/** GET /api/discovery (backend) or the setup hotspot's provisioning server. */
export interface DiscoveryInfo {
  mirrorId: string | null;
  name: string;
  version: string;
  setupComplete: boolean;
  /** Present (true) only on the setup hotspot's provisioning server. */
  provisioning?: boolean;
  /** True on a backend that only answers paired phones past this endpoint. */
  pairingRequired?: boolean;
}

/** GET /api/setup/status. Steps run WiFi → Orientation → License → Location → Airport → Face. */
export interface SetupStatus {
  /** First incomplete step. */
  step: 'wifi' | 'orientation' | 'license' | 'location' | 'airport' | 'face' | 'complete';
  wifiConfigured: boolean;
  /** Also true on mirrors set up before the step existed (they count as landscape). */
  orientationConfigured: boolean;
  /** Always true when licensing is disabled on the mirror. */
  licenseActivated: boolean;
  locationConfigured: boolean;
  airportConfigured: boolean;
  faceEnrolled: boolean;
  setupComplete: boolean;
}

// ============================================================
// LICENSE (see docs/LICENSING.md, "Mirror")
// ============================================================

export type LicenseState =
  | 'disabled'
  | 'unlicensed'
  | 'active'
  | 'expired'
  | 'released'
  | 'revoked'
  | 'bound_elsewhere';

/** GET /api/license/status; also the payload of the mirror's WS `license` event. */
export interface LicenseStatus {
  enabled: boolean;
  state: LicenseState;
  keyLast4?: string;
  /** ISO */
  activatedAt?: string;
  /** ISO; when the offline grace period ends. */
  expiresAt?: string;
  /** ISO; last successful check with skyglass.dev. */
  lastCheckedAt?: string;
  message?: string;
  /** A pre-installed key file (kits) is waiting to be activated. */
  keyFilePending?: boolean;
  supportEmail: string;
  manageUrl: string;
}


export interface Airport {
  icao: string;
  name: string;
  city: string;
  lat?: number;
  lon?: number;
  /** Station also issues TAFs */
  taf?: boolean;
  iata?: string;
  /** Distance from the mirror's location, nearby suggestions only */
  distanceNm?: number;
}

export interface UpdateStatus {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  releaseName: string;
  publishedAt: string;
  downloadSize: number;
  downloadReady: boolean;
  lastChecked?: string;
  downloadProgress: {
    phase: 'idle' | 'downloading' | 'extracting' | 'installing' | 'complete' | 'error';
    percent: number;
    speed: number;
    eta: number;
    bytesDownloaded?: number;
    error?: string;
  };
}

/** GET/POST /api/update/config */
export interface UpdateConfig {
  autoUpdate: boolean;
  autoDownload: boolean;
  checkInterval: number;
}

export interface LocationConfig {
  latitude: number;
  longitude: number;
  timezone: string;
}

/**
 * How the mirror panel is mounted (config display.orientation): portrait-cw
 * is "turned right", portrait-ccw "turned left", seen from the front.
 */
export type MirrorOrientation = 'landscape' | 'portrait-cw' | 'portrait-ccw';

/** GET /api/setup/orientation */
export interface OrientationState {
  /** Saved on the mirror. */
  orientation: MirrorOrientation;
  /** Being previewed on the mirror, or null. */
  preview: MirrorOrientation | null;
}

/** Why the mirror is still waiting to take the next face photo (hands-free capture). */
export type RegistrationGuidanceReason =
  | 'no_face'
  | 'multiple'
  | 'too_far'
  | 'off_centre'
  | 'turn_more'
  | 'other_way'
  | 'hold'
  | 'cooldown';

/** Face enrollment session (POST /api/registration/start, GET /api/registration, 'registration' events). */
export interface RegistrationStatus {
  active: boolean;
  samplesCollected: number;
  samplesNeeded: number;
  userName?: string | null;
  currentInstruction?: string;
  action?: 'started' | 'guidance' | 'capture-start' | 'captured' | 'progress' | 'completed' | 'cancelled';
  /** Latest hint from the presence server; null when idle and at the start of a session. */
  guidance?: { reason: RegistrationGuidanceReason; holdMs: number } | null;
}

export interface MirrorConfig {
  airport: string;
  location: LocationConfig;
  display: { orientation: MirrorOrientation };
}

/** True for both portrait mounts (and the legacy value `portrait`). */
export function isPortrait(orientation: unknown): boolean {
  return typeof orientation === 'string' && orientation.startsWith('portrait');
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface MirrorPhoto {
  id: string;
  /** Path on the mirror, e.g. /api/photos/<id>/file; resolve with photoFileUrl(). */
  url: string;
  uploadedAt: string;
  size: number;
}

// ============================================================
// CALENDAR ACCOUNTS (see /api/calendar/*)
// ============================================================

export type CalendarProviderId = 'google' | 'microsoft' | 'icloud' | 'caldav' | 'ics';
export type CalendarConnectMethod = 'oauth' | 'device-code' | 'password' | 'url';
export type CalendarAccountStatus = 'ok' | 'error' | 'reauth';

export interface CalendarProvider {
  id: CalendarProviderId;
  name: string;
  method: CalendarConnectMethod;
  available: boolean;
  /** Why the provider can't be used on this mirror, shown to the user as-is. */
  reason: string | null;
}

export interface AccountCalendar {
  id: string;
  name: string;
  /** #rrggbb */
  color: string;
  enabled: boolean;
}

export interface CalendarAccount {
  id: string;
  provider: CalendarProviderId;
  /** e.g. "Google", "Work"; user-editable. */
  label: string;
  /** Signed-in identity / Apple ID; null for calendar links. */
  email: string | null;
  /** reauth = credentials rejected or expired; the user must reconnect. */
  status: CalendarAccountStatus;
  /** Last sync error, human-readable. */
  error: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  calendars: AccountCalendar[];
}

export interface CalendarAccountUpdate {
  label?: string;
  calendars?: Array<{ id: string; enabled?: boolean; color?: string }>;
}

export interface MicrosoftDeviceCode {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  /** ISO */
  expiresAt: string;
}

export interface MicrosoftSignInStatus {
  status: 'pending' | 'complete' | 'expired' | 'denied' | 'error';
  account: CalendarAccount | null;
  error: string | null;
}

export interface CalDavCredentials {
  provider: 'icloud' | 'caldav';
  /** Required for 'caldav', ignored for 'icloud'. */
  serverUrl?: string;
  username: string;
  password: string;
  label?: string;
}

// ============================================================
// PAIRING (phone <-> mirror trust; docs: pairing contract)
// ============================================================

/** The mirror as reported by the claim/complete responses. */
export interface PairingMirror {
  id: string;
  name: string;
}

/** POST /api/pairing/claim and /complete. The token is stored, never handed to callers. */
export interface PairingResult {
  deviceId: string;
  mirror: PairingMirror;
}

/** POST /api/pairing/request. The mirror now shows a 6-digit code. */
export interface PairingRequest {
  requestId: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** GET /api/pairing/devices */
export interface PairedDevice {
  id: string;
  name: string;
  /** ISO */
  createdAt: string;
  /** ISO; null until the phone has used its token. */
  lastSeenAt: string | null;
  /** True for the phone making the request (this phone). */
  current: boolean;
}

/** GET /api/pairing/whoami */
export interface PairingWhoAmI {
  kind: 'local' | 'internal' | 'device';
  deviceId: string | null;
}

/** `code` of the 401 every protected mirror route returns to an unpaired phone. */
export const PAIRING_REQUIRED = 'pairing_required';
/**
 * `code` of a wrong or expired QR secret / 6-digit code (400). On
 * /complete the body also has `attemptsRemaining` and `requestExpired`.
 */
export const INVALID_PAIRING_CODE = 'invalid_pairing_code';
/** 429: code pairing locked after too many wrong codes in 24 h; the QR still works. */
export const PAIRING_LOCKED = 'pairing_locked';
/** 409: the mirror already has its maximum of paired phones (20). */
export const TOO_MANY_DEVICES = 'too_many_devices';
/** WebSocket close code for a phone whose token was revoked. */
export const WS_CLOSE_PAIRING_REQUIRED = 4401;

export function isPairingRequired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.code === PAIRING_REQUIRED;
}

/** Endpoints the mirror answers without a pairing token. */
const PUBLIC_ENDPOINTS = new Set([
  '/api/health',
  '/api/discovery',
  '/api/pairing/claim',
  '/api/pairing/request',
  '/api/pairing/complete',
]);

function isPublicEndpoint(endpoint: string): boolean {
  return PUBLIC_ENDPOINTS.has(endpoint.split('?')[0]);
}

interface MirrorAuth {
  mirrorId: string | null;
  token: string | null;
}

interface RequestBehaviour {
  /** Don't open the Pair screen on a 401 pairing_required; the caller handles it. */
  skipPairingRedirect?: boolean;
}

/** Called for each 401 pairing_required from the current mirror. */
export type PairingRequiredListener = (mirror: { host: string; port: number }) => void;

/**
 * Thrown by every mirror request. `status` is the HTTP status for a non-2xx
 * response and undefined for network failures and timeouts, so callers can
 * tell "not found" apart from "unreachable".
 */
export class ApiError extends Error {
  readonly status?: number;
  /**
   * Machine-readable reason from the error body, when it has one: the
   * `status` string the license endpoints return (e.g. 'not_found'), a
   * `code` field, or an identifier-like `error` field (e.g.
   * 'pairing_required', 'invalid_pairing_code').
   */
  readonly code?: string;
  /** The parsed error body, for extra fields such as remaining attempts. */
  readonly details?: Record<string, unknown>;
  constructor(message: string, status?: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** After a search comes back empty, further failures don't re-run it for this long. */
const RELOCATE_COOLDOWN_MS = 20000;
const RELOCATE_TIMEOUT_MS = 8000;
/** Unlinking a mirror tries to revoke this phone's token for at most this long. */
const UNPAIR_TIMEOUT_MS = 3000;

class MirrorAPI {
  private baseUrl: string = '';
  private host = '';
  private port = 3001;
  private mirrorId: string | null = null;
  private timeout = 10000;
  private status: MirrorConnectionStatus = 'idle';
  private relocation: Promise<boolean> | null = null;
  private lastRelocationFailure = 0;
  private stateListeners = new Set<(state: MirrorConnectionState) => void>();
  private movedListeners = new Set<(mirrorId: string, host: string, port: number) => void>();
  /** Pairing token per mirror (keyed by authKey()), loaded from the secure store. */
  private auth = new Map<string, MirrorAuth>();
  private authLoading = new Map<string, Promise<MirrorAuth>>();
  private pairingRequiredListener: PairingRequiredListener | null = null;

  /**
   * Point the client at a mirror. Pass the mirror's id whenever it is known:
   * without it the client can't look for the mirror when its address changes.
   */
  setBaseUrl(host: string, port: number = 3001, mirrorId?: string | null) {
    this.host = host;
    this.port = port;
    this.baseUrl = `http://${host}:${port}`;
    this.mirrorId = isMirrorId(mirrorId) ? mirrorId : null;
    this.lastRelocationFailure = 0;
    this.setStatus('idle', true);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getMirrorId(): string | null {
    return this.mirrorId;
  }

  getConnectionState(): MirrorConnectionState {
    return { status: this.status, mirrorId: this.mirrorId, host: this.host, port: this.port };
  }

  /** Listen for connection state changes; returns an unsubscribe function. */
  subscribe(listener: (state: MirrorConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** Called after the current mirror was found at a new address (already saved). */
  onMirrorMoved(listener: (mirrorId: string, host: string, port: number) => void): () => void {
    this.movedListeners.add(listener);
    return () => {
      this.movedListeners.delete(listener);
    };
  }

  // ------------------------------------------------------------ pairing auth

  /** Register the app-wide handler that opens the Pair screen (lib/pairing). */
  setPairingRequiredListener(listener: PairingRequiredListener | null): void {
    this.pairingRequiredListener = listener;
  }

  /** Tokens follow the mirror's id, so they survive relocation; host:port only without one. */
  private authKey(): string {
    return this.mirrorId ? `id:${this.mirrorId}` : `addr:${this.host}:${this.port}`;
  }

  /**
   * This phone's token for the current mirror. Looked up by getMirrorId();
   * when the client has no id yet, the mirror is asked (public GET
   * /api/discovery), falling back to the id last seen at this address.
   * Cached for the app session.
   */
  private loadAuth(): Promise<MirrorAuth> {
    const key = this.authKey();
    const known = this.auth.get(key);
    if (known) return Promise.resolve(known);
    const pending = this.authLoading.get(key);
    if (pending) return pending;

    const host = this.host;
    const port = this.port;
    const clientId = this.mirrorId;
    const load = (async () => {
      let mirrorId = clientId;
      let identified = mirrorId !== null;
      if (!mirrorId) {
        try {
          const identity = await this.send<DiscoveryInfo>('/api/discovery', {}, this.timeout);
          mirrorId = usableMirrorId(identity?.mirrorId);
          identified = true;
        } catch {
          mirrorId = await pairingStore.idForAddress(host, port);
        }
      }
      if (mirrorId) await pairingStore.rememberAddress(host, port, mirrorId);
      const entry: MirrorAuth = { mirrorId, token: await pairingStore.getToken(mirrorId, host, port) };
      // An unreachable mirror is asked again on the next request.
      if (identified || entry.token) this.auth.set(key, entry);
      return entry;
    })().finally(() => {
      this.authLoading.delete(key);
    });
    this.authLoading.set(key, load);
    return load;
  }

  /** True when this phone holds a pairing token for the current mirror. */
  async hasPairingToken(): Promise<boolean> {
    if (!this.baseUrl) return false;
    return (await this.loadAuth()).token !== null;
  }

  /**
   * Authorization header for the current mirror, for requests the client
   * doesn't make itself (<Image source={{ uri, headers }}>). Empty until a
   * request to the mirror has loaded the token.
   */
  authHeaders(): Record<string, string> {
    const token = this.auth.get(this.authKey())?.token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async savePairingToken(reportedId: string | null | undefined, token: string): Promise<void> {
    const mirrorId = usableMirrorId(reportedId) ?? this.mirrorId;
    await pairingStore.setToken(mirrorId, this.host, this.port, token);
    const entry: MirrorAuth = { mirrorId, token };
    this.auth.set(this.authKey(), entry);
    if (mirrorId) this.auth.set(`id:${mirrorId}`, entry);
  }

  /** Forget this phone's token for the current mirror (on this phone only). */
  async forgetPairing(): Promise<void> {
    if (!this.baseUrl) return;
    const { mirrorId } = await this.loadAuth();
    await pairingStore.clearToken(mirrorId, this.host, this.port);
    const entry: MirrorAuth = { mirrorId, token: null };
    this.auth.set(this.authKey(), entry);
    if (mirrorId) this.auth.set(`id:${mirrorId}`, entry);
  }

  /**
   * Unlink a mirror (My Mirrors): revoke this phone's token on that mirror
   * (DELETE /api/pairing/devices/self, best effort with a short timeout since
   * the mirror may be offline), then drop the stored token whatever happened.
   * Works for any linked mirror, not just the current one, and never throws.
   */
  async unpairMirror(mirror: { mirrorId: string | null; host: string; port: number }): Promise<void> {
    const { host, port } = mirror;
    const mirrorId = usableMirrorId(mirror.mirrorId);
    const token = await pairingStore.getToken(mirrorId, host, port).catch(() => null);
    if (token) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), UNPAIR_TIMEOUT_MS);
      try {
        await fetch(`http://${host}:${port}/api/pairing/devices/self`, {
          method: 'DELETE',
          signal: controller.signal,
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Offline or moved: the token is forgotten anyway (the mirror owner can revoke it).
      } finally {
        clearTimeout(timeoutId);
      }
    }
    await pairingStore.clearToken(mirrorId, host, port).catch(() => undefined);
    const cleared: MirrorAuth = { mirrorId, token: null };
    this.auth.set(`addr:${host}:${port}`, cleared);
    if (mirrorId) this.auth.set(`id:${mirrorId}`, cleared);
    // Unlinked the mirror the client points at: detach, so a stray request
    // fails as "not connected" instead of opening the Pair screen.
    const isCurrent =
      (mirrorId !== null && mirrorId === this.mirrorId) ||
      (this.host.toLowerCase() === host.toLowerCase() && this.port === port);
    if (isCurrent) this.resetClient();
  }

  /** Back to a fresh install: no mirror, no cached tokens (lib/devReset). */
  resetClient(): void {
    this.auth.clear();
    this.authLoading.clear();
    this.baseUrl = '';
    this.host = '';
    this.port = 3001;
    this.mirrorId = null;
    this.lastRelocationFailure = 0;
    this.setStatus('idle', true);
  }

  /**
   * The mirror closed this phone's WebSocket with WS_CLOSE_PAIRING_REQUIRED
   * (token revoked): same handling as an HTTP 401 pairing_required.
   */
  async handleSocketPairingRequired(): Promise<void> {
    if (!this.baseUrl) return;
    const key = this.authKey();
    const sent = this.auth.get(key)?.token ?? null;
    await this.handlePairingRequired(key, this.baseUrl, this.host, this.port, sent, {});
  }

  /** ws:// URL of the mirror's live-update socket. */
  getWebSocketUrl(): string {
    return this.baseUrl ? `${this.baseUrl.replace(/^http/, 'ws')}/ws` : '';
  }

  /**
   * Subprotocols to open the socket with: the mirror authenticates phones by
   * the token protocol and selects plain 'skyglass'.
   */
  async getWebSocketProtocols(): Promise<string[]> {
    const { token } = await this.loadAuth().catch(() => ({ token: null }));
    return token ? ['skyglass', `skyglass.token.${token}`] : ['skyglass'];
  }

  /**
   * The mirror rejected this phone. A token we sent is no longer valid
   * (revoked, or the mirror was reset), so drop it unless a newer one was
   * saved meanwhile, then hand over to the Pair screen.
   */
  private async handlePairingRequired(
    key: string,
    base: string,
    host: string,
    port: number,
    sentToken: string | null,
    behaviour: RequestBehaviour
  ): Promise<void> {
    const current = this.auth.get(key);
    if (sentToken && current?.token === sentToken) {
      this.auth.set(key, { mirrorId: current.mirrorId, token: null });
      await pairingStore.clearToken(current.mirrorId, host, port).catch(() => {});
    }
    if (!behaviour.skipPairingRedirect && base === this.baseUrl) {
      this.pairingRequiredListener?.({ host, port });
    }
  }

  private setStatus(status: MirrorConnectionStatus, force = false) {
    if (!force && status === this.status) return;
    this.status = status;
    const state = this.getConnectionState();
    this.stateListeners.forEach((listener) => listener(state));
  }

  /**
   * The current mirror answers at a new address: point the client there,
   * save it on the linked mirror, and tell listeners.
   */
  async moveTo(host: string, port: number): Promise<void> {
    const mirrorId = this.mirrorId;
    this.host = host;
    this.port = port;
    this.baseUrl = `http://${host}:${port}`;
    this.lastRelocationFailure = 0;
    this.setStatus('connected', true);
    if (!mirrorId) return;
    console.log(`[API] Mirror ${mirrorId} is now at ${host}:${port}`);
    try {
      await storage.updateLinkedMirror(mirrorId, {
        host,
        port,
        lastConnected: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[API] Could not save the new mirror address:', err);
    }
    this.movedListeners.forEach((listener) => listener(mirrorId, host, port));
  }

  /**
   * Look for the current mirror by id (mDNS, skyglass.local, the /24 it was
   * last seen on and those of other saved mirrors) and move to wherever it
   * answers. Concurrent callers share one search; after a search finds
   * nothing, automatic retries wait RELOCATE_COOLDOWN_MS unless `force`
   * ("Search again"). Resolves true when the mirror was found.
   */
  relocate(force = false): Promise<boolean> {
    const mirrorId = this.mirrorId;
    if (!mirrorId) return Promise.resolve(false);
    if (this.relocation) return this.relocation;
    if (!force && Date.now() - this.lastRelocationFailure < RELOCATE_COOLDOWN_MS) {
      return Promise.resolve(false);
    }

    const lastHost = this.host;
    const lastPort = this.port;
    this.setStatus('searching');
    this.relocation = (async () => {
      try {
        const saved = await storage.getLinkedMirrors().catch(() => []);
        const subnets = saved
          .map((m) => subnetOf(m.host))
          .filter((s): s is string => s !== null);
        const found = await locateMirror(mirrorId, {
          lastHost,
          lastPort,
          subnets,
          timeoutMs: RELOCATE_TIMEOUT_MS,
        });
        // Pointed at another mirror while searching: leave that alone.
        if (this.mirrorId !== mirrorId) return false;
        if (!found) {
          this.lastRelocationFailure = Date.now();
          this.setStatus('not-found');
          return false;
        }
        if (found.host !== this.host || found.port !== this.port) {
          await this.moveTo(found.host, found.port);
        } else {
          this.setStatus('connected');
        }
        return true;
      } catch (err) {
        console.warn('[API] Mirror search failed:', err);
        this.lastRelocationFailure = Date.now();
        this.setStatus('not-found');
        return false;
      } finally {
        this.relocation = null;
      }
    })();
    return this.relocation;
  }

  /**
   * Make a request to the main API server.
   *
   * When the mirror can't be reached at all (no HTTP response), the client
   * looks for the same mirror by id and, if it answers at a different
   * address, retries the request there once. HTTP errors are never retried.
   * Pass relocate=false for requests that are expected to cut the connection
   * (joining WiFi).
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs: number = this.timeout,
    relocate = true,
    behaviour: RequestBehaviour = {}
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new ApiError('Mirror not connected. Call setBaseUrl first.');
    }

    const failedBase = this.baseUrl;
    try {
      const result = await this.send<T>(endpoint, options, timeoutMs, behaviour);
      if (this.baseUrl === failedBase) this.setStatus('connected');
      return result;
    } catch (error) {
      const unreachable = error instanceof ApiError && error.status === undefined;
      // An HTTP error still means the mirror answered.
      if (!unreachable && this.baseUrl === failedBase) this.setStatus('connected');
      if (!unreachable || !relocate || !this.mirrorId) throw error;
      const found = await this.relocate();
      // Found at the same address: the failure was something else.
      if (!found || this.baseUrl === failedBase) throw error;
      return this.send<T>(endpoint, options, timeoutMs, behaviour);
    }
  }

  private async send<T>(
    endpoint: string,
    options: RequestInit,
    timeoutMs: number,
    behaviour: RequestBehaviour = {}
  ): Promise<T> {
    const base = this.baseUrl;
    const host = this.host;
    const port = this.port;
    const key = this.authKey();
    // A failed token lookup never blocks the request; the mirror answers 401 instead.
    const token = isPublicEndpoint(endpoint)
      ? null
      : await this.loadAuth().then((a) => a.token, () => null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // fetch must set the multipart boundary itself, so FormData bodies get no Content-Type.
    const isMultipart = typeof FormData !== 'undefined' && options.body instanceof FormData;

    try {
      const response = await fetch(`${base}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          ...(isMultipart ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        const code =
          typeof error?.status === 'string' ? error.status
          : typeof error?.code === 'string' ? error.code
          : typeof error?.error === 'string' && /^[a-z][a-z0-9_]*$/.test(error.error) ? error.error
          : undefined;
        const apiError = new ApiError(
          error?.message || error?.error || `HTTP ${response.status}`,
          response.status,
          code,
          error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined
        );
        if (isPairingRequired(apiError)) {
          await this.handlePairingRequired(key, base, host, port, token, behaviour);
        }
        throw apiError;
      }

      // 204 No Content (e.g. DELETE) has no body to parse.
      if (response.status === 204) return undefined as T;
      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError('Request timed out');
      }
      throw new ApiError(error instanceof Error ? error.message : 'Network request failed');
    }
  }

  // Health check
  async ping(): Promise<{ status: string; timestamp?: number }> {
    return this.request('/api/health');
  }

  /** Identity of the mirror at the current address (mirrorId is its persistent id). */
  async getDiscoveryInfo(): Promise<DiscoveryInfo> {
    return this.request('/api/discovery');
  }

  // ============================================================
  // PAIRING
  // ============================================================

  /** Claim with the secret from the mirror's QR code. Stores the token. */
  async claimPairing(secret: string, deviceName: string): Promise<PairingResult> {
    const res = await this.request<PairingResult & { token: string }>(
      '/api/pairing/claim',
      { method: 'POST', body: JSON.stringify({ secret, deviceName }) },
      this.timeout,
      false
    );
    await this.savePairingToken(res.mirror?.id, res.token);
    return { deviceId: res.deviceId, mirror: res.mirror };
  }

  /** Ask the mirror to show a 6-digit code (replaces any pending request). */
  async requestPairing(deviceName: string): Promise<PairingRequest> {
    return this.request('/api/pairing/request', {
      method: 'POST',
      body: JSON.stringify({ deviceName }),
    });
  }

  /** Finish code pairing. Stores the token. */
  async completePairing(requestId: string, code: string): Promise<PairingResult> {
    const res = await this.request<PairingResult & { token: string }>('/api/pairing/complete', {
      method: 'POST',
      body: JSON.stringify({ requestId, code }),
    });
    await this.savePairingToken(res.mirror?.id, res.token);
    return { deviceId: res.deviceId, mirror: res.mirror };
  }

  /** Who the mirror thinks this phone is. Never opens the Pair screen. */
  async whoami(): Promise<PairingWhoAmI> {
    return this.request('/api/pairing/whoami', {}, this.timeout, true, { skipPairingRedirect: true });
  }

  async getPairedDevices(): Promise<PairedDevice[]> {
    const res = await this.request<{ devices: PairedDevice[] }>('/api/pairing/devices');
    return res.devices ?? [];
  }

  async renamePairedDevice(id: string, name: string): Promise<PairedDevice> {
    const res = await this.request<{ device: PairedDevice }>(
      `/api/pairing/devices/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify({ name }) }
    );
    return res.device;
  }

  /** Revoke a phone. For this phone's own id, call forgetPairing() afterwards. */
  async removePairedDevice(id: string): Promise<void> {
    await this.request<void>(
      `/api/pairing/devices/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      this.timeout,
      true,
      { skipPairingRedirect: true }
    );
  }

  // ============================================================
  // FACE ENROLLMENT (session control; progress arrives over the WebSocket)
  // ============================================================

  async startRegistration(userName: string, userId?: string): Promise<RegistrationStatus & { error?: string }> {
    return this.request('/api/registration/start', {
      method: 'POST',
      body: JSON.stringify({ userName, userId }),
    });
  }

  /** Current session state, to catch up on guidance sent before the WebSocket opened. */
  async getRegistration(): Promise<RegistrationStatus> {
    return this.request('/api/registration');
  }

  async captureRegistration(): Promise<{ success: boolean; error?: string }> {
    return this.request('/api/registration/capture', { method: 'POST' });
  }

  async cancelRegistration(): Promise<void> {
    await this.request<unknown>('/api/registration/cancel', { method: 'POST' });
  }

  // Setup endpoints
  async getSetupStatus(): Promise<SetupStatus> {
    return this.request('/api/setup/status');
  }

  async searchAirports(query: string): Promise<Airport[]> {
    return this.request(`/api/setup/airports?q=${encodeURIComponent(query)}`);
  }

  /** Airports nearest the mirror's saved location (or the given point). */
  async getNearbyAirports(lat?: number, lon?: number, limit = 8): Promise<Airport[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (lat !== undefined && lon !== undefined) {
      params.set('lat', String(lat));
      params.set('lon', String(lon));
    }
    return this.request(`/api/setup/airports/nearby?${params.toString()}`);
  }

  async setAirport(icao: string): Promise<{ success: boolean }> {
    return this.request('/api/setup/airport', {
      method: 'POST',
      body: JSON.stringify({ icao }),
    });
  }

  async setLocation(location: LocationConfig): Promise<{ success: boolean }> {
    return this.request('/api/setup/location', {
      method: 'POST',
      body: JSON.stringify(location),
    });
  }

  async getLocation(): Promise<LocationConfig | null> {
    return this.request('/api/setup/location');
  }

  async getOrientation(): Promise<OrientationState> {
    return this.request('/api/setup/orientation');
  }

  /**
   * preview: true turns the mirror to `orientation` and shows its "This way
   * up?" check without saving; otherwise it is saved and the check ends.
   */
  async setOrientation(orientation: MirrorOrientation, preview = false): Promise<{ success: boolean }> {
    return this.request('/api/setup/orientation', {
      method: 'POST',
      body: JSON.stringify({ orientation, preview }),
    });
  }

  /** End a preview: the mirror goes back to its saved orientation. */
  async clearOrientationPreview(): Promise<void> {
    await this.request<unknown>('/api/setup/orientation/preview', { method: 'DELETE' });
  }

  // Registered faces (enrollment itself runs on the presence server; see setup/face)
  async getRegisteredFaces(): Promise<{ id: string; name: string; createdAt: string }[]> {
    return this.request('/api/presence/faces');
  }

  async deleteFace(faceId: string): Promise<{ success: boolean }> {
    return this.request(`/api/presence/faces/${encodeURIComponent(faceId)}`, {
      method: 'DELETE',
    });
  }

  // License (docs/LICENSING.md). setLicenseKey and refreshLicense resolve
  // with the new status; a rejected key throws ApiError with `code` set to
  // the license server's status (not_found, bound_to_another_device, revoked).
  async getLicenseStatus(): Promise<LicenseStatus> {
    return this.request('/api/license/status');
  }

  /** Activation round-trips to skyglass.dev, so this allows longer than usual. */
  async setLicenseKey(licenseKey: string): Promise<LicenseStatus> {
    return this.request(
      '/api/license/key',
      { method: 'POST', body: JSON.stringify({ licenseKey }) },
      30000
    );
  }

  async refreshLicense(): Promise<LicenseStatus> {
    return this.request('/api/license/refresh', { method: 'POST' }, 30000);
  }

  // WiFi provisioning
  async getWifiNetworks(): Promise<{ ssid: string; signal: number; secure: boolean }[]> {
    return this.request('/api/wifi/scan');
  }

  /**
   * Hand the mirror its WiFi credentials. On the setup hotspot this only
   * starts the join (the mirror then drops the hotspot), so the result means
   * "accepted"; follow up by finding the mirror on the new network
   * (components/MirrorHandoff). Never relocated: losing the connection here
   * is expected.
   */
  async connectWifi(
    ssid: string,
    password: string
  ): Promise<{ success: boolean; pending?: boolean; error?: string; message?: string }> {
    return this.request(
      '/api/wifi/connect',
      { method: 'POST', body: JSON.stringify({ ssid, password }) },
      60000,
      false
    );
  }

  // Update endpoints
  async getUpdateStatus(): Promise<UpdateStatus> {
    return this.request('/api/update/status');
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    return this.request('/api/update/check', { method: 'POST' });
  }

  async downloadUpdate(): Promise<{ success: boolean; message: string }> {
    return this.request('/api/update/download', { method: 'POST' });
  }

  async applyUpdate(): Promise<{ success: boolean; message: string }> {
    return this.request('/api/update/apply', { method: 'POST' });
  }

  async getUpdateConfig(): Promise<UpdateConfig> {
    return this.request('/api/update/config');
  }

  /** Partial update; resolves with the full saved config. */
  async setUpdateConfig(changes: Partial<UpdateConfig>): Promise<UpdateConfig> {
    return this.request('/api/update/config', {
      method: 'POST',
      body: JSON.stringify(changes),
    });
  }

  // Config endpoints
  async getConfig(): Promise<MirrorConfig> {
    return this.request('/api/config');
  }

  // Layout management
  async getLayout(): Promise<MirrorLayout> {
    return this.request('/api/layout');
  }

  async updateLayout(layout: MirrorLayout): Promise<{ success: boolean; layout: MirrorLayout }> {
    return this.request('/api/layout', {
      method: 'PUT',
      body: JSON.stringify(layout),
    });
  }

  // ============================================================
  // USERS
  // ============================================================

  /**
   * Register (or update) this phone's user on the mirror. The mirror upserts
   * by id, so this is safe to call on every connect.
   */
  async createUser(user: {
    id: string;
    name: string;
    preferences?: Record<string, unknown>;
  }): Promise<{ success: boolean; mirrorId: string; mirrorName: string }> {
    return this.request('/api/users', {
      method: 'POST',
      body: JSON.stringify(user),
    });
  }

  // ============================================================
  // USER-SPECIFIC LAYOUT METHODS
  // ============================================================

  /**
   * Get a user's active layout
   */
  async getUserLayout(userId: string): Promise<{
    id: string;
    name: string;
    modules: ModuleInstance[];
    updatedAt: string;
  }> {
    return this.request(`/api/users/${userId}/layout`);
  }

  /**
   * Update a user's active layout modules
   */
  async updateUserLayout(
    userId: string,
    modules: ModuleInstance[]
  ): Promise<{ success: boolean }> {
    return this.request(`/api/users/${userId}/layout`, {
      method: 'PUT',
      body: JSON.stringify({ modules }),
    });
  }

  // ============================================================
  // DISPLAY HOLD (keep the mirror awake while editing a layout)
  // ============================================================

  /**
   * Keep the mirror's display on for `seconds` regardless of presence.
   * Call again before it expires to extend; see hooks/useDisplayHold.
   */
  async holdDisplay(seconds: number): Promise<{ displayState: string; holdUntil: number }> {
    return this.request('/api/display/hold', {
      method: 'POST',
      body: JSON.stringify({ seconds }),
    });
  }

  /** End the hold early and drop any live preview. */
  async releaseDisplay(): Promise<{ displayState: string }> {
    return this.request('/api/display/release', { method: 'POST' });
  }

  /** Show `modules` on the mirror without saving them (cleared on release). */
  async previewLayout(modules: ModuleInstance[]): Promise<{ success: boolean }> {
    return this.request('/api/display/preview', {
      method: 'POST',
      body: JSON.stringify({ modules }),
    });
  }

  // ============================================================
  // TODOS (to-do widget)
  // ============================================================

  async getTodos(): Promise<TodoItem[]> {
    const res = await this.request<{ items: TodoItem[] }>('/api/todos');
    return res.items ?? [];
  }

  async addTodo(text: string): Promise<TodoItem> {
    const res = await this.request<{ item: TodoItem }>('/api/todos', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    return res.item;
  }

  async updateTodo(id: string, updates: { text?: string; done?: boolean }): Promise<TodoItem> {
    const res = await this.request<{ item: TodoItem }>(`/api/todos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    return res.item;
  }

  async deleteTodo(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/todos/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** Replace the whole list; used for reordering. */
  async replaceTodos(items: Pick<TodoItem, 'id' | 'text' | 'done'>[]): Promise<TodoItem[]> {
    const res = await this.request<{ items: TodoItem[] }>('/api/todos', {
      method: 'PUT',
      body: JSON.stringify({ items: items.map(({ id, text, done }) => ({ id, text, done })) }),
    });
    return res.items ?? [];
  }

  // ============================================================
  // PHOTOS (photo-frame widget)
  // ============================================================

  async getPhotos(): Promise<MirrorPhoto[]> {
    const res = await this.request<{ photos: MirrorPhoto[] }>('/api/photos');
    return res.photos ?? [];
  }

  /** Absolute URL for a photo's image bytes; load it with photoSource(). */
  photoFileUrl(photo: MirrorPhoto): string {
    return /^https?:\/\//.test(photo.url) ? photo.url : `${this.baseUrl}${photo.url}`;
  }

  /** <Image source> for a photo, with this phone's pairing token. */
  photoSource(photo: MirrorPhoto): { uri: string; headers: Record<string, string> } {
    return { uri: this.photoFileUrl(photo), headers: this.authHeaders() };
  }

  async uploadPhoto(uri: string, mimeType: string = 'image/jpeg'): Promise<MirrorPhoto> {
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const form = new FormData();
    // React Native's FormData takes a { uri, name, type } descriptor instead of a Blob.
    form.append('photo', { uri, name: `photo.${ext}`, type: mimeType } as unknown as Blob);
    // Uploads over a home Wi-Fi link can take far longer than a JSON call.
    const res = await this.request<{ photo: MirrorPhoto }>(
      '/api/photos',
      { method: 'POST', body: form },
      60000
    );
    return res.photo;
  }

  async deletePhoto(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // ============================================================
  // CALENDAR ACCOUNTS
  // Credentials are sent once and stay on the mirror; no response carries
  // a secret, and none of these requests are logged.
  // ============================================================

  async getCalendarProviders(): Promise<CalendarProvider[]> {
    const res = await this.request<{ providers: CalendarProvider[] }>('/api/calendar/providers');
    return res.providers ?? [];
  }

  async getCalendarAccounts(): Promise<CalendarAccount[]> {
    const res = await this.request<{ accounts: CalendarAccount[] }>('/api/calendar/accounts');
    return res.accounts ?? [];
  }

  async updateCalendarAccount(id: string, updates: CalendarAccountUpdate): Promise<CalendarAccount> {
    const res = await this.request<{ account: CalendarAccount }>(
      `/api/calendar/accounts/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(updates) }
    );
    return res.account;
  }

  async deleteCalendarAccount(id: string): Promise<void> {
    await this.request<void>(`/api/calendar/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** Sync now; the mirror also rediscovers the account's calendar list. */
  async syncCalendarAccount(id: string): Promise<CalendarAccount> {
    const res = await this.request<{ account: CalendarAccount }>(
      `/api/calendar/accounts/${encodeURIComponent(id)}/sync`,
      { method: 'POST' },
      30000
    );
    return res.account;
  }

  /** returnUrl is where the bounce page sends code/state: Linking.createURL('oauth/google'). */
  async startGoogleSignIn(returnUrl: string): Promise<{ authUrl: string }> {
    return this.request('/api/calendar/google/start', {
      method: 'POST',
      body: JSON.stringify({ returnUrl }),
    });
  }

  /** Resolves with the new account, or the existing one when that Google account was already connected. */
  async completeGoogleSignIn(code: string, state: string): Promise<CalendarAccount> {
    const res = await this.request<{ account: CalendarAccount }>(
      '/api/calendar/google/complete',
      { method: 'POST', body: JSON.stringify({ code, state }) },
      30000
    );
    return res.account;
  }

  async startMicrosoftSignIn(): Promise<MicrosoftDeviceCode> {
    return this.request('/api/calendar/microsoft/start', { method: 'POST' });
  }

  async getMicrosoftSignInStatus(sessionId: string): Promise<MicrosoftSignInStatus> {
    return this.request(`/api/calendar/microsoft/status/${encodeURIComponent(sessionId)}`);
  }

  /** iCloud (Apple ID + app-specific password) or any other CalDAV server. */
  async addCalDavAccount(credentials: CalDavCredentials): Promise<CalendarAccount> {
    const res = await this.request<{ account: CalendarAccount }>(
      '/api/calendar/caldav',
      { method: 'POST', body: JSON.stringify(credentials) },
      45000
    );
    return res.account;
  }

  /** Subscribe to an iCal/ICS link (webcal:// is accepted). */
  async addCalendarLink(url: string, label?: string): Promise<CalendarAccount> {
    const res = await this.request<{ account: CalendarAccount }>(
      '/api/calendar/ics',
      { method: 'POST', body: JSON.stringify(label ? { url, label } : { url }) },
      30000
    );
    return res.account;
  }
}

export const api = new MirrorAPI();
