// scripts/flash-sd.sh: device checks, checksum, per-unit files and the exact
// command sequence, all under --dry-run with diskutil/lsblk/findmnt stubbed.
// Nothing touches a disk. Run: npm run test:update
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'flash-sd.sh');
const CARD_BYTES = 31914983424;

const MAC_CARD = `   Device Identifier:         disk4
   Whole:                     Yes
   Device / Media Name:       SD Card Reader
   Protocol:                  USB
   Disk Size:                 31.9 GB (${CARD_BYTES} Bytes) (exactly 62333952 512-Byte-Units)
   Device Location:           External
   Removable Media:           Removable
`;
const MAC_SSD = `   Whole:                     Yes
   Device / Media Name:       APPLE SSD
   Protocol:                  Apple Fabric
   Disk Size:                 1.0 TB (1000555581440 Bytes)
   Device Location:           Internal
   Removable Media:           Fixed
`;
const MAC_BUILTIN_SD = MAC_CARD.replace('USB', 'Secure Digital').replace('External', 'Internal');

let dir;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

function stub(name, body) {
  const path = join(dir, 'bin', name);
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
}

/** Temp dir with an image (+ .sha256), a key file and stubbed disk tools. */
function world({
  macInfo = MAC_CARD,
  lsblkRow = `1 usb disk ${CARD_BYTES}`,
  rootDisk = 'nvme0n1',
} = {}) {
  dir = mkdtempSync(join(tmpdir(), 'flash-sd-'));
  mkdirSync(join(dir, 'bin'));
  const img = join(dir, 'golden.img');
  writeFileSync(img, Buffer.alloc(1 << 20, 7));
  execFileSync('xz', ['-k', img]);
  const xzBytes = execFileSync('cat', [`${img}.xz`]);
  writeFileSync(
    `${img}.xz.sha256`,
    `${createHash('sha256').update(xzBytes).digest('hex')}  golden.img.xz\n`
  );
  writeFileSync(join(dir, 'key.txt'), 'abcd efgh jkmn pqrs\n');
  writeFileSync(join(dir, 'macinfo'), macInfo);
  stub(
    'diskutil',
    `case "$1 $2" in
  "info /") echo "   Part of Whole:             disk3" ;;
  "info /dev/disk4"|"info /dev/disk3") cat "${dir}/macinfo" ;;
  *) echo "stub diskutil: unexpected $*" >&2; exit 1 ;;
esac`
  );
  stub(
    'lsblk',
    `case "$*" in
  "-dnbo RM,TRAN,TYPE,SIZE /dev/sdb") echo "${lsblkRow}" ;;
  "-dno MODEL /dev/sdb") echo "Card Reader" ;;
  "-no PKNAME /dev/root-part") echo "${rootDisk}" ;;
  "-lnpo NAME,MOUNTPOINT /dev/sdb") printf '/dev/sdb\\n/dev/sdb1 /media/u/bootfs\\n/dev/sdb2 /media/u/rootfs\\n' ;;
  *) echo "stub lsblk: unexpected $*" >&2; exit 1 ;;
esac`
  );
  stub('findmnt', 'echo /dev/root-part');
  return { img: `${img}.xz` };
}

function flash(os, args, env = {}) {
  const r = spawnSync('/bin/bash', [SCRIPT, '--dry-run', '--yes', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      SKYGLASS_FLASH_OS: os,
      ...env,
    },
  });
  const out = r.stdout + r.stderr;
  const commands = r.stderr
    .split('\n')
    .filter((l) => l.startsWith('DRY-RUN: '))
    .map((l) => l.slice('DRY-RUN: '.length));
  return { status: r.status, out, commands, stdout: r.stdout };
}

describe('flash-sd.sh --dry-run (macOS)', () => {
  test('unmount, dd to rdisk, then only the per-unit files', () => {
    const { img } = world();
    const r = flash('macos', [
      '--image',
      img,
      '--device',
      '/dev/disk4',
      '--license-key-file',
      'key.txt',
      '--orientation',
      'portrait-cw',
    ]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Checksum OK/);
    assert.deepEqual(r.commands, [
      'diskutil unmountDisk /dev/disk4',
      `xz -dc ${img} | sudo dd of=/dev/rdisk4 ibs=1048576 obs=4194304`,
      'sync',
      'diskutil mountDisk /dev/disk4',
      'write /Volumes/bootfs/skyglass-license.txt (license ending PQRS)',
      'write /Volumes/bootfs/skyglass-orientation.txt (portrait-cw)',
      'sync',
      'diskutil eject /dev/disk4',
    ]);
    assert.doesNotMatch(r.out, /cmdline\.txt|firstrun/);
    assert.equal(r.stdout, '', 'everything goes to stderr');
  });

  test('no per-unit files: the card is only written and ejected', () => {
    const { img } = world();
    const r = flash('macos', ['--image', img, '--device', 'rdisk4']);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.commands, [
      'diskutil unmountDisk /dev/disk4',
      `xz -dc ${img} | sudo dd of=/dev/rdisk4 ibs=1048576 obs=4194304`,
      'sync',
      'diskutil eject /dev/disk4',
    ]);
  });

  test('the built-in SD slot (Internal, Secure Digital, Removable) is accepted', () => {
    const { img } = world({ macInfo: MAC_BUILTIN_SD });
    assert.equal(flash('macos', ['--image', img, '--device', 'disk4']).status, 0);
  });

  test('refuses an internal fixed disk', () => {
    const { img } = world({ macInfo: MAC_SSD });
    const r = flash('macos', ['--image', img, '--device', 'disk4']);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /not removable/);
    assert.deepEqual(r.commands, []);
  });

  test('refuses the system disk and partitions', () => {
    const { img } = world();
    let r = flash('macos', ['--image', img, '--device', 'disk3']);
    assert.match(r.out, /running system/);
    assert.deepEqual(r.commands, []);
    r = flash('macos', ['--image', img, '--device', 'disk4s1']);
    assert.match(r.out, /whole disk/);
    assert.deepEqual(r.commands, []);
  });

  test('capture: dd from the card, compress, checksum', () => {
    world();
    const r = flash('macos', ['--capture', '--device', 'disk4', '--out', 'skyglass-golden.img'], {
      PATH: `${join(dir, 'bin')}:/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin`,
    });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.commands.slice(0, 2), [
      'diskutil unmountDisk /dev/disk4',
      'sudo dd if=/dev/rdisk4 of=skyglass-golden.img bs=4194304',
    ]);
    assert.ok(r.commands.includes('xz -T0 -v skyglass-golden.img'));
    assert.ok(r.commands.includes('sha256 skyglass-golden.img.xz > skyglass-golden.img.xz.sha256'));
    assert.equal(r.commands.at(-1), 'diskutil eject /dev/disk4');
  });
});

