import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// Throwaway database and paired-phones file, set before the modules load.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-invites-'));
process.env.SKYGLASS_DB_FILE = path.join(dir, 'skyglass.db');
process.env.SKYGLASS_PAIRED_DEVICES_FILE = path.join(dir, 'paired-devices.json');

vi.mock('../server.js', () => ({ broadcast: vi.fn() }));

const { initDatabase, setUserInvite } = await import('../db/index.js');
const { pairingService } = await import('../pairing/index.js');
const { apiAuthGate } = await import('../pairing/middleware.js');
const { hashToken } = await import('../pairing/service.js');
const { default: usersRoutes } = await import('./users.js');
const { createInvitesRouter } = await import('./invites.js');

// LAN callers, as the Vite dev proxy forwards them (see pairing.test.ts).
const LAN = { 'X-Forwarded-For': '192.168.1.50' };
const bearer = (token: string) => ({ ...LAN, Authorization: `Bearer ${token}` });
const tile = {
  instanceId: 't1',
  moduleId: 'metar',
  position: { x: 0, y: 0 },
  size: 'medium',
  config: {},
};

let server: Server;
let base: string;

async function call(
  method: string,
  p: string,
  { headers = {}, body }: { headers?: Record<string, string>; body?: unknown } = {}
) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

/** Pair a phone through the QR flow and return its bearer token. */
function pairPhone(name: string): string {
  return pairingService.claim(pairingService.getQrSecret().secret, name).token;
}

beforeAll(async () => {
  initDatabase();
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  app.use(
    '/api',
    apiAuthGate((t) => pairingService.authenticate(t))
  );
  app.use('/api/users', usersRoutes);
  app.use('/api/invites', createInvitesRouter({ service: pairingService, limiters: [] }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  pairingService.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('adding and inviting another person', () => {
  it('runs the whole flow: add, set up, invite, accept, then the layout is theirs', async () => {
    const owner = pairPhone('Owner iPhone');
    expect(
      (
        await call('POST', '/api/users', {
          headers: bearer(owner),
          body: { id: 'owner', name: 'Clio' },
        })
      ).status
    ).toBe(200);

    // Added from the owner's phone: not joined yet, and the owner may set them up.
    const added = await call('POST', '/api/users', {
      headers: bearer(owner),
      body: { id: 'sam', name: 'Sam', invited: true },
    });
    expect(added.status).toBe(200);
    let people = (await call('GET', '/api/users', { headers: bearer(owner) })).body as {
      id: string;
      joined: boolean;
    }[];
    expect(people.find((p) => p.id === 'sam')?.joined).toBe(false);
    expect(people.find((p) => p.id === 'owner')?.joined).toBe(true);
    expect(
      (
        await call('PUT', '/api/users/sam/layout', {
          headers: bearer(owner),
          body: { modules: [tile] },
        })
      ).status
    ).toBe(200);

    // Invite: a single-use token, not usable by anyone else's phone twice.
    const invite = await call('POST', '/api/users/sam/invite', { headers: bearer(owner) });
    expect(invite.status).toBe(200);
    expect(invite.body.token).toMatch(/^sgi_[A-Za-z0-9_-]{32}$/);
    expect(invite.body.mirrorId).toBeTruthy();
    people = (await call('GET', '/api/users', { headers: bearer(owner) })).body;
    expect(
      (people.find((p) => p.id === 'sam') as { inviteExpiresAt: string | null }).inviteExpiresAt
    ).toBeTruthy();

    // Sam's phone accepts without being paired first.
    const accepted = await call('POST', '/api/invites/claim', {
      headers: LAN,
      body: { token: invite.body.token, deviceName: 'Sam iPhone' },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.user).toEqual({ id: 'sam', name: 'Sam' });
    const sam = accepted.body.token as string;
    expect(
      (await call('GET', '/api/users/sam/layout', { headers: bearer(sam) })).body.modules
    ).toEqual([tile]);

    // Used up.
    const again = await call('POST', '/api/invites/claim', {
      headers: LAN,
      body: { token: invite.body.token, deviceName: 'Other' },
    });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('invalid_invite');

    // Now only Sam's phone edits Sam's layout; no new invites for Sam.
    expect(
      (
        await call('PUT', '/api/users/sam/layout', {
          headers: bearer(owner),
          body: { modules: [] },
        })
      ).status
    ).toBe(403);
    expect(
      (await call('PUT', '/api/users/sam/layout', { headers: bearer(sam), body: { modules: [] } }))
        .status
    ).toBe(200);
    expect(
      (
        await call('PUT', '/api/users/owner/layout', {
          headers: bearer(sam),
          body: { modules: [] },
        })
      ).status
    ).toBe(403);
    expect((await call('POST', '/api/users/sam/invite', { headers: bearer(owner) })).status).toBe(
      409
    );
  });

  it('rejects an expired invite, and a newer invite replaces the old one', async () => {
    const owner = pairPhone('Owner iPad');
    await call('POST', '/api/users', {
      headers: bearer(owner),
      body: { id: 'kim', name: 'Kim', invited: true },
    });

    const first = (await call('POST', '/api/users/kim/invite', { headers: bearer(owner) })).body
      .token as string;
    const second = (await call('POST', '/api/users/kim/invite', { headers: bearer(owner) })).body
      .token as string;
    expect(
      (
        await call('POST', '/api/invites/claim', {
          headers: LAN,
          body: { token: first, deviceName: 'Kim' },
        })
      ).status
    ).toBe(400);

    setUserInvite('kim', hashToken(second), new Date(Date.now() - 1000).toISOString());
    expect(
      (
        await call('POST', '/api/invites/claim', {
          headers: LAN,
          body: { token: second, deviceName: 'Kim' },
        })
      ).status
    ).toBe(400);
  });

  it('ties a phone paired before invites existed to its person on first edit', async () => {
    // Joined person whose phone was paired without saying who it belongs to.
    const legacy = pairPhone('Old iPhone');
    expect(
      (await call('POST', '/api/users', { headers: LAN, body: { id: 'alex', name: 'Alex' } }))
        .status
    ).toBe(401);
    const local = await call('POST', '/api/users', { body: { id: 'alex', name: 'Alex' } }); // the mirror itself
    expect(local.status).toBe(200);
    expect(
      (
        await call('PUT', '/api/users/alex/layout', {
          headers: bearer(legacy),
          body: { modules: [] },
        })
      ).status
    ).toBe(200);
    // Now tied to Alex, so another joined person's layout is off limits.
    expect(
      (
        await call('PUT', '/api/users/owner/layout', {
          headers: bearer(legacy),
          body: { modules: [] },
        })
      ).status
    ).toBe(403);
  });
});
