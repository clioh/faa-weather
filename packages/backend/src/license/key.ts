/**
 * License key normalization (docs/LICENSING.md "License keys"): strip
 * whitespace and dashes, uppercase, re-insert a dash every 4 characters,
 * then validate. Same rules as the phone app and the cloud API.
 */

export const LICENSE_KEY_PATTERN = /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/;

/** Normalized `XXXX-XXXX-XXXX-XXXX`, or null when the input is not a valid key. */
export function normalizeLicenseKey(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.replace(/[\s-]/g, '').toUpperCase();
  const key = compact.match(/.{1,4}/g)?.join('-') ?? '';
  return LICENSE_KEY_PATTERN.test(key) ? key : null;
}

export function keyLast4(key: string): string {
  return key.slice(-4);
}
