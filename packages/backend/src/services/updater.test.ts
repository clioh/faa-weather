/**
 * In-app updater download hardening: real local HTTP server (fake GitHub API + assets),
 * temp project root, injected launcher. Simulates truncated, corrupted, stalled and
 * redirected downloads and checks nothing unverified is ever marked ready or installed.
 */

import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash, randomBytes } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UpdateService,
  NO_CHECKSUM_MESSAGE,
  BAD_CHECKSUM_FILE_MESSAGE,
  CHECKSUM_MISMATCH_MESSAGE,
  VERIFY_FAILED_MESSAGE,
} from './updater.js';
import {
  STALL_MESSAGE,
  TRUNCATED_MESSAGE,
  parseChecksum,
  assertAllowedUrl,
} from './updateDownload.js';

const VERSION = '2.0.0';
const ASSET = `skyglass-v${VERSION}.tar.gz`;
const PAYLOAD = randomBytes(256 * 1024);
const SHA = createHash('sha256').update(PAYLOAD).digest('hex');

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server;
let base: string;
let routes: Record<string, Handler>;
let releaseAssets: () => Array<{ name: string; browser_download_url: string; size: number }>;

const serveTarball: Handler = (_req, res) => {
  res.writeHead(200, { 'Content-Length': PAYLOAD.length, 'Content-Type': 'application/gzip' });
  res.end(PAYLOAD);
};
const serveChecksum: Handler = (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`${SHA}  ${ASSET}\n`);
};
const notFound: Handler = (_req, res) => {
  res.writeHead(404);
  res.end('not found');
};

function healthyRoutes(): Record<string, Handler> {
  return {
    '/repos/o/r/releases/latest': (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          tag_name: `v${VERSION}`,
          name: `SkyGlass v${VERSION}`,
          body: 'notes',
          published_at: '2026-10-01T00:00:00Z',
          assets: releaseAssets(),
        })
      );
    },
    [`/dl/${ASSET}`]: serveTarball,
    [`/dl/${ASSET}.sha256`]: serveChecksum,
  };
}

function defaultAssets() {
  return [
    { name: ASSET, browser_download_url: `${base}/dl/${ASSET}`, size: PAYLOAD.length },
    { name: `${ASSET}.sha256`, browser_download_url: `${base}/dl/${ASSET}.sha256`, size: 100 },
  ];
}

