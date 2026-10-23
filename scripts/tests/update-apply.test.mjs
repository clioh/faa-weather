// scripts/update.sh: happy paths, refusals before anything changes, and
// rollbacks after failed installs / health checks. Run: npm run test:update
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { World, VERSIONS, assertEnd } from './lib/world.mjs';

const { OLD, NEW } = VERSIONS;
let w;
afterEach(() => w?.cleanup());

describe('happy path', () => {
  test('package-lock unchanged: no npm install, new version on disk', () => {
    w = new World();
    const tb = w.release();
    const r = w.run(['--apply-tarball', tb, '--sha256', w.sha256(tb), '--version', NEW]);
    assert.equal(r.status, 0, r.out);
    assertEnd(assert, w, {
      version: NEW,
      marker: 'old',
      logLine: /Update complete! Now running v2\.0\.0/,
    });
    assert.deepEqual(w.stubLog('npm'), [], 'npm not called');
    assert.match(w.updateLog(), /skipping npm install/);
    assert.equal(w.exists('new-only.txt'), true);
    assert.equal(w.exists('.update-snapshot'), false, 'snapshots cleaned');
  });

  test('package-lock changed: npm install runs, node_modules updated', () => {
    w = new World();
    const tb = w.release({ lockChanged: true });
    const r = w.run(['--apply-tarball', tb, '--version', NEW], { NPM_MODE: 'mutate' });
    assert.equal(r.status, 0, r.out);
    assertEnd(assert, w, { version: NEW, marker: 'new', logLine: /Update complete!/ });
    assert.equal(w.stubLog('npm').length, 1);
    assert.match(w.updateLog(), /No --sha256 given/);
  });

  test('--apply downloads release + .sha256 and installs', () => {
    w = new World();
    const tb = w.release();
    const json = path.join(w.dir, 'release.json');
    const sumFile = path.join(w.dir, 'release.sha256');
    fs.writeFileSync(
      json,
      `{\n"tag_name": "v${NEW}",\n"name": "SkyGlass v${NEW}",\n"browser_download_url": "https://example.test/skyglass-v${NEW}.tar.gz"\n}\n`
    );
    fs.writeFileSync(sumFile, `${w.sha256(tb)}  skyglass-v${NEW}.tar.gz\n`);
    const env = {
      GITHUB_REPO: 'x/y',
      GH_RELEASE_JSON: json,
      GH_TARBALL: tb,
      GH_SHA256_FILE: sumFile,
    };
    const r = w.run(['--apply'], env);
    assert.equal(r.status, 0, r.out);
    assertEnd(assert, w, { version: NEW, marker: 'old', logLine: /Checksum verified/ });
    assert.equal(w.exists('.update-temp'), false);
  });
});

