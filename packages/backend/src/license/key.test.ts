import { describe, expect, it } from 'vitest';
import { normalizeLicenseKey } from './key.js';

describe('normalizeLicenseKey', () => {
  it('normalizes case, whitespace and dashes', () => {
    expect(normalizeLicenseKey('abcd-efgh-jkmn-pqrs')).toBe('ABCD-EFGH-JKMN-PQRS');
    expect(normalizeLicenseKey(' abcdefgh jkmn\tpqrs\n')).toBe('ABCD-EFGH-JKMN-PQRS');
    expect(normalizeLicenseKey('AB-CDEF-GHJK-MNPQ-RS')).toBe('ABCD-EFGH-JKMN-PQRS');
    expect(normalizeLicenseKey('2345-6789-ABCD-WXYZ')).toBe('2345-6789-ABCD-WXYZ');
  });

  it('rejects ambiguous characters, wrong lengths and non-strings', () => {
    expect(normalizeLicenseKey('ABCD-EFGH-JKMN-PQR0')).toBeNull(); // 0
    expect(normalizeLicenseKey('ABCD-EFGH-JKMN-PQRO')).toBeNull(); // O
    expect(normalizeLicenseKey('ABCD-EFGH-JKMN-PQR1')).toBeNull(); // 1
    expect(normalizeLicenseKey('ABCD-EFGH-JKMN-PQRI')).toBeNull(); // I
    expect(normalizeLicenseKey('ABCD-EFGH-JKMN-PQR')).toBeNull();
    expect(normalizeLicenseKey('ABCD-EFGH-JKMN-PQRST')).toBeNull();
    expect(normalizeLicenseKey('')).toBeNull();
    expect(normalizeLicenseKey(42)).toBeNull();
    expect(normalizeLicenseKey(undefined)).toBeNull();
  });
});
