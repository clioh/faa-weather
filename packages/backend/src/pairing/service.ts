/**
 * Phone pairing (docs/SECURITY.md, "Port 3001").
 *
 * A phone becomes trusted by proving it can see the mirror's screen:
 *   - QR: the mirror shows skyglass://connect?...&pair=<secret>; the phone
 *     POSTs the secret to /api/pairing/claim. 128-bit, single use, rotates
 *     every 10 minutes and right after a claim.
 *   - Code: the phone POSTs /api/pairing/request, the mirror shows a 6-digit
 *     code (WebSocket `pairing` event, local sockets only), the phone POSTs
 *     it to /api/pairing/complete. 2 minutes, 5 attempts, one pending request.
 *
 * Either way the phone receives a bearer token (sgp_ + 32 random bytes,
 * base64url) once. Only its sha256 is stored, in data/paired-devices.json
 * (0600, atomic writes).
 */

import { EventEmitter } from 'events';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MAX_DEVICES = 20;
export const QR_SECRET_TTL_MS = 10 * 60 * 1000;
export const CODE_REQUEST_TTL_MS = 2 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
/** Wrong codes from all clients per rolling window before the code flow locks (QR still works). */
export const MAX_GLOBAL_CODE_FAILURES = 50;
export const GLOBAL_CODE_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
const LAST_SEEN_RESOLUTION_MS = 60 * 1000;
export const TOKEN_PREFIX = 'sgp_';

export function pairedDevicesPath(): string {
  return (
    process.env.SKYGLASS_PAIRED_DEVICES_FILE || path.resolve(__dirname, '../../../../data/paired-devices.json')
  );
}

export interface PairedDeviceRecord {
  id: string;
  name: string;
  /** sha256 hex of the bearer token. */
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string | null;
  /**
   * The person on this mirror (users.id) the phone belongs to: set when the
   * phone registers its own profile or accepts an invite. Decides whose
   * layouts it may edit once that person has joined (routes/users.ts).
   */
  userId?: string | null;
}

export interface PublicDevice {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface MirrorIdentity {
  id: string;
  name: string;
}

export interface PairingResult {
  deviceId: string;
  token: string;
  mirror: MirrorIdentity;
}

/** Payloads of the WebSocket `pairing` event (local sockets only). */
export type PairingEvent =
  | { state: 'qr-rotated' }
  | { state: 'show'; code: string; deviceName: string; expiresAt: number }
  | { state: 'hide'; result: 'paired' | 'failed' | 'expired'; deviceName: string };

export type PairingErrorCode = 'invalid_pairing_code' | 'too_many_devices' | 'pairing_locked' | 'not_found';

export class PairingError extends Error {
  constructor(
    public readonly code: PairingErrorCode,
    message: string,
    public readonly httpStatus: number,
    public readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function isRecord(v: unknown): v is PairedDeviceRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.tokenHash === 'string' &&
    /^[0-9a-f]{64}$/.test(r.tokenHash) &&
    typeof r.createdAt === 'string' &&
    (r.lastSeenAt === null || typeof r.lastSeenAt === 'string')
  );
}

/** data/paired-devices.json: `[{ id, name, tokenHash, createdAt, lastSeenAt }]`. */
export class PairedDeviceStore {
  constructor(private readonly filePath: string) {}

  load(): PairedDeviceRecord[] {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      return parsed.filter(isRecord);
    } catch (error) {
      // Keep the bad file for inspection; every phone has to pair again.
      const aside = `${this.filePath}.corrupt-${Date.now()}`;
      console.error(`[Pairing] ${this.filePath} is unreadable (${String(error)}); moved to ${aside}`);
      try {
        fs.renameSync(this.filePath, aside);
      } catch {
        // best effort
      }
      return [];
    }
  }

  save(devices: PairedDeviceRecord[]): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.${path.basename(this.filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(devices, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.renameSync(tmp, this.filePath);
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      throw error;
    }
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // best effort
    }
  }
}

interface PendingRequest {
  requestId: string;
  code: string;
  deviceName: string;
  expiresAt: number;
  attempts: number;
  timer: NodeJS.Timeout;
}

export interface PairingServiceOptions {
  filePath?: string;
  mirror: () => MirrorIdentity;
}

/**
 * Events: 'pairing' (PairingEvent, for local sockets), 'revoked' (deviceId).
 */
