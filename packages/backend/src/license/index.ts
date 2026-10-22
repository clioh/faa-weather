/**
 * Process-wide license manager wired to the SQLite store and config.yaml.
 * See manager.ts and docs/LICENSING.md.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../config/index.js';
import { getLicenseState, getMirrorId, saveLicenseState } from '../db/index.js';
import { getDeviceFingerprint } from './fingerprint.js';
import { LicenseManager } from './manager.js';

export { normalizeLicenseKey, LICENSE_KEY_PATTERN } from './key.js';
export type { LicenseState, LicenseStatus, LicenseErrorCode, SubmitKeyResult } from './manager.js';
export { usingPlaceholderPublicKey } from './public-key.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

let appVersion: string | undefined;
function readAppVersion(): string | undefined {
  if (appVersion !== undefined) return appVersion || undefined;
  appVersion = '';
  try {
    const versionFile = join(REPO_ROOT, 'VERSION');
    appVersion = existsSync(versionFile)
      ? readFileSync(versionFile, 'utf8').trim()
      : String(JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version ?? '');
  } catch {
    // unknown version is fine (optional field)
  }
  return appVersion || undefined;
}

export const licenseManager = new LicenseManager({
  store: { load: getLicenseState, save: saveLicenseState },
  config: () => loadConfig().license,
  fingerprint: getDeviceFingerprint,
  mirrorId: () => {
    try {
      return getMirrorId();
    } catch {
      return undefined;
    }
  },
  appVersion: readAppVersion,
});
