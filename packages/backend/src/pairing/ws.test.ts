import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';
import { PairingService } from './service.js';
import { WsHub, WS_CLOSE_REVOKED } from './ws.js';

let dir: string;
let service: PairingService;
let hub: WsHub;
let server: Server;
let url: string;
const open: WebSocket[] = [];

// The test client always connects over loopback. "From the LAN" is simulated
// the way the Vite dev proxy (xfwd) presents a LAN phone: loopback peer plus
// X-Forwarded-For with the phone's address.
const LAN = { 'X-Forwarded-For': '192.168.1.50' };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-ws-'));
  service = new PairingService({
    filePath: path.join(dir, 'paired-devices.json'),
    mirror: () => ({ id: 'm', name: 'Mirror' }),
  });
  hub = new WsHub((t) => service.authenticate(t));
  service.on('pairing', (e) => hub.broadcast('pairing', e));
  service.on('revoked', (id: string) => hub.closeDevice(id));
  server = createServer((_req, res) => res.end());
  hub.attach(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
});

afterEach(async () => {
  for (const ws of open.splice(0)) ws.terminate();
  hub.wss.close();
  await new Promise<void>((r) => server.close(() => r()));
  service.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

function connect(protocols: string[] | undefined, headers: Record<string, string> = {}): WebSocket {
  const ws = new WebSocket(url, protocols, { headers });
  open.push(ws);
  return ws;
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

function rejectedStatus(ws: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.once('open', () => reject(new Error('upgrade should have been rejected')));
    ws.once('error', () => {});
  });
}

function nextMessage(ws: WebSocket): Promise<{ type: string; data: unknown }> {
  return new Promise((resolve) => ws.once('message', (m) => resolve(JSON.parse(m.toString()))));
}

function pairPhone(): { token: string; deviceId: string } {
  return service.claim(service.getQrSecret().secret, 'Phone');
}

describe('WebSocket upgrade auth', () => {
  it('local clients connect without a token', async () => {
    const ws = connect(undefined);
    await opened(ws);
    expect(ws.protocol).toBe('');
  });

  it('LAN clients without a token get 401 before the upgrade', async () => {
    expect(await rejectedStatus(connect(undefined, LAN))).toBe(401);
    expect(await rejectedStatus(connect(['skyglass'], LAN))).toBe(401);
    expect(await rejectedStatus(connect(['skyglass', 'skyglass.token.sgp_wrong'], LAN))).toBe(401);
  });

  it('a forged X-Forwarded-For: 127.0.0.1 through a proxy does not make a client local', async () => {
    expect(await rejectedStatus(connect(undefined, { 'X-Forwarded-For': '127.0.0.1, 192.168.1.50' }))).toBe(401);
  });

  it('a paired phone authenticates with the token subprotocol; the server selects "skyglass" only', async () => {
    const { token } = pairPhone();
    const ws = connect(['skyglass', `skyglass.token.${token}`], LAN);
    await opened(ws);
    expect(ws.protocol).toBe('skyglass');
  });

  it('rejects offers without the "skyglass" protocol (even with a valid token)', async () => {
    const { token } = pairPhone();
    expect(await rejectedStatus(connect([`skyglass.token.${token}`], LAN))).toBe(400);
    expect(await rejectedStatus(connect(['graphql-ws']))).toBe(400);
  });
});

describe('broadcasts', () => {
  it('pairing events reach local sockets only; other events reach every authenticated socket', async () => {
    const { token } = pairPhone();
    const local = connect(undefined);
    const phone = connect(['skyglass', `skyglass.token.${token}`], LAN);
    await Promise.all([opened(local), opened(phone)]);
    // pairPhone() already rotated the QR before the sockets connected; start clean.
    const phoneMessages: string[] = [];
    phone.on('message', (m) => phoneMessages.push(JSON.parse(m.toString()).type));

    const localMsg = nextMessage(local);
    service.request('Second phone');
    const show = await localMsg;
    expect(show.type).toBe('pairing');
    expect(show.data).toMatchObject({ state: 'show', deviceName: 'Second phone' });
    expect((show.data as { code: string }).code).toMatch(/^\d{6}$/);

    const localNext = nextMessage(local);
    const phoneNext = nextMessage(phone);
    hub.broadcast('presence', { present: true });
    expect((await localNext).type).toBe('presence');
    expect((await phoneNext).type).toBe('presence');
    expect(phoneMessages).toEqual(['presence']);
  });

  it('revoking a device closes its sockets and leaves others open', async () => {
    const a = pairPhone();
    const b = pairPhone();
    const wsA = connect(['skyglass', `skyglass.token.${a.token}`], LAN);
    const wsB = connect(['skyglass', `skyglass.token.${b.token}`], LAN);
    await Promise.all([opened(wsA), opened(wsB)]);
    const closed = new Promise<number>((r) => wsA.once('close', (code) => r(code)));
    service.revokeDevice(a.deviceId);
    expect(await closed).toBe(WS_CLOSE_REVOKED);
    expect(wsB.readyState).toBe(WebSocket.OPEN);
    // And it cannot reconnect.
    expect(await rejectedStatus(connect(['skyglass', `skyglass.token.${a.token}`], LAN))).toBe(401);
  });
});