beforeAll(async () => {
  server = http.createServer((req, res) => (routes[req.url ?? ''] ?? notFound)(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let root: string;
let tempDir: string;
let launches: string[][];
let svc: UpdateService;

const finalPath = () => path.join(tempDir, `release-${VERSION}.tar.gz`);
const shaPath = () => `${finalPath()}.sha256`;
const partPath = () => `${finalPath()}.part`;
const tempFiles = () => (fs.existsSync(tempDir) ? fs.readdirSync(tempDir).sort() : []);

async function makeService() {
  const s = new UpdateService({
    projectRoot: root,
    tempDir,
    githubApiBase: base,
    updateScript: path.join(root, 'update.sh'),
    stallTimeoutMs: 300,
    connectTimeoutMs: 1000,
    launcher: async (_script, args) => {
      launches.push(args);
    },
  });
  await s.init({ checkInterval: 0, autoDownload: false, autoUpdate: false, githubRepo: 'o/r' });
  return s;
}

/** Check then download; returns the download result. */
async function checkAndDownload() {
  const status = await svc.checkForUpdates();
  expect(status.updateAvailable).toBe(true);
  return svc.downloadUpdate();
}

function expectNothingReady() {
  expect(svc.getStatus().downloadReady).toBe(false);
  expect(fs.existsSync(finalPath())).toBe(false);
  expect(fs.existsSync(shaPath())).toBe(false);
  expect(fs.existsSync(partPath())).toBe(false);
}

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  releaseAssets = defaultAssets;
  routes = healthyRoutes();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-updater-'));
  tempDir = path.join(root, '.update-temp');
  fs.writeFileSync(path.join(root, 'VERSION'), '1.0.0\n');
  fs.writeFileSync(path.join(root, 'update.sh'), '#!/bin/sh\nexit 0\n');
  launches = [];
  svc = await makeService();
});

afterEach(() => {
  svc.stop();
  server.closeAllConnections();
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('updater download: happy path', () => {
  it('downloads, verifies, renames atomically and records the digest', async () => {
    const result = await checkAndDownload();
    expect(result.success).toBe(true);
    const status = svc.getStatus();
    expect(status.downloadReady).toBe(true);
    expect(status.downloadProgress.phase).toBe('complete');
    expect(status.downloadProgress.percent).toBe(100);
    expect(fs.readFileSync(finalPath()).equals(PAYLOAD)).toBe(true);
    expect(fs.readFileSync(shaPath(), 'utf-8')).toBe(`${SHA}\n`);
    expect(tempFiles()).toEqual([`release-${VERSION}.tar.gz`, `release-${VERSION}.tar.gz.sha256`]);

    // A later check (and a fresh service, i.e. a restart) still sees it as ready.
    expect((await svc.checkForUpdates()).downloadReady).toBe(true);
    const restarted = await makeService();
    expect((await restarted.checkForUpdates()).downloadReady).toBe(true);
  });
});

describe('updater download: truncation', () => {
  it('rejects a connection dropped mid-body, then a retry succeeds', async () => {
    routes[`/dl/${ASSET}`] = (_req, res) => {
      res.writeHead(200, { 'Content-Length': PAYLOAD.length });
      res.write(PAYLOAD.subarray(0, PAYLOAD.length / 2), () => {
        setTimeout(() => res.socket?.destroy(), 20);
      });
    };
    const result = await checkAndDownload();
    expect(result).toEqual({ success: false, message: TRUNCATED_MESSAGE });
    expect(svc.getStatus().downloadProgress.phase).toBe('error');
    expectNothingReady();

    routes = healthyRoutes();
    const retry = await svc.downloadUpdate();
    expect(retry.success).toBe(true);
    expect(svc.getStatus().downloadReady).toBe(true);
  });

  it('rejects fewer bytes than Content-Length followed by a clean close', async () => {
    routes[`/dl/${ASSET}`] = (_req, res) => {
      res.writeHead(200, { 'Content-Length': PAYLOAD.length, Connection: 'close' });
      res.write(PAYLOAD.subarray(0, 1000), () => res.socket?.end());
    };
    const result = await checkAndDownload();
    expect(result).toEqual({ success: false, message: TRUNCATED_MESSAGE });
    expectNothingReady();
  });

  it('rejects a body without Content-Length that is shorter than the asset size', async () => {
    routes[`/dl/${ASSET}`] = (_req, res) => {
      res.writeHead(200); // chunked, no Content-Length
      res.end(PAYLOAD.subarray(0, PAYLOAD.length - 10));
    };
    const result = await checkAndDownload();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/bytes but the release lists/);
    expectNothingReady();
  });

  it('rejects a Content-Length that disagrees with the asset size', async () => {
    routes[`/dl/${ASSET}`] = (_req, res) => {
      res.writeHead(200, { 'Content-Length': 5000 });
      res.end(PAYLOAD.subarray(0, 5000));
    };
    const result = await checkAndDownload();
    expect(result.success).toBe(false);
    expectNothingReady();
  });
});

describe('updater download: integrity', () => {
  it('rejects corrupted bytes of the right length and removes them', async () => {
    const corrupted = Buffer.from(PAYLOAD);
    corrupted[1234] ^= 0xff;
    routes[`/dl/${ASSET}`] = (_req, res) => {
      res.writeHead(200, { 'Content-Length': corrupted.length });
      res.end(corrupted);
    };
    const result = await checkAndDownload();
    expect(result).toEqual({ success: false, message: CHECKSUM_MISMATCH_MESSAGE });
    expect(svc.getStatus().error).toBe(CHECKSUM_MISMATCH_MESSAGE);
    expectNothingReady();
  });

  it('refuses a release without a checksum asset', async () => {
    releaseAssets = () => defaultAssets().slice(0, 1);
    const result = await checkAndDownload();
    expect(result).toEqual({ success: false, message: NO_CHECKSUM_MESSAGE });
    expect(svc.getStatus().downloadProgress.error).toBe(NO_CHECKSUM_MESSAGE);
    expectNothingReady();
  });

  it('refuses a malformed checksum file', async () => {
    routes[`/dl/${ASSET}.sha256`] = (_req, res) => res.end('not-a-digest  file\n');
    const result = await checkAndDownload();
    expect(result).toEqual({ success: false, message: BAD_CHECKSUM_FILE_MESSAGE });
    expectNothingReady();
  });

  it('refuses a checksum file naming a different asset', async () => {
    routes[`/dl/${ASSET}.sha256`] = (_req, res) => res.end(`${SHA}  other.tar.gz\n`);
    const result = await checkAndDownload();
    expect(result.message).toBe(BAD_CHECKSUM_FILE_MESSAGE);
    expectNothingReady();
  });

  it('refuses when the checksum download 404s', async () => {
    delete routes[`/dl/${ASSET}.sha256`];
    const result = await checkAndDownload();
    expect(result.message).toBe(BAD_CHECKSUM_FILE_MESSAGE);
    expectNothingReady();
  });
});

describe('updater download: stalls', () => {
  it('aborts a stalled download with a clear message and can retry', async () => {
    routes[`/dl/${ASSET}`] = (_req, res) => {
      res.writeHead(200, { 'Content-Length': PAYLOAD.length });
      res.write(PAYLOAD.subarray(0, 4096)); // then nothing, connection left open
    };
    const started = Date.now();
    const result = await checkAndDownload();
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result).toEqual({ success: false, message: STALL_MESSAGE });
    const status = svc.getStatus();
    expect(status.downloadProgress.phase).toBe('error');
    expect(status.downloadProgress.error).toBe(STALL_MESSAGE);
    expectNothingReady();

    routes = healthyRoutes();
    expect((await svc.downloadUpdate()).success).toBe(true);
  });

  it('times out when the server never sends headers', async () => {
    svc.setTimeouts({ connectTimeoutMs: 200 });
    routes[`/dl/${ASSET}`] = () => {
      /* never respond */
    };
    const result = await checkAndDownload();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Could not reach the update server/);
    expectNothingReady();
  });

  it('refuses a second concurrent download', async () => {
    routes[`/dl/${ASSET}`] = (_req, res) => {
      res.writeHead(200, { 'Content-Length': PAYLOAD.length });
      res.write(PAYLOAD.subarray(0, 10));
    };
    await svc.checkForUpdates();
    const first = svc.downloadUpdate();
    const second = await svc.downloadUpdate();
    expect(second).toEqual({ success: false, message: 'Download already in progress' });
    expect((await first).success).toBe(false);
  });
});

describe('updater download: HTTP status and redirects', () => {
  it.each([404, 500])('fails cleanly on tarball status %i', async (code) => {
    routes[`/dl/${ASSET}`] = (_req, res) => {
      res.writeHead(code);
      res.end('nope');
    };
    const result = await checkAndDownload();
    expect(result.message).toBe(`Download failed with status ${code}`);
    expectNothingReady();
  });

  it('follows a 302 -> 302 -> 200 chain', async () => {
    releaseAssets = () => [
      { ...defaultAssets()[0], browser_download_url: `${base}/r1` },
      defaultAssets()[1],
    ];
    routes['/r1'] = (_req, res) => {
      res.writeHead(302, { Location: '/r2' });
      res.end();
    };
    routes['/r2'] = (_req, res) => {
      res.writeHead(302, { Location: `${base}/dl/${ASSET}` });
      res.end();
    };
    expect((await checkAndDownload()).success).toBe(true);
    expect(svc.getStatus().downloadReady).toBe(true);
  });

  it('rejects more than 5 redirects', async () => {
    releaseAssets = () => [
      { ...defaultAssets()[0], browser_download_url: `${base}/loop/0` },
      defaultAssets()[1],
    ];
    for (let i = 0; i < 10; i++) {
      routes[`/loop/${i}`] = (_req, res) => {
        res.writeHead(302, { Location: `/loop/${i + 1}` });
        res.end();
      };
    }
    const result = await checkAndDownload();
    expect(result.message).toBe('Too many redirects');
    expectNothingReady();
  });

  it('rejects a redirect to a non-loopback http URL without crashing', async () => {
    routes[`/dl/${ASSET}`] = (_req, res) => {
      res.writeHead(302, { Location: 'http://example.com/evil.tar.gz' });
      res.end();
    };
    const result = await checkAndDownload();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Refusing non-https/);
    expectNothingReady();
  });
});

