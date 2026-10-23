import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { IncomingHttpHeaders } from 'http';
import { resetInternalTokenCache, getInternalToken } from '../services/internal-token.js';
import {
  classify,
  effectiveClientIp,
  isLoopbackAddress,
  isLoopbackHost,
  isLoopbackOrigin,
  type DeviceAuthenticator,
} from './trust.js';
import { classifyExpressRequest } from './middleware.js';

let dir: string;
const prevTokenFile = process.env.SKYGLASS_INTERNAL_TOKEN_FILE;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-trust-'));
  process.env.SKYGLASS_INTERNAL_TOKEN_FILE = path.join(dir, 'internal-token');
  resetInternalTokenCache();
});

afterAll(() => {
  if (prevTokenFile === undefined) delete process.env.SKYGLASS_INTERNAL_TOKEN_FILE;
  else process.env.SKYGLASS_INTERNAL_TOKEN_FILE = prevTokenFile;
  resetInternalTokenCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

const DEVICE_TOKEN = 'sgp_validtoken';
const devices: DeviceAuthenticator = (t) => (t === DEVICE_TOKEN ? { id: 'phone-1' } : null);

// The same Express settings as server.ts.
const app = express();
app.set('trust proxy', 'loopback');

/** A request as Express sees it, from socket peer `remote`. */
function fakeReq(remote: string, headers: IncomingHttpHeaders = {}): express.Request {
  const req = Object.create(app.request) as express.Request & { app: express.Application };
  Object.defineProperty(req, 'headers', {
    value: { host: 'localhost:3001', ...headers },
    writable: true,
  });
  Object.defineProperty(req, 'socket', { value: { remoteAddress: remote }, writable: true });
  Object.defineProperty(req, 'connection', { value: { remoteAddress: remote }, writable: true });
  req.app = app;
  return req;
}

const kindOf = (remote: string, headers: IncomingHttpHeaders = {}) =>
  classifyExpressRequest(fakeReq(remote, headers), devices).kind;

describe('loopback helpers', () => {
  it('recognises the loopback forms Node reports', () => {
    for (const ip of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', '[::1]']) {
      expect(isLoopbackAddress(ip), ip).toBe(true);
    }
    for (const ip of [
      '192.168.1.20',
      '::ffff:192.168.1.20',
      '10.0.0.1',
      'fe80::1',
      '127.0.0.1.evil',
      '',
      undefined,
    ]) {
      expect(isLoopbackAddress(ip), String(ip)).toBe(false);
    }
  });

  it('accepts only loopback Host names (no DNS rebinding)', () => {
    for (const h of [
      'localhost:3001',
      '127.0.0.1:3001',
      '[::1]:3001',
      'LOCALHOST',
      'mirror.localhost:5173',
    ]) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
    for (const h of [
      'evil.example:3001',
      '192.168.1.20:3001',
      'skyglass.local:3001',
      '',
      undefined,
    ]) {
      expect(isLoopbackHost(h), String(h)).toBe(false);
    }
  });

  it('accepts no Origin or a loopback Origin', () => {
    expect(isLoopbackOrigin(undefined)).toBe(true);
    expect(isLoopbackOrigin('http://localhost:5173')).toBe(true);
    expect(isLoopbackOrigin('http://127.0.0.1:3001')).toBe(true);
    expect(isLoopbackOrigin('https://evil.example')).toBe(false);
    expect(isLoopbackOrigin('null')).toBe(false);
    expect(isLoopbackOrigin('http://192.168.1.20:5173')).toBe(false);
  });
});

describe('classification with trust proxy: loopback (Express req.ip)', () => {
  it('direct loopback clients are local (IPv4, IPv6, IPv4-mapped)', () => {
    expect(kindOf('127.0.0.1')).toBe('local');
    expect(kindOf('::1')).toBe('local');
    expect(kindOf('::ffff:127.0.0.1')).toBe('local');
  });

  it('a LAN client sending X-Forwarded-For: 127.0.0.1 directly is NOT local', () => {
    expect(fakeReq('192.168.1.50', { 'x-forwarded-for': '127.0.0.1' }).ip).toBe('192.168.1.50');
    expect(kindOf('192.168.1.50', { 'x-forwarded-for': '127.0.0.1' })).toBe('none');
    expect(kindOf('::ffff:192.168.1.50', { 'x-forwarded-for': '::1' })).toBe('none');
  });

  it('a LAN client via a loopback proxy (Vite xfwd) is NOT local', () => {
    expect(fakeReq('127.0.0.1', { 'x-forwarded-for': '192.168.1.50' }).ip).toBe('192.168.1.50');
    expect(kindOf('127.0.0.1', { 'x-forwarded-for': '192.168.1.50' })).toBe('none');
    expect(kindOf('::1', { 'x-forwarded-for': '::ffff:192.168.1.50' })).toBe('none');
  });

  it('a LAN client forging XFF through the loopback proxy is still NOT local (rightmost untrusted hop)', () => {
    // Client sent "X-Forwarded-For: 127.0.0.1", the proxy appended its real address.
    expect(fakeReq('127.0.0.1', { 'x-forwarded-for': '127.0.0.1, 192.168.1.50' }).ip).toBe(
      '192.168.1.50'
    );
    expect(kindOf('127.0.0.1', { 'x-forwarded-for': '127.0.0.1, 192.168.1.50' })).toBe('none');
  });

  it('a local browser via the loopback proxy stays local', () => {
    expect(kindOf('127.0.0.1', { 'x-forwarded-for': '::1' })).toBe('local');
    expect(kindOf('::1', { 'x-forwarded-for': '127.0.0.1' })).toBe('local');
  });

  it('loopback with a foreign Host or Origin is NOT local', () => {
    expect(kindOf('127.0.0.1', { host: 'rebind.evil.example:3001' })).toBe('none');
    expect(kindOf('127.0.0.1', { origin: 'https://evil.example' })).toBe('none');
    expect(kindOf('127.0.0.1', { origin: 'http://localhost:5173' })).toBe('local');
  });

  it('internal token from anywhere is internal; a wrong one is not', () => {
    expect(kindOf('192.168.1.50', { 'x-skyglass-internal': getInternalToken() })).toBe('internal');
    expect(kindOf('192.168.1.50', { 'x-skyglass-internal': 'f'.repeat(64) })).toBe('none');
  });

  it('device bearer token from anywhere is device; an invalid one is none', () => {
    const req = fakeReq('192.168.1.50', { authorization: `Bearer ${DEVICE_TOKEN}` });
    expect(classifyExpressRequest(req, devices)).toEqual({ kind: 'device', deviceId: 'phone-1' });
    expect(kindOf('192.168.1.50', { authorization: 'Bearer sgp_wrong' })).toBe('none');
    expect(kindOf('192.168.1.50', { authorization: DEVICE_TOKEN })).toBe('none'); // no Bearer scheme
  });

  it('an invalid bearer does not take local trust away from the kiosk', () => {
    expect(kindOf('127.0.0.1', { authorization: 'Bearer junk' })).toBe('local');
  });
});

describe('effectiveClientIp (WebSocket upgrades) matches Express req.ip', () => {
  const cases: [string, string | undefined][] = [
    ['127.0.0.1', undefined],
    ['::1', undefined],
    ['::ffff:127.0.0.1', undefined],
    ['192.168.1.50', '127.0.0.1'],
    ['192.168.1.50', '127.0.0.1, ::1'],
    ['127.0.0.1', '192.168.1.50'],
    ['127.0.0.1', '127.0.0.1, 192.168.1.50'],
    ['127.0.0.1', '10.0.0.9, 127.0.0.1'],
    ['::1', '::1, 127.0.0.1'],
    ['127.0.0.1', ' 192.168.1.7 ,  10.0.0.2 '],
  ];
  for (const [remote, xff] of cases) {
    it(`${remote} XFF=${xff ?? '-'}`, () => {
      const expressIp = fakeReq(remote, xff ? { 'x-forwarded-for': xff } : {}).ip;
      expect(effectiveClientIp(remote, xff)).toBe(expressIp);
    });
  }

  it('classify() with the upgrade IP rejects a forged XFF', () => {
    const headers = { host: 'localhost:3001', 'x-forwarded-for': '127.0.0.1' };
    expect(
      classify(
        { ip: effectiveClientIp('192.168.1.50', headers['x-forwarded-for']), headers },
        devices
      ).kind
    ).toBe('none');
  });
});
