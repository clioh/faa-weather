import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import {
  computeSetupStatus,
  createOrientationRouter,
  hasEnrolledUsers,
  isStepCompleted,
  markStepCompleted,
  type ConfigDoc,
} from './setup.js';
import { apiAuthGate } from '../pairing/middleware.js';
import { OrientationPreview } from '../services/orientation.js';

describe('face enrollment detection', () => {
  let dir: string;
  let users: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-face-'));
    users = path.join(dir, 'users');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is false when nothing is enrolled (users dir missing)', () => {
    expect(hasEnrolledUsers(users)).toBe(false);
  });

  it('ignores user dirs without an encodings file', () => {
    fs.mkdirSync(path.join(users, 'alice'), { recursive: true });
    fs.writeFileSync(path.join(users, 'alice', 'metadata.json'), '{}');
    expect(hasEnrolledUsers(users)).toBe(false);
  });

  it('is true when a user enrollment exists, even with an empty encodings list', () => {
    fs.mkdirSync(path.join(users, 'alice'), { recursive: true });
    // Empty-list pickle, what web_server.py writes without face_recognition
    fs.writeFileSync(
      path.join(users, 'alice', 'encodings.pkl'),
      Buffer.from([0x80, 0x04, 0x5d, 0x94, 0x2e])
    );
    expect(hasEnrolledUsers(users)).toBe(true);
  });
});

describe('setup step markers', () => {
  it('is not completed when no marker exists', () => {
    expect(isStepCompleted({}, 'airport')).toBe(false);
    expect(isStepCompleted({ setup: {} }, 'airport')).toBe(false);
    expect(isStepCompleted({ setup: { completed: 'airport' } }, 'airport')).toBe(false);
  });

  it('records steps idempotently and preserves other setup keys', () => {
    const config = { airport: 'KJFK', setup: { other: 1 } };
    markStepCompleted(config, 'airport');
    markStepCompleted(config, 'airport');
    markStepCompleted(config, 'location');
    expect(config.setup).toEqual({ other: 1, completed: ['airport', 'location'] });
    expect(isStepCompleted(config, 'airport')).toBe(true);
    expect(isStepCompleted(config, 'location')).toBe(true);
  });

  it('lets the default airport count as configured once chosen', () => {
    // Regression: KJFK is config/default.yaml's airport, and used to be
    // indistinguishable from "never set".
    const config = { airport: 'KJFK' };
    expect(isStepCompleted(config, 'airport')).toBe(false);
    markStepCompleted(config, 'airport');
    expect(isStepCompleted(config, 'airport')).toBe(true);
  });
});

describe('setup status', () => {
  const ready = {
    configExists: true,
    faceEnrolled: false,
    wifiConfigured: true,
    licenseActivated: true,
  };

  it('ignores non-default values without a completion marker', () => {
    const status = computeSetupStatus(
      { airport: 'KSFO', location: { latitude: 37.6, longitude: -122.4 } },
      ready
    );
    expect(status.airportConfigured).toBe(false);
    expect(status.locationConfigured).toBe(false);
    expect(status.step).toBe('location');
  });

  it('walks wifi, orientation, license, location, airport, face in order', () => {
    expect(computeSetupStatus({}, { ...ready, wifiConfigured: false }).step).toBe('wifi');
    expect(computeSetupStatus({}, { ...ready, configExists: false }).step).toBe('orientation');
    expect(computeSetupStatus({}, { ...ready, licenseActivated: false }).step).toBe('license');
    expect(computeSetupStatus({ setup: { completed: ['location'] } }, ready).step).toBe('airport');
    const both = { setup: { completed: ['location', 'airport'] } };
    expect(computeSetupStatus(both, ready).step).toBe('face');
    const done = computeSetupStatus(both, { ...ready, faceEnrolled: true });
    expect(done).toMatchObject({ step: 'complete', setupComplete: true, needsSetup: false });
  });

  it('needs the orientation step on a new mirror (no config.yaml yet)', () => {
    const fresh = { ...ready, configExists: false, licenseActivated: false };
    const status = computeSetupStatus({ display: { orientation: 'landscape' } }, fresh);
    expect(status.orientationConfigured).toBe(false);
    expect(status.step).toBe('orientation');
  });

  it('counts orientation as configured once saved', () => {
    const saved = {
      display: { orientation: 'portrait-cw' },
      setup: { completed: ['orientation'] },
    };
    const status = computeSetupStatus(saved, { ...ready, licenseActivated: false });
    expect(status.orientationConfigured).toBe(true);
    expect(status.step).toBe('license');
  });

  it('counts an existing mirror with no orientation setting as configured (landscape)', () => {
    // config.yaml written before the step existed: no display block, no marker.
    const legacy = { airport: 'KSFO', setup: { completed: ['location', 'airport'] } };
    const status = computeSetupStatus(legacy, { ...ready, faceEnrolled: true });
    expect(status.orientationConfigured).toBe(true);
    expect(status).toMatchObject({ step: 'complete', needsSetup: false });
  });

  it('returns camelCase fields only', () => {
    const status = computeSetupStatus(null, ready);
    expect(Object.keys(status).sort()).toEqual(
      [
        'airportConfigured',
        'configExists',
        'faceEnrolled',
        'licenseActivated',
        'locationConfigured',
        'needsSetup',
        'orientationConfigured',
        'setupComplete',
        'step',
        'wifiConfigured',
      ].sort()
    );
  });
});

