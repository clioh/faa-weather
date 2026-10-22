/**
 * Activation token verification (docs/LICENSING.md "Activation token"):
 * `base64url(payloadJson) + "." + base64url(ed25519Signature(payloadJsonBytes))`.
 * Accepted when the signature verifies, `fp` matches this device and now < exp.
 */

import { createPublicKey, verify, type KeyObject } from 'crypto';
import { getLicensePublicKeyPem } from './public-key.js';

export interface TokenPayload {
  v: 1;
  lid: string;
  fp: string;
  iat: number;
  exp: number;
}

export type TokenCheck =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'wrong_device' | 'expired'; payload?: TokenPayload };

let cachedKey: { pem: string; key: KeyObject } | null = null;

function publicKey(): KeyObject {
  const pem = getLicensePublicKeyPem();
  if (cachedKey?.pem !== pem) cachedKey = { pem, key: createPublicKey(pem) };
  return cachedKey.key;
}

function parsePayload(bytes: Buffer): TokenPayload | null {
  try {
    const p = JSON.parse(bytes.toString('utf8')) as Partial<TokenPayload>;
    if (
      p?.v === 1 &&
      typeof p.lid === 'string' &&
      typeof p.fp === 'string' &&
      typeof p.iat === 'number' &&
      typeof p.exp === 'number'
    ) {
      return p as TokenPayload;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Verify a token for this device. `nowMs` is a JS timestamp (ms); the token's
 * `exp` is Unix seconds.
 */
export function verifyToken(token: unknown, fingerprint: string, nowMs: number = Date.now()): TokenCheck {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };

  const payloadBytes = Buffer.from(parts[0], 'base64url');
  const signature = Buffer.from(parts[1], 'base64url');
  const payload = parsePayload(payloadBytes);
  if (!payload) return { ok: false, reason: 'malformed' };

  let valid = false;
  try {
    valid = verify(null, payloadBytes, publicKey(), signature);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };
  if (payload.fp !== fingerprint) return { ok: false, reason: 'wrong_device', payload };
  if (!(nowMs < payload.exp * 1000)) return { ok: false, reason: 'expired', payload };
  return { ok: true, payload };
}

/** Decode a token's payload without verifying it (display/expiry bookkeeping only). */
export function decodeTokenPayload(token: string | null | undefined): TokenPayload | null {
  if (!token) return null;
  const [head] = token.split('.');
  return head ? parsePayload(Buffer.from(head, 'base64url')) : null;
}