export class PairingService extends EventEmitter {
  private readonly store: PairedDeviceStore;
  private readonly mirror: () => MirrorIdentity;
  private devices: PairedDeviceRecord[] | null = null;
  private qr: { secret: string; expiresAt: number; timer: NodeJS.Timeout } | null = null;
  private pending: PendingRequest | null = null;
  private codeFailures: number[] = [];

  constructor(options: PairingServiceOptions) {
    super();
    this.store = new PairedDeviceStore(options.filePath ?? pairedDevicesPath());
    this.mirror = options.mirror;
  }

  // ---------------------------------------------------------------- devices

  private all(): PairedDeviceRecord[] {
    if (!this.devices) this.devices = this.store.load();
    return this.devices;
  }

  private persist(): void {
    this.store.save(this.all());
  }

  listDevices(): PublicDevice[] {
    return this.all().map(({ id, name, createdAt, lastSeenAt }) => ({ id, name, createdAt, lastSeenAt }));
  }

  /** Paired device for this bearer token, or null. Updates lastSeenAt (at most once a minute). */
  authenticate(token: string): PublicDevice | null {
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
    const hash = hashToken(token);
    let found: PairedDeviceRecord | null = null;
    // Compare against every record so timing does not depend on the position.
    for (const device of this.all()) {
      if (safeEqual(device.tokenHash, hash)) found = device;
    }
    if (!found) return null;
    const now = Date.now();
    const last = found.lastSeenAt ? Date.parse(found.lastSeenAt) : 0;
    if (!(now - last < LAST_SEEN_RESOLUTION_MS)) {
      found.lastSeenAt = new Date(now).toISOString();
      try {
        this.persist();
      } catch (error) {
        console.error('[Pairing] Could not record lastSeenAt:', error);
      }
    }
    return { id: found.id, name: found.name, createdAt: found.createdAt, lastSeenAt: found.lastSeenAt };
  }

  renameDevice(id: string, name: string): PublicDevice {
    const device = this.all().find((d) => d.id === id);
    if (!device) throw new PairingError('not_found', 'No paired phone with that id.', 404);
    device.name = name;
    this.persist();
    return { id: device.id, name: device.name, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt };
  }

  /** Unpair a phone. Its token stops working immediately and its sockets are closed ('revoked'). */
  revokeDevice(id: string): void {
    const devices = this.all();
    const index = devices.findIndex((d) => d.id === id);
    if (index === -1) throw new PairingError('not_found', 'No paired phone with that id.', 404);
    devices.splice(index, 1);
    this.persist();
    this.emit('revoked', id);
  }

  /** The person this paired phone belongs to, or null if not known yet. */
  deviceUserId(deviceId: string): string | null {
    return this.all().find((d) => d.id === deviceId)?.userId ?? null;
  }

  /** True when some paired phone belongs to this person. */
  hasDeviceForUser(userId: string): boolean {
    return this.all().some((d) => d.userId === userId);
  }

  /** Record which person a paired phone belongs to. */
  bindUser(deviceId: string, userId: string): void {
    const device = this.all().find((d) => d.id === deviceId);
    if (!device || device.userId === userId) return;
    device.userId = userId;
    this.persist();
  }

  /** Pair a phone that accepted an invite: it belongs to that person from the start. */
  pairForUser(deviceName: string, userId: string): PairingResult {
    return this.addDevice(deviceName, userId);
  }

  private addDevice(deviceName: string, userId: string | null = null): PairingResult {
    this.assertRoom();
    const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const record: PairedDeviceRecord = {
      id: randomUUID(),
      name: deviceName,
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeenAt: now,
      ...(userId ? { userId } : {}),
    };
    this.all().push(record);
    this.persist();
    console.log(`[Pairing] Paired "${deviceName}" (${record.id})`);
    return { deviceId: record.id, token, mirror: this.mirror() };
  }

  private assertRoom(): void {
    if (this.all().length >= MAX_DEVICES) {
      throw new PairingError(
        'too_many_devices',
        `This mirror already has ${MAX_DEVICES} paired phones. Remove one in Settings → Paired phones first.`,
        409
      );
    }
  }

  // --------------------------------------------------------------------- QR

  private emitPairing(event: PairingEvent): void {
    this.emit('pairing', event);
  }

