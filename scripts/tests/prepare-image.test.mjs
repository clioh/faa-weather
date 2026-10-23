// scripts/prepare-image.sh: refuses to run off a Pi, without an install or
// without --yes, and (--dry-run, in a fake install tree) wipes every per-unit
// file, re-arms first boot and locks the card down. Nothing is changed.
// Run: npm run test:update
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'prepare-image.sh');

let dir;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

function put(rel, content = '') {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

/** A fake SkyGlass install with the script copied into its scripts/. */
function install({ pi = true, built = true } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'prepare-image-'));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(SCRIPT, join(dir, 'scripts', 'prepare-image.sh'));
  if (built) {
    put('packages/backend/dist/server.js');
    put('packages/frontend/dist/index.html');
    chmodSync(put('packages/presence/venv/bin/python', '#!/bin/sh\n'), 0o755);
  }
  put('etc-systemd/skyglass-boot.service');
  put('model', pi ? 'Raspberry Pi 5 Model B Rev 1.0\0' : 'Generic x86\0');
  put('data/.gitkeep');
  put('data/skyglass.db', 'db');
  put('packages/presence/face_data/.wifi_configured', 'Home');
  put('config/config.yaml', 'airport: KSAN\n');
}

function prepare(args) {
  const r = spawnSync('/bin/bash', [join(dir, 'scripts', 'prepare-image.sh'), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SKYGLASS_PI_MODEL_FILE: join(dir, 'model'),
      SKYGLASS_SYSTEMD_DIR: join(dir, 'etc-systemd'),
      SKYGLASS_USER: userInfo().username,
    },
  });
  const commands = r.stderr
    .split('\n')
    .filter((l) => l.startsWith('DRY-RUN: '))
    .map((l) => l.slice('DRY-RUN: '.length));
  return { status: r.status, out: r.stdout + r.stderr, commands };
}

describe('prepare-image.sh', () => {
  test('refuses off a Pi, without an install, and without --yes', () => {
    install({ pi: false });
    assert.match(prepare(['--yes', '--dry-run']).out, /Not a Raspberry Pi/);
    install({ built: false });
    assert.match(prepare(['--yes', '--dry-run']).out, /No finished SkyGlass install/);
    install();
    const r = prepare(['--dry-run']);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /without --yes/);
    assert.deepEqual(r.commands, []);
  });

  test('rejects a bad country code', () => {
    install();
    assert.match(prepare(['--yes', '--dry-run', '--country', 'USA']).out, /two-letter/);
  });

  test('dry run: wipes per-unit state, re-arms first boot, locks access, powers off', () => {
    install();
    const r = prepare(['--yes', '--dry-run', '--country', 'gb']);
    assert.equal(r.status, 0, r.out);
    const has = (re) =>
      assert.ok(
        r.commands.some((c) => re.test(c)),
        `${re}\n${r.out}`
      );
    has(/^raspi-config nonint do_wifi_country GB$/);
    has(/^raspi-config nonint do_hostname skyglass$/);
    has(/^find \S+\/data -mindepth 1 -maxdepth 1 \\! -name .gitkeep -exec rm -rf/);
    has(/^chmod 700 \S+\/data$/);
    has(/^find \S+\/packages\/presence\/face_data -mindepth 1/);
    has(/^rm -rf -- \S+\/config\/config\.yaml$/);
    has(/^systemctl enable skyglass-firstboot\.service$/);
    has(/^touch \/etc\/skyglass-firstboot$/);
    has(/^truncate -s 0 \/etc\/machine-id$/);
    has(/^systemctl disable --now ssh\.service$/);
    has(/^passwd -l /);
    assert.equal(r.commands.at(-1), 'systemctl poweroff');
    assert.ok(!r.commands.some((c) => /cmdline\.txt/.test(c)));
    // SSH goes off after everything else, so a failed step leaves access
    const idx = (re) => r.commands.findIndex((c) => re.test(c));
    assert.ok(idx(/disable --now ssh/) > idx(/skyglass-firstboot/));
  });
});
