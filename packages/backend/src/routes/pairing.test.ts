import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { PairingService, type PairingEvent } from '../pairing/service.js';
import { apiAuthGate } from '../pairing/middleware.js';
import { createPairingRouter, createPairingLimiters, withPairSecret } from './pairing.js';

let dir: string;
let service: PairingService;
let server: Server;
let base: string;
let events: PairingEvent[];

// Requests come from loopback; LAN callers are simulated as if forwarded by
// the Vite dev proxy (loopback peer + X-Forwarded-For), which trust proxy
// 'loopback' resolves to the LAN address.
const LAN = { 'X-Forwarded-For': '192.168.1.50' };

async function startApp(limiters: express.RequestHandler[] = []): Promise<void> {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  app.use('/api', apiAuthGate((t) => service.authenticate(t)));
  app.use(
    '/api/pairing',
    createPairingRouter({ service, limiters, connectUrl: () => 'skyglass://connect?host=10.0.0.5&port=3001' })
  );
  app.get('/api/config', (_req, res) => res.json({ ok: true }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-pairing-routes-'));
  service = new PairingService({
    filePath: path.join(dir, 'paired-devices.json'),
    mirror: () => ({ id: 'mirror-1', name: 'Hall Mirror' }),
  });
  events = [];
  service.on('pairing', (e: PairingEvent) => events.push(e));
  await startApp();
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  service.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, p: string, { headers = {}, body }: { headers?: Record<string, string>; body?: unknown } = {}) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

const bearer = (token: string) => ({ ...LAN, Authorization: `Bearer ${token}` });

describe('pairing routes', () => {
  it('QR flow: local gets the link, the LAN phone claims it, the token works', async () => {
    const qr = await call('GET', '/api/pairing/qr');
    expect(qr.status).toBe(200);
    expect(qr.body.url).toMatch(/^skyglass:\/\/connect\?host=10\.0\.0\.5&port=3001&pair=[A-Za-z0-9_-]{22}$/);
    expect(typeof qr.body.expiresAt).toBe('number');
    const secret = new URL(qr.body.url.replace('skyglass://', 'http://x/')).searchParams.get('pair')!;

    expect((await call('GET', '/api/config', { headers: LAN })).body).toEqual({
      error: 'pairing_required',
      message: "This phone isn't paired with this mirror.",
    });

    const claim = await call('POST', '/api/pairing/claim', { headers: LAN, body: { secret, deviceName: 'iPhone' } });
    expect(claim.status).toBe(200);
    expect(claim.body).toMatchObject({ deviceId: expect.any(String), token: expect.stringMatching(/^sgp_/), mirror: { id: 'mirror-1', name: 'Hall Mirror' } });

    expect((await call('GET', '/api/config', { headers: bearer(claim.body.token) })).status).toBe(200);
    expect((await call('GET', '/api/pairing/whoami', { headers: bearer(claim.body.token) })).body).toEqual({
      kind: 'device',
      deviceId: claim.body.deviceId,
    });

    // Single use.
    const again = await call('POST', '/api/pairing/claim', { headers: LAN, body: { secret, deviceName: 'Other' } });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('invalid_pairing_code');
  });

  it('GET /api/pairing/qr is local only (a paired phone gets 403, a stranger 401)', async () => {
    const { token } = service.claim(service.getQrSecret().secret, 'Phone');
    expect((await call('GET', '/api/pairing/qr', { headers: LAN })).status).toBe(401);
    expect((await call('GET', '/api/pairing/qr', { headers: bearer(token) })).status).toBe(403);
  });

  it('code flow over HTTP: request, wrong code, right code', async () => {
    const req = await call('POST', '/api/pairing/request', { headers: LAN, body: { deviceName: 'Pixel 9' } });
    expect(req.status).toBe(200);
    const show = events.find((e) => e.state === 'show');
    if (!show || show.state !== 'show') throw new Error('no show event');
    const wrong = show.code === '000000' ? '111111' : '000000';
    const bad = await call('POST', '/api/pairing/complete', { headers: LAN, body: { requestId: req.body.requestId, code: wrong } });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: 'invalid_pairing_code', attemptsRemaining: 4 });
    const ok = await call('POST', '/api/pairing/complete', { headers: LAN, body: { requestId: req.body.requestId, code: show.code } });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toMatch(/^sgp_/);
  });

  it('validates bodies (device name, code format)', async () => {
    for (const deviceName of ['', 'x'.repeat(61), 'bad\nname', 'rtl‮override']) {
      expect((await call('POST', '/api/pairing/request', { headers: LAN, body: { deviceName } })).status).toBe(400);
    }
    expect((await call('POST', '/api/pairing/request', { headers: LAN, body: { deviceName: 'Clio’s iPhone 📱' } })).status).toBe(200);
    expect((await call('POST', '/api/pairing/complete', { headers: LAN, body: { requestId: 'x', code: '12ab56' } })).status).toBe(400);
  });

  it('devices: list marks this phone, rename, revoke (204) and the token dies', async () => {
    const a = service.claim(service.getQrSecret().secret, 'Phone A');
    const b = service.claim(service.getQrSecret().secret, 'Phone B');
    const list = await call('GET', '/api/pairing/devices', { headers: bearer(a.token) });
    expect(list.body.devices).toHaveLength(2);
    expect(list.body.devices.find((d: { id: string }) => d.id === a.deviceId).current).toBe(true);
    expect(list.body.devices.find((d: { id: string }) => d.id === b.deviceId).current).toBe(false);
    expect(JSON.stringify(list.body)).not.toContain('tokenHash');

    const renamed = await call('PATCH', `/api/pairing/devices/${a.deviceId}`, { headers: bearer(a.token), body: { name: 'Kitchen' } });
    expect(renamed.body.device).toMatchObject({ id: a.deviceId, name: 'Kitchen', current: true });

    expect((await call('DELETE', `/api/pairing/devices/${b.deviceId}`, { headers: bearer(a.token) })).status).toBe(204);
    expect((await call('GET', '/api/config', { headers: bearer(b.token) })).status).toBe(401);
    expect((await call('DELETE', `/api/pairing/devices/${b.deviceId}`, { headers: bearer(a.token) })).status).toBe(404);
    // Unpair this phone.
    expect((await call('DELETE', `/api/pairing/devices/${a.deviceId}`, { headers: bearer(a.token) })).status).toBe(204);
    expect((await call('GET', '/api/pairing/whoami', { headers: bearer(a.token) })).status).toBe(401);
  });

  it('DELETE /devices/self: a phone revokes only its own token; others are untouched', async () => {
    const a = service.claim(service.getQrSecret().secret, 'Phone A');
    const b = service.claim(service.getQrSecret().secret, 'Phone B');
    const revoked: string[] = [];
    service.on('revoked', (id: string) => revoked.push(id));

    expect((await call('DELETE', '/api/pairing/devices/self', { headers: bearer(a.token) })).status).toBe(204);
    expect(revoked).toEqual([a.deviceId]);
    expect((await call('GET', '/api/pairing/whoami', { headers: bearer(a.token) })).status).toBe(401);
    // The revoked token can't call it again.
    expect((await call('DELETE', '/api/pairing/devices/self', { headers: bearer(a.token) })).status).toBe(401);
    expect((await call('GET', '/api/config', { headers: bearer(b.token) })).status).toBe(200);
    expect(service.listDevices().map((d) => d.id)).toEqual([b.deviceId]);

    // The mirror itself has no device record to revoke; strangers are refused by the gate.
    const local = await call('DELETE', '/api/pairing/devices/self');
    expect(local.status).toBe(400);
    expect(local.body.error).toBe('not_a_paired_phone');
    expect((await call('DELETE', '/api/pairing/devices/self', { headers: LAN })).status).toBe(401);
    expect(service.listDevices()).toHaveLength(1);
  });

  it('device management needs a trusted caller', async () => {
    expect((await call('GET', '/api/pairing/devices', { headers: LAN })).status).toBe(401);
    expect((await call('GET', '/api/pairing/whoami', { headers: LAN })).status).toBe(401);
    expect((await call('GET', '/api/pairing/whoami')).body).toEqual({ kind: 'local', deviceId: null });
  });

  it('rate limits claim/request/complete per client (shared budget)', async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await startApp(createPairingLimiters());
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await call('POST', '/api/pairing/claim', { headers: LAN, body: { secret: 'x', deviceName: 'p' } })).status);
      statuses.push((await call('POST', '/api/pairing/complete', { headers: LAN, body: { requestId: 'x', code: '123456' } })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // Another client still has its own budget.
    const other = await call('POST', '/api/pairing/claim', { headers: { 'X-Forwarded-For': '192.168.1.51' }, body: { secret: 'x', deviceName: 'p' } });
    expect(other.status).toBe(400);
  });
});

describe('withPairSecret', () => {
  it('appends to links with or without a query', () => {
    expect(withPairSecret('exp://10.0.0.5:8081/--/connect?host=10.0.0.5&port=3001', 'abc')).toBe(
      'exp://10.0.0.5:8081/--/connect?host=10.0.0.5&port=3001&pair=abc'
    );
    expect(withPairSecret('skyglass://connect', 'abc')).toBe('skyglass://connect?pair=abc');
  });
});
