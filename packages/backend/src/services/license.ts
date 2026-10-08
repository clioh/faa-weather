/**
 * License Service
 *
 * Handles device fingerprinting and license activation/validation.
 */

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { networkInterfaces, hostname } from 'os';
import { loadConfig } from '../config/index.js';
import {
  getLicenseCache,
  updateLicenseCache,
  clearLicenseCache,
  getMirrorId,
  getStoredLicenseKey,
  setStoredLicenseKey,
} from '../db/index.js';

interface DeviceFingerprint {
  type: 'pi_serial' | 'machine_id';
  value: string;
}

// Status returned to frontend
export interface LicenseStatus {
  status: 'valid' | 'invalid' | 'no_license' | 'error';
  message?: string;
  activatedAt?: string;
}

// Result of activation attempt
export interface ActivationResult {
  success: boolean;
  status: 'active' | 'bound_to_another_device' | 'invalid' | 'revoked' | 'not_found' | 'error';
  message: string;
  activatedAt?: string;
}

/**
 * Get the device fingerprint
 * Tries Pi serial first, falls back to machine-id + MAC hash
 */
export function getDeviceFingerprint(): DeviceFingerprint {
  // Try Raspberry Pi serial first
  const piSerial = readPiSerial();
  if (piSerial && piSerial !== '0000000000000000') {
    return { type: 'pi_serial', value: piSerial };
  }

  // Fallback: machine-id + MAC address
  const machineId = getMachineId();
  const mac = getPrimaryMacAddress();

  if (!machineId && !mac) {
    throw new Error('Unable to generate device fingerprint');
  }

  const hash = createHash('sha256')
    .update(`${machineId}:${mac}`)
    .digest('hex')
    .slice(0, 32);

  return { type: 'machine_id', value: hash };
}

/**
 * Read Raspberry Pi serial number from /proc/cpuinfo
 */