describe('updater download: leftovers from a crash', () => {
  it('does not report a partial final tarball without .sha256 as ready, and re-downloads', async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(finalPath(), PAYLOAD.subarray(0, 5000));
    const status = await svc.checkForUpdates();
    expect(status.downloadReady).toBe(false);
    expect(fs.existsSync(finalPath())).toBe(false);
    expect((await svc.downloadUpdate()).success).toBe(true);
    expect(fs.readFileSync(finalPath()).equals(PAYLOAD)).toBe(true);
  });

  it('removes a leftover .part on init and never treats it as ready', async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(partPath(), PAYLOAD);
    svc = await makeService();
    expect(fs.existsSync(partPath())).toBe(false);
    expect((await svc.checkForUpdates()).downloadReady).toBe(false);
  });

  it('does not trust a .sha256 that does not match the tarball', async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(finalPath(), PAYLOAD);
    fs.writeFileSync(shaPath(), `${'0'.repeat(64)}\n`);
    expect((await svc.checkForUpdates()).downloadReady).toBe(false);
    expect(fs.existsSync(finalPath())).toBe(false);
    expect(fs.existsSync(shaPath())).toBe(false);
  });
});

describe('updater apply', () => {
  it('passes the verified digest to update.sh', async () => {
    expect((await checkAndDownload()).success).toBe(true);
    const result = await svc.applyUpdates();
    expect(result.success).toBe(true);
    expect(launches).toEqual([
      ['--apply-tarball', finalPath(), '--delay', '3', '--version', VERSION, '--sha256', SHA],
    ]);
  });

  it('refuses to launch when the tarball was corrupted on disk after download', async () => {
    expect((await checkAndDownload()).success).toBe(true);
    const fd = fs.openSync(finalPath(), 'r+');
    const b = Buffer.alloc(1);
    fs.readSync(fd, b, 0, 1, 100);
    b[0] ^= 0x01;
    fs.writeSync(fd, b, 0, 1, 100);
    fs.closeSync(fd);

    const result = await svc.applyUpdates();
    expect(result).toEqual({ success: false, message: VERIFY_FAILED_MESSAGE });
    expect(launches).toEqual([]);
    expect(svc.getStatus().downloadReady).toBe(false);
    expect(fs.existsSync(finalPath())).toBe(false);
    expect(fs.existsSync(shaPath())).toBe(false);

    // Not stuck: applying again downloads afresh and launches with the digest.
    const again = await svc.applyUpdates();
    expect(again.success).toBe(true);
    expect(launches[0]).toContain(SHA);
  });
});

describe('updateDownload helpers', () => {
  it('parses sha256sum output', () => {
    expect(parseChecksum(`${SHA.toUpperCase()}  ${ASSET}\n`, ASSET)).toBe(SHA);
    expect(parseChecksum(`${SHA} *${ASSET}`, ASSET)).toBe(SHA);
    expect(parseChecksum(`${SHA}\n`, ASSET)).toBe(SHA);
    expect(parseChecksum('', ASSET)).toBeNull();
    expect(parseChecksum(`${SHA.slice(1)}  ${ASSET}`, ASSET)).toBeNull();
  });

  it('allows https and loopback http only', () => {
    expect(() => assertAllowedUrl('https://github.com/x')).not.toThrow();
    expect(() => assertAllowedUrl('http://127.0.0.1:1/x')).not.toThrow();
    expect(() => assertAllowedUrl('http://localhost/x')).not.toThrow();
    expect(() => assertAllowedUrl('http://github.com/x')).toThrow(/non-https/);
    expect(() => assertAllowedUrl('file:///etc/passwd')).toThrow(/non-https/);
  });
});
