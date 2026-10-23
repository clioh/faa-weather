/**
 * Device fingerprint the license binds to (docs/LICENSING.md "Policy").
 *
 * Raspberry Pi: the board serial, from the device tree, else /proc/cpuinfo.
 * It survives re-flashing. Other hardware: sha256 of /etc/machine-id and the
 * primary MAC address.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { hostname, networkInterfaces } from 'os';

export type FingerprintType = 'pi_serial' | 'machine_id';

export interface DeviceFingerprint {
  type: FingerprintType;
  value: string;
}

export interface FingerprintSources {
  devicetreeSerial?: string;
  cpuinfo?: string;
  machineIdPaths?: string[];
}

const DEFAULT_SOURCES: Required<FingerprintSources> = {
  devicetreeSerial: '/sys/firmware/devicetree/base/serial-number',
  cpuinfo: '/proc/cpuinfo',
  machineIdPaths: ['/etc/machine-id', '/var/lib/dbus/machine-id'],
};

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function cleanSerial(raw: string | null | undefined): string | null {
  // The device-tree value is NUL-terminated.
  const serial = raw?.replace(/\0/g, '').trim().toLowerCase();
  if (!serial || !/^[0-9a-f]+$/.test(serial) || /^0+$/.test(serial)) return null;
  return serial;
}

export function readPiSerial(sources: FingerprintSources = {}): string | null {
  const s = { ...DEFAULT_SOURCES, ...sources };
  const fromDt = cleanSerial(readText(s.devicetreeSerial));
  if (fromDt) return fromDt;
  const cpuinfo = readText(s.cpuinfo);
  const match = cpuinfo?.match(/^Serial\s*:\s*([0-9a-fA-F]+)\s*$/m);
  return cleanSerial(match?.[1]);
}

function readMachineId(paths: string[]): string | null {
  for (const p of paths) {
    const id = readText(p)?.trim();
    if (id) return id;
  }
  return null;
}

const MAC_PREFIXES = ['eth', 'end', 'enp', 'en', 'wlan', 'wlp'];
const ZERO_MAC = '00:00:00:00:00:00';

function byPreference(names: string[]): string[] {
  const rank = (n: string) => {
    const i = MAC_PREFIXES.findIndex((p) => n.startsWith(p));
    return i === -1 ? MAC_PREFIXES.length : i;
  };
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Primary MAC. On Linux read /sys/class/net so an unplugged or down
 * interface (which os.networkInterfaces() omits) still counts and the
 * fingerprint does not change with link state. Only physical interfaces
 * (those with a `device` link) are considered there.
 */
function primaryMac(sysClassNet = '/sys/class/net'): string | null {
  try {
    const physical = readdirSync(sysClassNet).filter((n) =>
      existsSync(join(sysClassNet, n, 'device'))
    );
    for (const name of byPreference(physical)) {
      const mac = readText(join(sysClassNet, name, 'address'))
        ?.trim()
        .toLowerCase();
      if (mac && mac !== ZERO_MAC) return mac;
    }
  } catch {
    // not Linux
  }
  const interfaces = networkInterfaces();
  for (const name of byPreference(Object.keys(interfaces))) {
    const mac = (interfaces[name] ?? []).find(
      (a) => !a.internal && a.mac && a.mac !== ZERO_MAC
    )?.mac;
    if (mac) return mac.toLowerCase();
  }
  return null;
}

export function computeDeviceFingerprint(sources: FingerprintSources = {}): DeviceFingerprint {
  const serial = readPiSerial(sources);
  if (serial) return { type: 'pi_serial', value: serial };

  const s = { ...DEFAULT_SOURCES, ...sources };
  // No machine-id outside Linux (e.g. a macOS dev machine): fall back to the hostname.
  const machineId = readMachineId(s.machineIdPaths) ?? `host:${hostname()}`;
  const mac = primaryMac() ?? 'no-mac';
  const value = createHash('sha256').update(`${machineId}:${mac}`).digest('hex').slice(0, 32);
  return { type: 'machine_id', value };
}

let cached: DeviceFingerprint | null = null;

/** This device's fingerprint (computed once per process). */
export function getDeviceFingerprint(): DeviceFingerprint {
  if (!cached) cached = computeDeviceFingerprint();
  return cached;
}
