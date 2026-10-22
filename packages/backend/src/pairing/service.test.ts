import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  PairingService,
  PairingError,
  hashToken,
  MAX_CODE_ATTEMPTS,
  MAX_DEVICES,
  QR_SECRET_TTL_MS,
  CODE_REQUEST_TTL_MS,
  MAX_GLOBAL_CODE_FAILURES,
  type PairingEvent,
} from './service.js';

let dir: string;
let file: string;
let service: PairingService;
let events: PairingEvent[];

function makeService(): PairingService {
  const s = new PairingService({ filePath: file, mirror: () => ({ id: 'mirror-1', name: 'Hall Mirror' }) });
  s.on('pairing', (e: PairingEvent) => events.push(e));
  return s;
}

function expectPairingError(fn: () => unknown, code: string): PairingError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PairingError);
    expect((error as PairingError).code).toBe(code);
    return error as PairingError;
  }
  throw new Error('expected a PairingError');
}

/** The code the mirror would show for the latest request. */
function shownCode(): string {
  const show = [...events].reverse().find((e) => e.state === 'show');
  if (!show || show.state !== 'show') throw new Error('no code shown');
  return show.code;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-pairing-'));
  file = path.join(dir, 'paired-devices.json');
  events = [];
  service = makeService();
});

afterEach(() => {
  service.dispose();
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('QR claim', () => {
  it('pairs with the current secret and returns a token once', () => {
    const { secret } = service.getQrSecret();
    const result = service.claim(secret, "Clio's iPhone");
    expect(result.token).toMatch(/^sgp_[A-Za-z0-9_-]{43}$/);
    expect(result.mirror).toEqual({ id: 'mirror-1', name: 'Hall Mirror' });
    expect(service.authenticate(result.token)?.id).toBe(result.deviceId);
    expect(service.listDevices()).toHaveLength(1);
  });

  it('secret is single use and rotates (with qr-rotated) after a claim', () => {
    const { secret } = service.getQrSecret();
    service.claim(secret, 'Phone A');
    expect(events).toContainEqual({ state: 'qr-rotated' });
    expectPairingError(() => service.claim(secret, 'Phone B'), 'invalid_pairing_code');
    expect(service.getQrSecret().secret).not.toBe(secret);
  });

  it('rejects a wrong secret', () => {
    service.getQrSecret();
    expectPairingError(() => service.claim('nope', 'Phone'), 'invalid_pairing_code');
    expect(service.listDevices()).toHaveLength(0);
  });

  it('rotates every 10 minutes, notifies, and the old secret stops working', () => {
    vi.useFakeTimers();
    const first = service.getQrSecret();
    expect(first.expiresAt - Date.now()).toBe(QR_SECRET_TTL_MS);
    vi.advanceTimersByTime(QR_SECRET_TTL_MS + 1);
    expect(events).toContainEqual({ state: 'qr-rotated' });
    expectPairingError(() => service.claim(first.secret, 'Phone'), 'invalid_pairing_code');
    const second = service.getQrSecret();
    expect(second.secret).not.toBe(first.secret);
    expect(service.claim(second.secret, 'Phone').token).toBeTruthy();
  });

  it('secret is stable between fetches until it rotates', () => {
    expect(service.getQrSecret().secret).toBe(service.getQrSecret().secret);
  });
});

describe('code request / complete', () => {
  it('happy path: show event, then hide paired and a token', () => {
    const { requestId, expiresAt } = service.request('Pixel');
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(CODE_REQUEST_TTL_MS);
    const code = shownCode();
    expect(code).toMatch(/^\d{6}$/);
    const result = service.complete(requestId, code);
    expect(service.authenticate(result.token)?.name).toBe('Pixel');
    expect(events.at(-1)).toEqual({ state: 'hide', result: 'paired', deviceName: 'Pixel' });
    // The request is consumed.
    expectPairingError(() => service.complete(requestId, code), 'invalid_pairing_code');
  });

  it('5 wrong codes void the request (hide failed), even the right code fails afterwards', () => {
    const { requestId } = service.request('Pixel');
    const code = shownCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) {
      const err = expectPairingError(() => service.complete(requestId, wrong), 'invalid_pairing_code');
      expect(err.extra).toMatchObject({ attemptsRemaining: MAX_CODE_ATTEMPTS - i, requestExpired: false });
    }
    const last = expectPairingError(() => service.complete(requestId, wrong), 'invalid_pairing_code');
    expect(last.extra).toMatchObject({ attemptsRemaining: 0, requestExpired: true });
    expect(events.at(-1)).toEqual({ state: 'hide', result: 'failed', deviceName: 'Pixel' });
    expectPairingError(() => service.complete(requestId, code), 'invalid_pairing_code');
    expect(service.listDevices()).toHaveLength(0);
  });

  it('expires after 2 minutes (hide expired)', () => {
    vi.useFakeTimers();
    const { requestId } = service.request('Pixel');
    const code = shownCode();
    vi.advanceTimersByTime(CODE_REQUEST_TTL_MS + 1);
    expect(events.at(-1)).toEqual({ state: 'hide', result: 'expired', deviceName: 'Pixel' });
    const err = expectPairingError(() => service.complete(requestId, code), 'invalid_pairing_code');
    expect(err.extra).toMatchObject({ requestExpired: true });
  });

  it('a new request replaces the pending one', () => {
    const first = service.request('Phone A');
    const firstCode = shownCode();
    const second = service.request('Phone B');
    expectPairingError(() => service.complete(first.requestId, firstCode), 'invalid_pairing_code');
    expect(service.complete(second.requestId, shownCode()).token).toBeTruthy();
    expect(service.listDevices().map((d) => d.name)).toEqual(['Phone B']);
  });

  it('locks the code flow after too many wrong codes from all clients', () => {
    for (let i = 0; i < MAX_GLOBAL_CODE_FAILURES; i++) {
      const { requestId } = service.request('Attacker');
      const wrong = shownCode() === '000000' ? '111111' : '000000';
      expectPairingError(() => service.complete(requestId, wrong), 'invalid_pairing_code');
    }
    expectPairingError(() => service.request('Attacker'), 'pairing_locked');
    // QR still works for someone standing at the mirror.
    expect(service.claim(service.getQrSecret().secret, 'Owner').token).toBeTruthy();
  });
});

describe('storage', () => {
  it('stores only the sha256 of the token, mode 0600', () => {
    const { token, deviceId } = service.claim(service.getQrSecret().secret, 'Phone');
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(token.slice(4));
    const records = JSON.parse(raw);
    expect(records).toEqual([
      expect.objectContaining({ id: deviceId, name: 'Phone', tokenHash: hashToken(token) }),
    ]);
    expect(Object.keys(records[0]).sort()).toEqual(['createdAt', 'id', 'lastSeenAt', 'name', 'tokenHash']);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    // No temp files left behind.
    expect(fs.readdirSync(dir)).toEqual(['paired-devices.json']);
  });

  it('survives a restart (new service instance reads the file)', () => {
    const { token } = service.claim(service.getQrSecret().secret, 'Phone');
    const again = makeService();
    expect(again.authenticate(token)?.name).toBe('Phone');
    again.dispose();
  });

  it('a corrupt file is moved aside and treated as empty', () => {
    fs.writeFileSync(file, '{not json');
    const s = makeService();
    expect(s.listDevices()).toEqual([]);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('paired-devices.json.corrupt-'))).toBe(true);
    s.dispose();
  });

  it('updates lastSeenAt at most once a minute', () => {
    vi.useFakeTimers();
    const { token } = service.claim(service.getQrSecret().secret, 'Phone');
    const writes = vi.spyOn(fs, 'renameSync');
    service.authenticate(token);
    service.authenticate(token);
    expect(writes).not.toHaveBeenCalled();
    vi.advanceTimersByTime(61_000);
    service.authenticate(token);
    expect(writes).toHaveBeenCalledTimes(1);
    writes.mockRestore();
  });

  it('caps paired devices', () => {
    for (let i = 0; i < MAX_DEVICES; i++) service.claim(service.getQrSecret().secret, `Phone ${i}`);
    expectPairingError(() => service.claim(service.getQrSecret().secret, 'One too many'), 'too_many_devices');
    expectPairingError(() => service.request('One too many'), 'too_many_devices');
  });
});

describe('rename / revoke', () => {
  it('renames and revokes; a revoked token stops working and emits revoked', () => {
    const { token, deviceId } = service.claim(service.getQrSecret().secret, 'Phone');
    expect(service.renameDevice(deviceId, 'Kitchen phone').name).toBe('Kitchen phone');
    const revoked = vi.fn();
    service.on('revoked', revoked);
    service.revokeDevice(deviceId);
    expect(revoked).toHaveBeenCalledWith(deviceId);
    expect(service.authenticate(token)).toBeNull();
    expectPairingError(() => service.revokeDevice(deviceId), 'not_found');
  });

  it('rejects tokens without the prefix or of absurd length', () => {
    expect(service.authenticate('abc')).toBeNull();
    expect(service.authenticate(`sgp_${'a'.repeat(500)}`)).toBeNull();
  });
});