function readPiSerial(): string | null {
  try {
    if (!existsSync('/proc/cpuinfo')) {
      return null;
    }

    const cpuinfo = readFileSync('/proc/cpuinfo', 'utf8');
    const match = cpuinfo.match(/Serial\s*:\s*([0-9a-fA-F]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Get machine ID from /etc/machine-id (Linux) or equivalent
 */
function getMachineId(): string | null {
  const paths = ['/etc/machine-id', '/var/lib/dbus/machine-id'];

  for (const path of paths) {
    try {
      if (existsSync(path)) {
        return readFileSync(path, 'utf8').trim();
      }
    } catch {
      continue;
    }
  }

  // Fallback for macOS
  try {
    return createHash('sha256').update(hostname()).digest('hex').slice(0, 32);
  } catch {
    return null;
  }
}

/**
 * Get primary MAC address
 */
function getPrimaryMacAddress(): string | null {
  const interfaces = networkInterfaces();
  const preferredPrefixes = ['eth', 'en', 'wlan', 'enp', 'wlp'];

  for (const prefix of preferredPrefixes) {
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (name.startsWith(prefix) && addrs) {
        for (const addr of addrs) {
          if (addr.mac && addr.mac !== '00:00:00:00:00:00') {
            return addr.mac;
          }
        }
      }
    }
  }

  for (const addrs of Object.values(interfaces)) {
    if (addrs) {
      for (const addr of addrs) {
        if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
          return addr.mac;
        }
      }
    }
  }

  return null;
}

/**
 * Get the license key (from database first, then config fallback)
 */
export function getLicenseKey(): string | null {
  // First check database (user-entered via mobile app)
  const storedKey = getStoredLicenseKey();
  if (storedKey) {
    return storedKey;
  }

  // Fallback to config file (for pre-installed keys)
  const config = loadConfig();
  return config.license?.key || null;
}

/**
 * Get license status for frontend
 */
export function getLicenseStatus(): LicenseStatus {
  const config = loadConfig();

  // If license system is disabled, always return valid
  if (!config.license?.enabled) {
    return { status: 'valid', message: 'License system disabled' };
  }

  // Check if we have a license key at all
  const licenseKey = getLicenseKey();
  if (!licenseKey) {
    return { status: 'no_license', message: 'No license key configured' };
  }

  // Check cached status
  const cache = getLicenseCache();
  if (cache?.license_key === licenseKey) {
    return {
      status: cache.status === 'valid' ? 'valid' : 'invalid',
      activatedAt: cache.activated_at || undefined,
    };
  }

  // No cache yet - needs activation
  return { status: 'no_license', message: 'License not yet activated' };
}

/**
 * Activate license with the license server
 */
export async function activateLicense(licenseKey?: string): Promise<ActivationResult> {
  const config = loadConfig();
  const key = licenseKey || getLicenseKey();

  if (!key) {
    console.log('[License] No license key provided');
    return {
      success: false,
      status: 'error',
      message: 'No license key provided',
    };
  }

  const licenseServerUrl = config.license?.serverUrl || 'https://license.skyglass.dev';

  console.log('[License] Attempting activation...');

  try {
    const fingerprint = getDeviceFingerprint();
    const mirrorId = getMirrorId();

    console.log(`[License] Device fingerprint type: ${fingerprint.type}`);
    console.log(`[License] Mirror ID: ${mirrorId}`);

    const response = await fetch(`${licenseServerUrl}/api/v1/licenses/activate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        licenseKey: key,
        deviceFingerprint: fingerprint.value,
        deviceFingerprintType: fingerprint.type,
        deviceMirrorId: mirrorId,
      }),
    });

    const data = (await response.json()) as {
      success: boolean;
      status: string;
      message: string;
      activatedAt?: string;
    };

    if (data.success) {
      // Store the key and cache the valid status
      if (licenseKey) {
        setStoredLicenseKey(licenseKey);
      }
      updateLicenseCache(key, 'valid', data.activatedAt);
      console.log('[License] Activation successful');

      return {
        success: true,
        status: 'active',
        message: data.message,
        activatedAt: data.activatedAt,
      };
    }

    // Handle specific error statuses
    if (data.status === 'bound_to_another_device') {
      // Don't store the key if it's bound to another device
      updateLicenseCache(key, 'invalid');
      console.log('[License] License bound to another device');

      return {
        success: false,
        status: 'bound_to_another_device',
        message: data.message,
      };
    }

    if (data.status === 'revoked') {
      updateLicenseCache(key, 'invalid');
      console.log('[License] License has been revoked');

      return {
        success: false,
        status: 'revoked',
        message: data.message,
      };
    }

    if (response.status === 404) {
      console.log('[License] License key not found');
      return {
        success: false,
        status: 'not_found',
        message: 'License key not found',
      };
    }

    // Other failures
    console.log(`[License] Activation failed: ${data.message}`);
    return {
      success: false,
      status: 'invalid',
      message: data.message,
    };
  } catch (error) {
    console.error('[License] Activation error:', error);

    // On network error, check cached status
    const cache = getLicenseCache();
    if (cache?.status === 'valid') {
      console.log('[License] Using cached valid status (offline)');
      return {
        success: true,
        status: 'active',
        message: 'Using cached license (offline)',
        activatedAt: cache.activated_at || undefined,
      };
    }

    return {
      success: false,
      status: 'error',
      message: 'Failed to connect to license server',
    };
  }
}

/**
 * Save and activate a license key (called from mobile app)
 */
export async function setLicenseKey(licenseKey: string): Promise<ActivationResult> {
  // Clear any previous cache
  clearLicenseCache();

  // Attempt activation with the new key
  const result = await activateLicense(licenseKey);

  // Only store the key if activation succeeded
  if (result.success) {
    setStoredLicenseKey(licenseKey);
  }

  return result;
}

/**
 * Validate the license on startup
 * Returns: 'valid' | 'invalid' | 'no_license'
 */
export async function validateLicense(): Promise<'valid' | 'invalid' | 'no_license'> {
  const config = loadConfig();

  // Check if license system is enabled
  if (!config.license?.enabled) {
    console.log('[License] License system disabled');
    return 'valid';
  }

  const licenseKey = getLicenseKey();
  if (!licenseKey) {
    console.log('[License] No license key - awaiting user entry');
    return 'no_license';
  }

  // Check cached status first
  const cache = getLicenseCache();
  if (cache?.license_key === licenseKey) {
    if (cache.status === 'valid') {
      console.log('[License] Using cached valid status');
      return 'valid';
    }
    if (cache.status === 'invalid') {
      console.log('[License] Cached status is invalid');
      return 'invalid';
    }
  }

  // Attempt activation
  const result = await activateLicense();

  if (result.success) {
    return 'valid';
  }

  if (result.status === 'bound_to_another_device' || result.status === 'revoked') {
    return 'invalid';
  }

  // For other errors (network, not found), treat as needing license
  return 'no_license';
}

export const licenseService = {
  getDeviceFingerprint,
  getLicenseKey,
  getLicenseStatus,
  activateLicense,
  setLicenseKey,
  validateLicense,
};