describe('POST /api/setup/orientation', () => {
  const TOKEN = 'sgp_phone';
  const PHONE = { Authorization: `Bearer ${TOKEN}` };
  let stored: ConfigDoc;
  let writes: number;
  let boot: string | null;
  let preview: OrientationPreview;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    stored = { airport: 'KSFO', display: { presence_timeout: 120, orientation: 'landscape' } };
    writes = 0;
    boot = null;
    preview = new OrientationPreview(60_000);
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(express.json());
    app.use(
      '/api',
      apiAuthGate((t) => (t === TOKEN ? { id: 'phone-1' } : null))
    );
    app.use(
      '/api/setup/orientation',
      createOrientationRouter({
        readConfig: () => structuredClone(stored),
        writeConfig: (c) => {
          stored = structuredClone(c);
          writes++;
        },
        preview,
        bootOrientation: () => boot,
      })
    );
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/setup/orientation`;
  });

  afterEach(async () => {
    preview.clear();
    await new Promise<void>((r) => server.close(() => r()));
  });

  // Requests look like a phone on the LAN (forwarded by a loopback proxy), so
  // the pairing token is what lets them through.
  async function call(
    method: string,
    p = '',
    body?: unknown,
    headers: Record<string, string> = PHONE
  ) {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: {
        'X-Forwarded-For': '192.168.1.50',
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it('reports the pre-flashed orientation until one is saved', async () => {
    stored = { airport: 'KSFO' };
    boot = 'portrait-ccw\n';
    expect((await call('GET')).body.orientation).toBe('portrait-ccw');
    stored = { display: { orientation: 'landscape' } };
    expect((await call('GET')).body.orientation).toBe('landscape');
  });

  it('requires a paired phone', async () => {
    const res = await call('POST', '', { orientation: 'portrait-cw', preview: true }, {});
    expect(res.status).toBe(401);
    expect(preview.current()).toBeNull();
  });

  it('applies a preview live without saving', async () => {
    const changes: unknown[] = [];
    preview.on('change', (v) => changes.push(v));
    const res = await call('POST', '', { orientation: 'portrait-ccw', preview: true });
    expect(res).toMatchObject({
      status: 200,
      body: { orientation: 'portrait-ccw', preview: true },
    });
    expect(preview.current()).toBe('portrait-ccw');
    expect(changes).toEqual(['portrait-ccw']);
    expect(writes).toBe(0);
    expect((await call('GET')).body).toEqual({ orientation: 'landscape', preview: 'portrait-ccw' });
  });

  it('saves, marks the step done and ends the preview', async () => {
    await call('POST', '', { orientation: 'portrait-cw', preview: true });
    const res = await call('POST', '', { orientation: 'portrait-cw' });
    expect(res).toMatchObject({
      status: 200,
      body: { orientation: 'portrait-cw', preview: false },
    });
    expect(writes).toBe(1);
    expect(stored.display).toEqual({ presence_timeout: 120, orientation: 'portrait-cw' });
    expect(isStepCompleted(stored, 'orientation')).toBe(true);
    expect(preview.current()).toBeNull();
    expect((await call('GET')).body).toEqual({ orientation: 'portrait-cw', preview: null });
  });

  it('reverts a preview to the saved value', async () => {
    await call('POST', '', { orientation: 'portrait-cw', preview: true });
    const res = await call('DELETE', '/preview');
    expect(res.body).toEqual({ success: true, orientation: 'landscape' });
    expect(preview.current()).toBeNull();
    expect(writes).toBe(0);
  });

  it('stores the legacy value portrait as portrait-cw', async () => {
    await call('POST', '', { orientation: 'portrait' });
    expect(stored.display?.orientation).toBe('portrait-cw');
  });

  it('reads a legacy saved value as portrait-cw', async () => {
    stored.display = { orientation: 'portrait' };
    expect((await call('GET')).body.orientation).toBe('portrait-cw');
  });

  it('rejects unknown orientations', async () => {
    const res = await call('POST', '', { orientation: 'upside-down', preview: true });
    expect(res.status).toBe(400);
    expect(preview.current()).toBeNull();
  });

  it('ends a forgotten preview on its own', () => {
    vi.useFakeTimers();
    try {
      const p = new OrientationPreview(1000);
      p.set('portrait-cw');
      vi.advanceTimersByTime(999);
      expect(p.current()).toBe('portrait-cw');
      vi.advanceTimersByTime(1);
      expect(p.current()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