describe('refused before anything changes', () => {
  const cases = [
    ['random bytes', (x) => x.release({ kind: 'random' }), /Failed to extract release/],
    ['truncated gzip', (x) => x.release({ kind: 'truncated' }), /Failed to extract release/],
    [
      'no package.json',
      (x) => x.release({ omit: ['package.json'] }),
      /incomplete \(missing: package\.json/,
    ],
    [
      'no backend dist',
      (x) => x.release({ omit: ['packages/backend/dist/server.js'] }),
      /missing:.*packages\/backend\/dist\/server\.js/,
    ],
    [
      'no frontend dist',
      (x) => x.release({ omit: ['packages/frontend/dist/index.html'] }),
      /missing:.*packages\/frontend\/dist\/index\.html/,
    ],
  ];
  for (const [name, make, line] of cases) {
    test(`corrupt tarball: ${name}`, () => {
      w = new World();
      const r = w.run(['--apply-tarball', make(w), '--version', NEW]);
      assert.notEqual(r.status, 0);
      assertEnd(assert, w, {
        version: OLD,
        marker: 'old',
        started: 'never-stopped',
        logLine: line,
      });
      assert.equal(w.exists('.backup'), false, 'refused before backup');
    });
  }

  test('--sha256 mismatch', () => {
    w = new World();
    const tb = w.release();
    const r = w.run(['--apply-tarball', tb, '--sha256', '0'.repeat(64), '--version', NEW]);
    assert.notEqual(r.status, 0);
    assertEnd(assert, w, {
      version: OLD,
      marker: 'old',
      started: 'never-stopped',
      logLine: /Checksum mismatch/,
    });
    assert.equal(w.exists('.backup'), false);
    assert.equal(w.exists('.update-stage'), false);
  });

  test('--apply with no published checksum', () => {
    w = new World();
    const tb = w.release();
    const json = path.join(w.dir, 'release.json');
    fs.writeFileSync(
      json,
      `{\n"tag_name": "v${NEW}",\n"browser_download_url": "https://example.test/skyglass-v${NEW}.tar.gz"\n}\n`
    );
    const env = {
      GITHUB_REPO: 'x/y',
      GH_RELEASE_JSON: json,
      GH_TARBALL: tb,
      GH_SHA256_FILE: '/nonexistent',
    };
    const r = w.run(['--apply'], env);
    assert.notEqual(r.status, 0);
    assertEnd(assert, w, {
      version: OLD,
      marker: 'old',
      started: 'never-stopped',
      logLine: /No checksum published/,
    });
  });

  test('low disk space', () => {
    w = new World();
    const r = w.run(['--apply-tarball', w.release(), '--version', NEW], {
      SKYGLASS_UPDATE_DISK_MARGIN_MB: '1000000000',
    });
    assert.notEqual(r.status, 0);
    assertEnd(assert, w, {
      version: OLD,
      marker: 'old',
      started: 'never-stopped',
      logLine: /Not enough free disk space/,
    });
    assert.equal(w.exists('.backup'), false);
  });
});

describe('rollback after a failed install', () => {
  test('network drop during npm install: node_modules restored from snapshot', () => {
    w = new World();
    const tb = w.release({ lockChanged: true });
    const r = w.run(['--apply-tarball', tb, '--version', NEW], { NPM_MODE: 'netdrop' });
    assert.notEqual(r.status, 0);
    assertEnd(assert, w, { version: OLD, marker: 'old', logLine: /Rolled back to v1\.0\.0/ });
    assert.match(w.updateLog(), /npm install failed/);
    assert.equal(w.stubLog('npm').length, 1, 'rollback does not run npm (offline-safe)');
    assert.equal(w.read('packages/backend/node_modules/marker').trim(), 'old');
  });

  test('npm install hangs: killed after SKYGLASS_NPM_TIMEOUT, rolled back', () => {
    w = new World();
    const tb = w.release({ lockChanged: true });
    const r = w.run(['--apply-tarball', tb, '--version', NEW], {
      NPM_MODE: 'hang',
      SKYGLASS_NPM_TIMEOUT: '1',
    });
    assert.notEqual(r.status, 0);
    assert.ok(r.ms < 15000, `took ${r.ms} ms`);
    assertEnd(assert, w, { version: OLD, marker: 'old', logLine: /Rolled back to v1\.0\.0/ });
  });

  test('health never comes up', () => {
    w = new World();
    const r = w.run(['--apply-tarball', w.release({ lockChanged: true }), '--version', NEW], {
      NPM_MODE: 'mutate',
      HEALTH_MODE: 'never',
      BAD_VERSION: NEW,
    });
    assert.notEqual(r.status, 0);
    assertEnd(assert, w, {
      version: OLD,
      marker: 'old',
      logLine: /Rolled back to v1\.0\.0 \(backend healthy\)/,
    });
    assert.match(w.updateLog(), /backend not healthy at .* within 3s/);
  });

  test('healthy then dies (crash loop)', () => {
    w = new World();
    const r = w.run(['--apply-tarball', w.release(), '--version', NEW], {
      HEALTH_MODE: 'flap:2',
      BAD_VERSION: NEW,
    });
    assert.notEqual(r.status, 0);
    assertEnd(assert, w, { version: OLD, marker: 'old', logLine: /Rolled back to v1\.0\.0/ });
    assert.match(w.updateLog(), /crash loop/);
  });

  test('backend healthy but mirror UI returns 500', () => {
    w = new World();
    const r = w.run(['--apply-tarball', w.release(), '--version', NEW], {
      HEALTH_MODE: 'ui500',
      BAD_VERSION: NEW,
    });
    assert.notEqual(r.status, 0);
    assertEnd(assert, w, { version: OLD, marker: 'old', logLine: /mirror UI not served/ });
    assert.match(w.updateLog(), /Rolled back to v1\.0\.0/);
  });

  test('pm2 fails to start the new version', () => {
    w = new World();
    const r = w.run(['--apply-tarball', w.release(), '--version', NEW], { PM2_FAIL_VERSION: NEW });
    assert.notEqual(r.status, 0);
    assert.equal(w.version(), OLD);
    assert.match(w.updateLog(), /Failed to start services/);
    assert.match(w.updateLog(), /Rolled back to v1\.0\.0/);
    assert.equal(w.exists('.update-state'), false);
  });
});
