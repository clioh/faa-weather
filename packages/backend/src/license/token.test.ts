import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyToken } from './token.js';
import { generateKeyPairSync, sign, type KeyObject } from 'crypto';

interface TestSigner {
  publicPem: string;
  privateKey: KeyObject;
}

function makeSigner(): TestSigner {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey };
}

function makeToken(
  signer: TestSigner,
  payload: { fp: string; iat: number; exp: number; lid?: string; v?: number }
): string {
  const json = Buffer.from(JSON.stringify({ v: 1, lid: 'lic-1', ...payload }));
  return `${json.toString('base64url')}.${sign(null, json, signer.privateKey).toString('base64url')}`;
}

const FP = 'pi-serial-1';
const NOW = 1_761_000_000_000;
const iat = NOW / 1000;
const exp = iat + 30 * 86400;

describe('verifyToken', () => {
  const signer = makeSigner();

  beforeEach(() => {
    process.env.SKYGLASS_LICENSE_PUBLIC_KEY = signer.publicPem;
  });
  afterEach(() => {
    delete process.env.SKYGLASS_LICENSE_PUBLIC_KEY;
  });

  it('accepts a good token', () => {
    const r = verifyToken(makeToken(signer, { fp: FP, iat, exp }), FP, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toMatchObject({ v: 1, lid: 'lic-1', fp: FP, exp });
  });

  it('accepts the env override as base64-encoded PEM', () => {
    process.env.SKYGLASS_LICENSE_PUBLIC_KEY = Buffer.from(signer.publicPem).toString('base64');
    expect(verifyToken(makeToken(signer, { fp: FP, iat, exp }), FP, NOW).ok).toBe(true);
  });

  it('rejects a token signed by another key', () => {
    const other = makeSigner();
    expect(verifyToken(makeToken(other, { fp: FP, iat, exp }), FP, NOW)).toMatchObject({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a tampered payload', () => {
    const [, sig] = makeToken(signer, { fp: FP, iat, exp }).split('.');
    const forged = Buffer.from(JSON.stringify({ v: 1, lid: 'lic-1', fp: FP, iat, exp: exp + 1e6 })).toString(
      'base64url'
    );
    expect(verifyToken(`${forged}.${sig}`, FP, NOW)).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('rejects the placeholder key (no override)', () => {
    delete process.env.SKYGLASS_LICENSE_PUBLIC_KEY;
    expect(verifyToken(makeToken(signer, { fp: FP, iat, exp }), FP, NOW).ok).toBe(false);
  });

  it('rejects a token for another device', () => {
    expect(verifyToken(makeToken(signer, { fp: 'other', iat, exp }), FP, NOW)).toMatchObject({
      ok: false,
      reason: 'wrong_device',
    });
  });

  it('rejects an expired token (now >= exp)', () => {
    const token = makeToken(signer, { fp: FP, iat, exp });
    expect(verifyToken(token, FP, exp * 1000)).toMatchObject({ ok: false, reason: 'expired' });
    expect(verifyToken(token, FP, exp * 1000 - 1).ok).toBe(true);
  });

  it('rejects malformed tokens', () => {
    for (const t of [undefined, '', 'abc', 'a.b.c', '.x', 'eyJ2IjoxfQ.AAAA']) {
      expect(verifyToken(t, FP, NOW).ok).toBe(false);
    }
  });
});
