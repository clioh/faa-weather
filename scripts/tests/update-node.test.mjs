// scripts/update.sh: Node.js major upgrades (--upgrade-node, and before a
// release whose engines need a newer Node). Run: npm run test:update
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { World, VERSIONS, assertEnd } from './lib/world.mjs';

const { OLD, NEW } = VERSIONS;
let w;
afterEach(() => w?.cleanup());

describe('--upgrade-node', () => {
  test('installs the new major, rebuilds native modules, health-checked', () => {
    w = new World();
    const r = w.run(['--upgrade-node', '24'], { NPM_MODE: 'mutate' });
    assert.equal(r.status, 0, r.out);
    assert.equal(w.nodeMajor(), '24');
    assert.deepEqual(w.stubLog('npm'), ['rebuild --no-audit --no-fund']);
    assert.ok(w.stubLog('pm2').includes('update'), 'pm2 daemon refreshed');
    assertEnd(assert, w, { version: OLD, marker: 'new', logLine: /Node\.js upgraded to v24/ });
    assert.equal(w.exists('.update-snapshot'), false);
  });

  test('already on that major: nothing happens', () => {
    w = new World();
    const r = w.run(['--upgrade-node', '20']);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(w.stubLog('install-node'), []);
    assertEnd(assert, w, { version: OLD, marker: 'old', started: 'never-stopped' });
  });

  test('rebuild fails: previous Node.js reinstalled, node_modules restored', () => {
    w = new World();
    const r = w.run(['--upgrade-node', '24'], { NPM_MODE: 'netdrop' });
    assert.notEqual(r.status, 0);
    assert.equal(w.nodeMajor(), '20');
    assert.deepEqual(w.stubLog('install-node'), ['24', '20']);
    assertEnd(assert, w, {
      version: OLD,
      marker: 'old',
      logLine: /Rolled back to v1\.0\.0 on Node\.js v20/,
    });
  });

  test('unhealthy on the new Node.js: rolled back', () => {
    w = new World();
    const r = w.run(['--upgrade-node', '24'], { HEALTH_MODE: 'never', NPM_MODE: 'mutate' });
    assert.notEqual(r.status, 0);
    assert.equal(w.nodeMajor(), '20');
    assertEnd(assert, w, { version: OLD, marker: 'old', logLine: /Health check failed/ });
  });

  test('reinstalling the old major fails (offline): state kept for --recover', () => {
    w = new World();
    const r = w.run(['--upgrade-node', '24'], {
      NPM_MODE: 'fail',
      NODE_INSTALL_MODE: 'fail-to:20',
    });
    assert.notEqual(r.status, 0);
    assert.match(w.updateLog(), /ROLLBACK FAILED: reinstalling Node\.js 20 failed/);
    assert.equal(w.exists('.update-state'), true);
    const again = w.run(['--recover']);
    assert.equal(again.status, 0, again.out);
    assert.equal(w.nodeMajor(), '20');
    assertEnd(assert, w, { version: OLD, marker: 'old' });
  });

  test('killed right after Node.js switched: --recover goes back', () => {
    w = new World();
    const r = w.run(['--upgrade-node', '24'], { NODE_INSTALL_MODE: 'kill9' });
    assert.equal(r.signal ?? 'SIGKILL', 'SIGKILL');
    assert.equal(w.nodeMajor(), '24');
    assert.equal(w.exists('.update-state'), true);
    const rec = w.run(['--recover']);
    assert.equal(rec.status, 0, rec.out);
    assert.equal(w.nodeMajor(), '20');
    assert.match(w.updateLog(), /interrupted Node\.js upgrade/);
    assertEnd(assert, w, { version: OLD, marker: 'old' });
  });
});

describe('release that needs a newer Node.js', () => {
  test('Node.js is upgraded first, then the release installs', () => {
    w = new World();
    const tb = w.release({ nodeEngine: 24 });
    const r = w.run(['--apply-tarball', tb, '--sha256', w.sha256(tb), '--version', NEW]);
    assert.equal(r.status, 0, r.out);
    assert.equal(w.nodeMajor(), '24');
    assertEnd(assert, w, { version: NEW, marker: 'old', logLine: /needs Node\.js 24/ });
  });

  test('the Node.js upgrade fails: release not installed, still v1 on Node.js 20', () => {
    w = new World();
    const tb = w.release({ nodeEngine: 24 });
    const r = w.run(['--apply-tarball', tb, '--version', NEW], { NODE_INSTALL_MODE: 'fail-to:24' });
    assert.notEqual(r.status, 0);
    assert.equal(w.nodeMajor(), '20');
    assertEnd(assert, w, { version: OLD, marker: 'old' });
  });

  test('release satisfied by the installed Node.js: no upgrade', () => {
    w = new World();
    const tb = w.release({ nodeEngine: 20 });
    const r = w.run(['--apply-tarball', tb, '--version', NEW]);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(w.stubLog('install-node'), []);
    assertEnd(assert, w, { version: NEW, marker: 'old' });
  });
});
