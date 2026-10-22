/**
 * Mirror license status (docs/LICENSING.md, "Mirror").
 */

export type LicenseState =
  | 'disabled'
  | 'unlicensed'
  | 'active'
  | 'expired'
  | 'released'
  | 'revoked'
  | 'bound_elsewhere';

/** GET /api/license/status, and the payload of the WS `license` event. */
export interface LicenseStatus {
  enabled: boolean;
  state: LicenseState;
  keyLast4?: string;
  activatedAt?: string;
  expiresAt?: string;
  lastCheckedAt?: string;
  message?: string;
  /** A pre-installed key file is waiting to be activated (the mirror retries on its own). */
  keyFilePending?: boolean;
  supportEmail: string;
  manageUrl: string;
}

export const DEFAULT_SUPPORT_EMAIL = 'support@skyglass.dev';
export const DEFAULT_MANAGE_URL = 'https://skyglass.dev/license';

/** States that take over the mirror after setup. */
export function licenseBlocksMirror(status: LicenseStatus | null): boolean {
  if (!status || status.enabled === false) return false;
  return status.state !== 'active' && status.state !== 'disabled';
}
