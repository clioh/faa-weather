/**
 * Deny-by-default over the REAL route stack of server.ts.
 *
 * Imports server.ts (SKYGLASS_NO_LISTEN=1: nothing starts), walks every
 * route on the app and its mounted routers, and calls each one as an
 * unauthenticated LAN client. Anything not in PUBLIC_API_ROUTES must answer
 * 401 pairing_required. A route added anywhere under /api without being
 * allowlisted keeps this test green only if the gate protects it; a route
 * registered before the gate, or a new public route, fails it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// The database is opened by start(), which SKYGLASS_NO_LISTEN skips; stub the
// two identity reads that the public discovery endpoint needs.
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-deny-'));
process.env.SKYGLASS_NO_LISTEN = '1';
process.env.SKYGLASS_PAIRED_DEVICES_FILE = path.join(tmp, 'paired-devices.json');
process.env.SKYGLASS_SCHEDULE_FILE = path.join(tmp, 'flight-schedule.xlsx');
process.env.SKYGLASS_INTERNAL_TOKEN_FILE = path.join(tmp, 'internal-token');

// Express 5 layers do not keep their mount path; record it as routers are mounted.
type RouterFn = { stack?: Layer[]; __mountPaths?: string[] };
interface Layer {
  handle: RouterFn & ((...args: unknown[]) => unknown);
  route?: { path: string | string[]; methods: Record<string, boolean> };
  name?: string;
}
const RouterProto = (
  express.Router as unknown as { prototype: { use: (...args: unknown[]) => unknown } }
).prototype;
const realUse = RouterProto.use;
RouterProto.use = function patchedUse(this: unknown, ...args: unknown[]) {
  const mount = typeof args[0] === 'string' ? args[0] : '/';
  for (const fn of args.flat()) {
    if (typeof fn === 'function' && Array.isArray((fn as RouterFn).stack)) {
      ((fn as RouterFn).__mountPaths ??= []).push(mount);
    }
  }
  return realUse.apply(this, args);
};

const { app } = await import('../server.js');
const { PUBLIC_API_ROUTES, isPublicApiRoute } = await import('./middleware.js');
RouterProto.use = realUse;

interface FoundRoute {
  method: string;
  path: string;
  index: number;
}

const join = (a: string, b: string) =>
  `${a.replace(/\/$/, '')}/${b.replace(/^\//, '')}`.replace(/\/$/, '') || '/';

function collect(stack: Layer[], prefix: string, out: FoundRoute[], topIndex?: number): void {
  stack.forEach((layer, i) => {
    const index = topIndex ?? i;
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) {
        for (const method of Object.keys(layer.route.methods)) {
          if (method === '_all') continue;
          out.push({ method: method.toUpperCase(), path: join(prefix, p), index });
        }
      }
    } else if (Array.isArray(layer.handle.stack)) {
      for (const mount of layer.handle.__mountPaths ?? ['/']) {
        collect(layer.handle.stack, join(prefix, mount), out, index);
      }
    }
  });
}

/** '/devices/:id' → '/devices/x1'; Express 5 '{/:opt}' and '*splat' too. */
function concrete(p: string): string {
  return p
    .replace(/\{([^}]*)\}/g, '$1')
    .replace(/:\w+/g, 'x1')
    .replace(/\*\w+/g, 'x1/x2');
}

const appStack = (app as unknown as { router: { stack: Layer[] } }).router.stack;
const routes: FoundRoute[] = [];
collect(appStack, '', routes);
const apiRoutes = routes.filter((r) => r.path === '/api' || r.path.startsWith('/api/'));
const gateIndex = appStack.findIndex((l) => l.name === 'apiAuthGateMiddleware');

let server: Server;
let base: string;

beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('deny by default (server.ts route stack)', () => {
  it('found the routes and the gate', () => {
    expect(gateIndex).toBeGreaterThanOrEqual(0);
    expect(apiRoutes.length).toBeGreaterThan(60);
    // Sanity: the walker sees nested routers with their mount paths.
    const seen = new Set(apiRoutes.map((r) => `${r.method} ${r.path}`));
    for (const r of [
      'GET /api/aviation/metar/:icao',
      'DELETE /api/pairing/devices/:id',
      'GET /api/license/status',
      'GET /api/health',
    ]) {
      expect(seen.has(r), r).toBe(true);
    }
  });

  it('the gate is registered before every /api route (checked before sending any request)', () => {
    const early = apiRoutes.filter((r) => r.index < gateIndex);
    expect(early).toEqual([]);
  });

  it('every allowlisted route exists', () => {
    for (const pub of PUBLIC_API_ROUTES) {
      expect(
        apiRoutes.some((r) => r.method === pub.method && r.path === `/api${pub.path}`),
        `${pub.method} ${pub.path}`
      ).toBe(true);
    }
  });

  it('every non-allowlisted /api route answers 401 pairing_required to an unauthenticated LAN client', async () => {
    const failures: string[] = [];
    for (const r of apiRoutes) {
      if (isPublicApiRoute(r.method, r.path.slice(4))) continue;
      const url = `${base}${concrete(r.path)}`;
      // Loopback peer + XFF = a LAN client forwarded by the Vite dev proxy;
      // trust proxy 'loopback' resolves req.ip to 192.168.1.50.
      const res = await fetch(url, {
        method: r.method,
        headers: { 'X-Forwarded-For': '192.168.1.50', 'Content-Type': 'application/json' },
        body: r.method === 'GET' || r.method === 'HEAD' ? undefined : '{}',
      });
      const body = r.method === 'HEAD' ? null : await res.json().catch(() => null);
      if (res.status !== 401 || (body && body.error !== 'pairing_required')) {
        failures.push(`${r.method} ${r.path} -> ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('unknown /api paths and case/trailing-slash variants are denied too', async () => {
    for (const p of [
      '/api/does-not-exist',
      '/api',
      '/API/config',
      '/api/config/',
      '/api/%68ealth/../config',
    ]) {
      const res = await fetch(`${base}${p}`, { headers: { 'X-Forwarded-For': '192.168.1.50' } });
      expect(res.status, p).toBe(401);
    }
  });

  it('a route added to the app later is protected automatically', async () => {
    app.get('/api/zz-added-later', (_req, res) => res.json({ leaked: true }));
    const res = await fetch(`${base}/api/zz-added-later`, {
      headers: { 'X-Forwarded-For': '192.168.1.50' },
    });
    expect(res.status).toBe(401);
  });

  it('public routes stay reachable for an unpaired phone', async () => {
    const lan = { 'X-Forwarded-For': '192.168.1.50', 'Content-Type': 'application/json' };
    expect((await fetch(`${base}/api/health`, { headers: lan })).status).toBe(200);
    const claim = await fetch(`${base}/api/pairing/claim`, {
      method: 'POST',
      headers: lan,
      body: '{"secret":"x","deviceName":"p"}',
    });
    expect(claim.status).toBe(400);
    expect((await claim.json()).error).toBe('invalid_pairing_code');
  });

  it('a local caller (kiosk) still reaches protected routes', async () => {
    const res = await fetch(`${base}/api/pairing/whoami`);
    expect(await res.json()).toEqual({ kind: 'local', deviceId: null });
    expect((await fetch(`${base}/api/config`)).status).toBe(200);
  });
});

describe('public responses stay minimal', () => {
  it('GET /api/discovery reveals only the mirror identity to an unpaired LAN client', async () => {
    const res = await fetch(`${base}/api/discovery`, {
      headers: { 'X-Forwarded-For': '192.168.1.50' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Adding a field here is a privacy decision: anything the owner configured
    // (airport, location, calendars) or network details must stay behind pairing.
    expect(Object.keys(body).sort()).toEqual([
      'mirrorId',
      'name',
      'pairingRequired',
      'setupComplete',
      'version',
    ]);
    expect(body.pairingRequired).toBe(true);
  });
});
