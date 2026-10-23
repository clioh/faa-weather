/**
 * Registration relay in server.ts (hands-free face capture): guidance from the
 * presence server, 'captured' broadcasts from /progress, and the manual
 * "Take photo now" fallback. A fake presence server stands in for
 * packages/presence/web_server.py; broadcasts are read off WsHub.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../db/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/index.js')>()),
  getMirrorId: () => '00000000-0000-4000-8000-000000000000',
  getMirrorName: () => 'Test Mirror',
}));
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { WsHub } from '../pairing/ws.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-registration-'));
process.env.SKYGLASS_NO_LISTEN = '1';
process.env.SKYGLASS_PAIRED_DEVICES_FILE = path.join(tmp, 'paired-devices.json');
process.env.SKYGLASS_INTERNAL_TOKEN_FILE = path.join(tmp, 'internal-token');

// Fake presence server: must be listening before server.ts reads SKYGLASS_ADMIN_URL.
const captureBodies: unknown[] = [];
let captureResult: Record<string, unknown> = { success: true, samples_captured: 1 };
const presence = express();
presence.use(express.json());
presence.post('/api/start', (_req, res) => res.json({ enrollmentToken: 'tok-1', expiresAt: Date.now() + 60_000 }));
presence.post('/api/reset', (_req, res) => res.json({ success: true }));
presence.post('/api/capture', (req, res) => {
  captureBodies.push({ body: req.body, contentType: req.headers['content-type'], internal: req.headers['x-skyglass-internal'] });
  res.json(captureResult);
});
const presenceServer: Server = presence.listen(0, '127.0.0.1');
await new Promise<void>((r) => presenceServer.once('listening', () => r()));
process.env.SKYGLASS_ADMIN_URL = `http://127.0.0.1:${(presenceServer.address() as AddressInfo).port}`;

const broadcastSpy = vi.spyOn(WsHub.prototype, 'broadcast');
const { app } = await import('../server.js');
const { getInternalToken } = await import('../services/internal-token.js');

let server: Server;
let base: string;

beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => presenceServer.close(() => r()));
  fs.rmSync(tmp, { recursive: true, force: true });
});

type Registration = Record<string, unknown> & { action?: string };

function registrationBroadcasts(): Registration[] {
  return broadcastSpy.mock.calls.filter(([type]) => type === 'registration').map(([, data]) => data as Registration);
}

function post(p: string, body: unknown, internal = false) {
  return fetch(`${base}${p}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(internal ? { 'X-SkyGlass-Internal': getInternalToken() } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function startSession(): Promise<Registration> {
  const res = await post('/api/registration/start', { userId: 'pilot-1', userName: 'Clio' });
  expect(res.status).toBe(200);
  return (await res.json()) as Registration;
}

beforeEach(async () => {
  await post('/api/registration/cancel', {});
  broadcastSpy.mockClear();
  captureBodies.length = 0;
  captureResult = { success: true, samples_captured: 1 };
});

describe('POST /api/registration/guidance', () => {
  it('needs the internal token', async () => {
    await startSession();
    const res = await post('/api/registration/guidance', { reason: 'hold', holdMs: 1000 });
    expect(res.status).toBe(401);
    expect(registrationBroadcasts().some((b) => b.action === 'guidance')).toBe(false);
  });

  it('validates the reason and holdMs', async () => {
    await startSession();
    for (const body of [
      { reason: 'smile_more', holdMs: 0 },
      { reason: 'hold', holdMs: -1 },
      { reason: 'hold', holdMs: 10001 },
      { reason: 'hold' },
    ]) {
      const res = await post('/api/registration/guidance', body, true);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('stores and broadcasts the hint during a session', async () => {
    const started = await startSession();
    expect(started.guidance).toBeNull();

    const res = await post('/api/registration/guidance', { reason: 'hold', holdMs: 1000 }, true);
    expect(res.status).toBe(200);
    const sent = registrationBroadcasts().filter((b) => b.action === 'guidance');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      active: true,
      guidance: { reason: 'hold', holdMs: 1000 },
      currentInstruction: 'Look straight at the mirror',
    });

    const state = (await (await fetch(`${base}/api/registration`)).json()) as Registration;
    expect(state.guidance).toEqual({ reason: 'hold', holdMs: 1000 });
  });

  it('is ignored (200, no broadcast) without an active session', async () => {
    const res = await post('/api/registration/guidance', { reason: 'no_face', holdMs: 0 }, true);
    expect(res.status).toBe(200);
    expect(registrationBroadcasts()).toEqual([]);
    const state = (await (await fetch(`${base}/api/registration`)).json()) as Registration;
    expect(state.guidance).toBeNull();
  });

  it('is cleared when the session ends', async () => {
    await startSession();
    await post('/api/registration/guidance', { reason: 'too_far', holdMs: 0 }, true);
    await post('/api/registration/cancel', {});
    const cancelled = registrationBroadcasts().find((b) => b.action === 'cancelled');
    expect(cancelled?.guidance).toBeNull();
  });
});

describe('POST /api/registration/progress', () => {
  it("broadcasts 'captured' only when samplesCollected increased", async () => {
    await startSession();
    await post('/api/registration/progress', { samplesCollected: 1, samplesNeeded: 5 }, true);
    await post('/api/registration/progress', { samplesCollected: 1, samplesNeeded: 5 }, true);
    await post('/api/registration/progress', { samplesNeeded: 5 }, true);
    await post('/api/registration/progress', { samplesCollected: 2, samplesNeeded: 5 }, true);
    const actions = registrationBroadcasts()
      .filter((b) => b.action === 'captured' || b.action === 'progress')
      .map((b) => `${b.action}:${b.samplesCollected}:${b.currentInstruction}`);
    expect(actions).toEqual([
      'captured:1:Turn your head slightly left',
      'progress:1:Turn your head slightly left',
      'progress:1:Turn your head slightly left',
      'captured:2:Turn your head slightly right',
    ]);
  });
});

describe('POST /api/registration/capture (manual fallback)', () => {
  it("starts the countdown, asks presence to wait 3 s, and leaves 'captured' to /progress", async () => {
    await startSession();
    const t0 = Date.now();
    const res = await post('/api/registration/capture', {});
    expect(Date.now() - t0).toBeLessThan(2000); // no backend sleep
    expect(await res.json()).toEqual({ success: true, samplesCollected: 1, complete: false });

    expect(captureBodies).toEqual([{ body: { delay: 3 }, contentType: 'application/json', internal: getInternalToken() }]);
    expect(registrationBroadcasts().map((b) => b.action)).toEqual(['started', 'capture-start']);
  });

  it('passes a presence failure through', async () => {
    await startSession();
    captureResult = { success: false, message: 'No face detected' };
    const res = await post('/api/registration/capture', {});
    expect(await res.json()).toEqual({ success: false, error: 'No face detected' });
  });

  it('refuses without an active session', async () => {
    const res = await post('/api/registration/capture', {});
    expect(res.status).toBe(400);
    expect(captureBodies).toEqual([]);
  });
});
