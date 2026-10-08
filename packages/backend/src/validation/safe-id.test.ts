import { describe, it, expect } from 'vitest';
import path from 'path';
import { isSafeId, resolveSafePath, SAFE_ID_PATTERN } from './safe-id.js';

describe('isSafeId', () => {
  it('accepts allowlisted ids', () => {
    for (const id of ['layout-1700000000000', 'abc', 'A_b-9', 'x'.repeat(64), 'user_1']) {
      expect(isSafeId(id)).toBe(true);
    }
  });

  it('rejects traversal, separators and other characters', () => {
    const bad = [
      '',
      '..',
      '../oauth_tokens',
      '..%2Foauth_tokens',
      '..\\oauth_tokens',
      'a/b',
      'a\\b',
      '/etc/passwd',
      'a.json',
      'a b',
      'a\0b',
      'x'.repeat(65),
      'ümlaut',
    ];
    for (const id of bad) {
      expect(isSafeId(id)).toBe(false);
    }
  });

  it('rejects non-strings', () => {
    expect(isSafeId(undefined)).toBe(false);
    expect(isSafeId(null)).toBe(false);
    expect(isSafeId(123)).toBe(false);
    expect(isSafeId(['abc'])).toBe(false);
    expect(isSafeId({ toString: () => 'abc' })).toBe(false);
  });

  it('pattern is anchored', () => {
    expect(SAFE_ID_PATTERN.test('ok\n../x')).toBe(false);
  });
});

describe('resolveSafePath', () => {
  const base = path.resolve('/tmp/skyglass-test/layouts');

  it('resolves a valid id inside the base directory', () => {
    expect(resolveSafePath(base, 'layout-1', '.json')).toBe(path.join(base, 'layout-1.json'));
  });

  it('returns null for traversal attempts', () => {
    expect(resolveSafePath(base, '../oauth_tokens', '.json')).toBeNull();
    expect(resolveSafePath(base, '..', '')).toBeNull();
    expect(resolveSafePath(base, '/etc/passwd', '')).toBeNull();
    expect(resolveSafePath(base, 'a/../../b', '.json')).toBeNull();
  });

  it('returns null for invalid input types', () => {
    expect(resolveSafePath(base, undefined, '.json')).toBeNull();
    expect(resolveSafePath(base, 42, '.json')).toBeNull();
  });
});
