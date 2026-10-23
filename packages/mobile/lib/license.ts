/**
 * License keys (see docs/LICENSING.md, "License keys").
 *
 * Keys look like XXXX-XXXX-XXXX-XXXX from the alphabet
 * ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no 0, O, 1 or I). The mirror and the
 * server normalize the same way, so what this produces is what they accept.
 */

export const LICENSE_KEY_PATTERN = /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/;

/** Characters in a key, without dashes. */
export const LICENSE_KEY_LENGTH = 16;

/** Where customers release a license from a mirror or have a key re-sent. */
export const LICENSE_MANAGE_URL = 'https://skyglass.dev/license';

/** Where someone without a license can buy one. */
export const STORE_URL = 'https://skyglass.dev';

function groupInFours(raw: string): string {
  return raw.match(/.{1,4}/g)?.join('-') ?? '';
}

/**
 * Spec normalization: strip whitespace and dashes, uppercase, re-insert a
 * dash every 4 characters, then validate. Returns null when the result is
 * not a well-formed key.
 */
export function normalizeLicenseKey(input: string): string | null {
  const key = groupInFours(input.replace(/[\s-]/g, '').toUpperCase());
  return LICENSE_KEY_PATTERN.test(key) ? key : null;
}

/**
 * As-you-type formatting for the key field: uppercases, drops anything that
 * is not a letter or digit (spaces, dashes, stray punctuation from a paste),
 * caps the length and re-inserts the dashes. Look-alike characters (0, O, 1,
 * I) are kept so validation can point them out instead of silently eating them.
 */
export function formatLicenseKeyInput(input: string): string {
  const raw = input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, LICENSE_KEY_LENGTH);
  return groupInFours(raw);
}

/** Why a typed key is not valid yet, or null when it is. */
export function licenseKeyProblem(input: string): string | null {
  const raw = input.replace(/[\s-]/g, '').toUpperCase();
  if (/[01OI]/.test(raw)) {
    return 'License keys never contain 0, O, 1 or I. Check for a look-alike character.';
  }
  if (/[^A-Z2-9]/.test(raw)) {
    return 'License keys only contain letters and the digits 2 to 9.';
  }
  if (raw.length < LICENSE_KEY_LENGTH) {
    const left = LICENSE_KEY_LENGTH - raw.length;
    return `${left} more character${left === 1 ? '' : 's'} to go.`;
  }
  return normalizeLicenseKey(input) ? null : 'That doesn’t look like a SkyGlass license key.';
}