  private rotateQr(notify: boolean): void {
    if (this.qr) clearTimeout(this.qr.timer);
    const expiresAt = Date.now() + QR_SECRET_TTL_MS;
    const timer = setTimeout(() => this.rotateQr(true), QR_SECRET_TTL_MS);
    timer.unref?.();
    this.qr = { secret: randomBytes(16).toString('base64url'), expiresAt, timer };
    if (notify) this.emitPairing({ state: 'qr-rotated' });
  }

  /** Current QR secret (created on first use). */
  getQrSecret(): { secret: string; expiresAt: number } {
    if (!this.qr || this.qr.expiresAt <= Date.now()) this.rotateQr(this.qr !== null);
    const { secret, expiresAt } = this.qr!;
    return { secret, expiresAt };
  }

  claim(secret: string, deviceName: string): PairingResult {
    const current = this.qr;
    const valid = current !== null && current.expiresAt > Date.now() && safeEqual(secret, current.secret);
    if (!valid) {
      throw new PairingError(
        'invalid_pairing_code',
        'This pairing QR code has expired or was already used. Scan the code on the mirror again.',
        400
      );
    }
    const result = this.addDevice(deviceName);
    this.rotateQr(true); // single use
    return result;
  }

  // ------------------------------------------------------------------- code

  private codeFlowLocked(): boolean {
    const cutoff = Date.now() - GLOBAL_CODE_FAILURE_WINDOW_MS;
    this.codeFailures = this.codeFailures.filter((t) => t > cutoff);
    return this.codeFailures.length >= MAX_GLOBAL_CODE_FAILURES;
  }

  private assertCodeFlowOpen(): void {
    if (this.codeFlowLocked()) {
      throw new PairingError(
        'pairing_locked',
        'Too many wrong pairing codes were entered. Scan the QR code on the mirror instead, or try again later.',
        429
      );
    }
  }

  private endPending(result: 'paired' | 'failed' | 'expired'): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    this.emitPairing({ state: 'hide', result, deviceName: pending.deviceName });
  }

  /** Start the code flow; replaces any pending request. */
  request(deviceName: string): { requestId: string; expiresAt: number } {
    this.assertCodeFlowOpen();
    this.assertRoom();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
    const requestId = randomBytes(16).toString('base64url');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = Date.now() + CODE_REQUEST_TTL_MS;
    const timer = setTimeout(() => {
      if (this.pending?.requestId === requestId) this.endPending('expired');
    }, CODE_REQUEST_TTL_MS);
    timer.unref?.();
    this.pending = { requestId, code, deviceName, expiresAt, attempts: 0, timer };
    this.emitPairing({ state: 'show', code, deviceName, expiresAt });
    return { requestId, expiresAt };
  }

  complete(requestId: string, code: string): PairingResult {
    this.assertCodeFlowOpen();
    const pending = this.pending;
    if (!pending || !safeEqual(requestId, pending.requestId)) {
      throw new PairingError(
        'invalid_pairing_code',
        'This pairing request has expired. Request a new code.',
        400,
        { attemptsRemaining: 0, requestExpired: true }
      );
    }
    if (pending.expiresAt <= Date.now()) {
      this.endPending('expired');
      throw new PairingError(
        'invalid_pairing_code',
        'This pairing code has expired. Request a new code.',
        400,
        { attemptsRemaining: 0, requestExpired: true }
      );
    }
    if (!safeEqual(code, pending.code)) {
      pending.attempts += 1;
      this.codeFailures.push(Date.now());
      const attemptsRemaining = MAX_CODE_ATTEMPTS - pending.attempts;
      if (attemptsRemaining <= 0) {
        this.endPending('failed');
        throw new PairingError(
          'invalid_pairing_code',
          'Too many wrong codes. Request a new code.',
          400,
          { attemptsRemaining: 0, requestExpired: true }
        );
      }
      throw new PairingError('invalid_pairing_code', "That code doesn't match the one on the mirror.", 400, {
        attemptsRemaining,
        requestExpired: false,
      });
    }
    let result: PairingResult;
    try {
      result = this.addDevice(pending.deviceName);
    } catch (error) {
      this.endPending('failed');
      throw error;
    }
    this.endPending('paired');
    return result;
  }

  /** For tests and shutdown. */
  dispose(): void {
    if (this.qr) clearTimeout(this.qr.timer);
    if (this.pending) clearTimeout(this.pending.timer);
    this.qr = null;
    this.pending = null;
    this.removeAllListeners();
  }
}