describe('flash-sd.sh --dry-run (Linux)', () => {
  test('unmounts mounted partitions, dd with fsync, mounts boot to write the key', () => {
    const { img } = world();
    const r = flash('linux', [
      '--image',
      img,
      '--device',
      '/dev/sdb',
      '--license-key',
      'ABCD-EFGH-JKMN-PQRS',
    ]);
    assert.equal(r.status, 0, r.out);
    const uid = execFileSync('id', ['-u']).toString().trim();
    const gid = execFileSync('id', ['-g']).toString().trim();
    const sudo = uid === '0' ? '' : 'sudo ';
    assert.deepEqual(r.commands, [
      `${sudo}umount /dev/sdb1`,
      `${sudo}umount /dev/sdb2`,
      `xz -dc ${img} | ${sudo}dd of=/dev/sdb ibs=1048576 obs=4194304 conv=fsync status=progress`,
      'sync',
      `${sudo}mount -t vfat -o uid=${uid}\\,gid=${gid} /dev/sdb1 /tmp/skyglass-boot.DRYRUN`,
      'write /tmp/skyglass-boot.DRYRUN/skyglass-license.txt (license ending PQRS)',
      'sync',
      `${sudo}umount /tmp/skyglass-boot.DRYRUN`,
      'rmdir /tmp/skyglass-boot.DRYRUN',
    ]);
  });

  test('refuses a SATA disk, a non-removable disk and the root disk', () => {
    let { img } = world({ lsblkRow: `0 sata disk ${CARD_BYTES}` });
    assert.match(flash('linux', ['--image', img, '--device', 'sdb']).out, /internal sata/);
    ({ img } = world({ lsblkRow: `0 usb disk ${CARD_BYTES}` }));
    assert.match(flash('linux', ['--image', img, '--device', 'sdb']).out, /not removable/);
    ({ img } = world({ rootDisk: 'sdb' }));
    const r = flash('linux', ['--image', img, '--device', 'sdb']);
    assert.match(r.out, /running system/);
    assert.deepEqual(r.commands, []);
  });

  test('refuses an image larger than the card', () => {
    const { img } = world({ lsblkRow: '1 usb disk 4096' });
    const r = flash('linux', ['--image', img, '--device', 'sdb']);
    assert.match(r.out, /larger card/);
    assert.deepEqual(r.commands, []);
  });
});

describe('flash-sd.sh input checks', () => {
  test('a checksum mismatch stops before the card is touched', () => {
    const { img } = world();
    writeFileSync(`${img}.sha256`, `${'0'.repeat(64)}  golden.img.xz\n`);
    const r = flash('macos', ['--image', img, '--device', 'disk4']);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /Checksum mismatch/);
    assert.deepEqual(r.commands, []);
  });

  test('bad license key, bad orientation and two key sources are refused up front', () => {
    const { img } = world();
    const base = ['--image', img, '--device', 'disk4'];
    for (const extra of [
      ['--license-key', 'ABCD-EFGH-IJKL-MNOP'], // I and O are not in the key alphabet
      ['--orientation', 'upside-down'],
      ['--license-key', 'ABCD-EFGH-JKMN-PQRS', '--license-key-file', 'key.txt'],
      ['--license-id', '6f1c1b9e-1111-4c1e-9d2a-0a1b2c3d4e5f'], // no ADMIN_PASSWORD
    ]) {
      const r = flash('macos', [...base, ...extra], { ADMIN_PASSWORD: '' });
      assert.notEqual(r.status, 0, extra.join(' '));
      assert.deepEqual(r.commands, [], extra.join(' '));
    }
  });

  test('--license-id hands the mounted boot partition to provision-sd.sh', () => {
    const { img } = world();
    const id = '6f1c1b9e-1111-4c1e-9d2a-0a1b2c3d4e5f';
    const r = flash('macos', ['--image', img, '--device', 'disk4', '--license-id', id], {
      ADMIN_PASSWORD: 'x',
    });
    assert.equal(r.status, 0, r.out);
    assert.ok(
      r.commands.some((c) => c.endsWith(`provision-sd.sh ${id} /Volumes/bootfs --force`)),
      r.out
    );
  });
});
