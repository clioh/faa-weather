/**
 * Ed25519 public key the mirror uses to verify activation tokens
 * (docs/LICENSING.md "Activation token").
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ PLACEHOLDER: replace LICENSE_PUBLIC_KEY_PEM with the public half of  │
 * │ LICENSE_SIGNING_KEY (generate with `node scripts/license-keygen.mjs`) │
 * │ before release. The private half of this placeholder was discarded,  │
 * │ so no token verifies against it.                                     │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * SKYGLASS_LICENSE_PUBLIC_KEY overrides it (local testing against
 * `vercel dev`): either the PEM itself or the PEM base64-encoded onto one line.
 */

export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA855sOB1d6XylUYPx/qCsCopCDHFpPcQgfpNT+3+yLLw=
-----END PUBLIC KEY-----
`;

/** True while LICENSE_PUBLIC_KEY_PEM is still the placeholder above. */
export const LICENSE_PUBLIC_KEY_IS_PLACEHOLDER = true;

/** The PEM to verify with: the env override when set, else the embedded key. */
export function getLicensePublicKeyPem(): string {
  const override = process.env.SKYGLASS_LICENSE_PUBLIC_KEY?.trim();
  if (!override) return LICENSE_PUBLIC_KEY_PEM;
  if (override.includes('-----BEGIN')) return override.replace(/\\n/g, '\n');
  return Buffer.from(override, 'base64').toString('utf8');
}

/** True when tokens are verified against the placeholder key (no override set). */
export function usingPlaceholderPublicKey(): boolean {
  return LICENSE_PUBLIC_KEY_IS_PLACEHOLDER && !process.env.SKYGLASS_LICENSE_PUBLIC_KEY?.trim();
}
