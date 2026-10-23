import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { computeDeviceFingerprint, readPiSerial } from './fingerprint.js';

describe('device fingerprint', () => {
  let dir: string;
  const p = (name: string) => path.join(dir, name);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-fp-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('prefers the device-tree serial (NUL-terminated)', () => {
    fs.writeFileSync(p('dt'), '10000000ABCDEF12\0');
    fs.writeFileSync(p('cpuinfo'), 'Serial\t\t: 1111111111111111\n');
    expect(readPiSerial({ devicetreeSerial: p('dt'), cpuinfo: p('cpuinfo') })).toBe(
      '10000000abcdef12'
    );
  });

  it('falls back to /proc/cpuinfo Serial', () => {
    fs.writeFileSync(
      p('cpuinfo'),
      'processor\t: 0\nHardware\t: BCM2835\nSerial\t\t: 10000000cafe0001\nModel\t: Pi\n'
    );
    expect(
      computeDeviceFingerprint({ devicetreeSerial: p('missing'), cpuinfo: p('cpuinfo') })
    ).toEqual({ type: 'pi_serial', value: '10000000cafe0001' });
  });

  it('ignores an all-zero serial and hashes machine-id + MAC instead', () => {
    fs.writeFileSync(p('cpuinfo'), 'Serial\t\t: 0000000000000000\n');
    fs.writeFileSync(p('machine-id'), 'abc123\n');
    const sources = {
      devicetreeSerial: p('missing'),
      cpuinfo: p('cpuinfo'),
      machineIdPaths: [p('machine-id')],
    };
    const fp = computeDeviceFingerprint(sources);
    expect(fp.type).toBe('machine_id');
    expect(fp.value).toMatch(/^[0-9a-f]{32}$/);
    expect(computeDeviceFingerprint(sources)).toEqual(fp);
  });
});
