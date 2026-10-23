// scripts/update.sh: signals, SIGKILL/power loss + --recover, the update
// lock, and rollbacks that are themselves interrupted. Run: npm run test:update
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { World, VERSIONS, assertEnd } from './lib/world.mjs';

const { OLD, NEW } = VERSIONS;
let w;
afterEach(() => w?.cleanup());

describe('signals and crashes', () => {
  test('SIGTERM mid-apply (during npm install) rolls back', () => {
    w = new World();
    const tb = w.release({ lockChanged: true });
    const r = w.run(['--apply-tarball', tb, '--version', NEW], { NPM_MODE: 'term' });
    assert.notEqual(r.status, 0);
    assert.ok(r.ms < 15000, `trap ran promptly (${r.ms} ms)`);
    assertEnd(assert, w, {
      version: OLD,
      marker: 'old',
      logLine: /Received SIGTERM during the update/,
    });
    assert.match(w.updateLog(), /Rolled back to v1\.0\.0/);
  });

  test('SIGKILL mid-apply leaves .update-state; --recover restores', () => {
    w = new World();
    const tb = w.release({ lockChanged: true });
    const r = w.run(['--apply-tarball', tb, '--version', NEW], { NPM_MODE: 'kill9' });
    assert.equal(r.signal, 'SIGKILL');
    // power-loss state: new code, corrupted node_modules, state + stale lock
    assert.equal(w.version(), NEW);
    assert.equal(w.marker(), 'garbage');
    assert.match(w.read('.update-state'), /^phase=applying$/m);
    assert.match(w.read('.update-state'), /^version=2\.0\.0$/m);
    assert.match(w.read('.update-state'), /^from=1\.0\.0$/m);
    assert.equal(w.exists('.update-lock/pid'), true, 'stale lock left behind');

    const rec = w.run(['--recover']);
    assert.equal(rec.status, 0, rec.out);
    assertEnd(assert, w, {
      version: OLD,
      marker: 'old',
      logLine: /Found an interrupted update \(v1\.0\.0 -> v2\.0\.0/,
    });
    assert.match(w.updateLog(), /Removing stale update lock/);
    assert.match(w.updateLog(), /Rolled back to v1\.0\.0/);
    assert.equal(w.read('packages/backend/node_modules/marker').trim(), 'old');
  });

  test('--recover with no state is a fast no-op', () => {
    w = new World();
    const r = w.run(['--recover']);
    assert.equal(r.status, 0);
    assert.ok(r.ms < 2000, `${r.ms} ms`);
    assert.deepEqual(w.stubLog('pm2'), [], 'services untouched');
    assert.equal(w.updateLog(), '', 'nothing logged');
  });

  test('a new update after a crash recovers first and refuses to install', () => {
    w = new World();
    const tb = w.release({ lockChanged: true });
    w.run(['--apply-tarball', tb, '--version', NEW], { NPM_MODE: 'kill9' });
    const r = w.run(['--apply-tarball', w.release({ version: '3.0.0' }), '--version', '3.0.0']);
    assert.notEqual(r.status, 0);
    assertEnd(assert, w, {
      version: OLD,
      marker: 'old',
      logLine: /earlier update was interrupted/,
    });
    assert.match(w.updateLog(), /please retry/);
  });
});

describe('update lock', () => {
  test('second update and --recover are refused while one runs; stale lock is taken over', async () => {
    w = new World();
    const first = w.start(['--apply-tarball', w.release({ lockChanged: true }), '--version', NEW], {
      NPM_MODE: 'slow',
      NPM_SLOW_SECS: '3',
    });
    await w.waitFor(() => w.stubLog('npm').length > 0);
    assert.equal(w.exists('.update-state'), true);

    const second = w.run([
      '--apply-tarball',
      w.release({ version: '3.0.0' }),
      '--version',
      '3.0.0',
    ]);
    assert.notEqual(second.status, 0);
    assert.match(second.out, /Another update is already running \(pid \d+\)/);

    const rec = w.run(['--recover']);
    assert.notEqual(rec.status, 0);
    assert.match(rec.out, /Not recovering: an update is in progress/);

    const res = await first.done;
    assert.equal(res.status, 0);
    assertEnd(assert, w, {
      version: NEW,
      marker: 'new',
      logLine: /Update complete! Now running v2\.0\.0/,
    });

    // stale lock (holder no longer running) is taken over
    fs.mkdirSync(path.join(w.root, '.update-lock'));
    fs.writeFileSync(path.join(w.root, '.update-lock/pid'), '999999\n');
    const third = w.run(['--apply-tarball', w.release({ version: '3.0.0' }), '--version', '3.0.0']);
    assert.equal(third.status, 0, third.out);
    assert.equal(w.version(), '3.0.0');
    assert.match(w.updateLog(), /Removing stale update lock \(pid 999999/);
    assert.equal(w.exists('.update-lock'), false);
  });
});

describe('interrupted rollback', () => {
  test('killed at the start of rollback, then --recover', () => {
    w = new World();
    const tb = w.release({ lockChanged: true });
    // stop #1 = apply, stop #2 = rollback (health never comes up on v2)
    const r = w.run(['--apply-tarball', tb, '--version', NEW], {
      NPM_MODE: 'mutate',
      HEALTH_MODE: 'never',
      BAD_VERSION: NEW,
      PM2_KILL_ON_STOP: '2',
    });
    assert.equal(r.signal, 'SIGKILL');
    assert.match(w.read('.update-state'), /^phase=rolling_back$/m);
    const rec = w.run(['--recover'], { HEALTH_MODE: 'never', BAD_VERSION: NEW });
    assert.equal(rec.status, 0, rec.out);
    assertEnd(assert, w, { version: OLD, marker: 'old', logLine: /Rolled back to v1\.0\.0/ });
  });

  test('killed after rollback restored files (before restart), then --recover twice', () => {
    w = new World();
    const tb = w.release({ lockChanged: true });
    // start #1 = apply, start #2 = rollback, after code + snapshots are restored
    const r = w.run(['--apply-tarball', tb, '--version', NEW], {
      NPM_MODE: 'mutate',
      HEALTH_MODE: 'never',
      BAD_VERSION: NEW,
      PM2_KILL_ON_START: '2',
    });
    assert.equal(r.signal, 'SIGKILL');
    assert.equal(w.version(), OLD, 'code already restored');
    assert.equal(w.marker(), 'old', 'snapshot already restored');
    assert.equal(w.exists('.update-state'), true);
    const rec = w.run(['--recover']);
    assert.equal(rec.status, 0, rec.out);
    assertEnd(assert, w, { version: OLD, marker: 'old', logLine: /Rolled back to v1\.0\.0/ });
    const again = w.run(['--recover']);
    assert.equal(again.status, 0);
    assertEnd(assert, w, { version: OLD, marker: 'old' });
  });

  test('missing backup: rollback says so and still starts services', () => {
    w = new World();
    // crash state with no .backup (e.g. the disk lost it)
    fs.writeFileSync(
      path.join(w.root, '.update-state'),
      'phase=applying\nversion=2.0.0\nfrom=1.0.0\n'
    );
    const rec = w.run(['--recover'], { SKYGLASS_MAX_RECOVER_ATTEMPTS: '1' });
    assert.notEqual(rec.status, 0);
    assert.match(w.updateLog(), /ROLLBACK FAILED: backup at .* is missing or incomplete/);
    assert.match(w.updateLog(), /Giving up after 1 rollback attempts/);
    const pm2 = w.stubLog('pm2').filter((l) => !l.startsWith('save'));
    assert.ok(pm2[pm2.length - 1].startsWith('startOrRestart'), 'services started');
    assert.equal(w.exists('.update-state'), false);
    assert.equal(w.exists('.update-lock'), false);
  });
});
