import { describe, it, expect } from 'vitest';
import { isValidHost, mirrorOrigin, normalizeHost } from './hosts';

describe('hosts', () => {
  it.each(['192.168.1.27', 'skyglass.local', 'fe80::1', '::1', 'fe80::1%en0', '2001:db8::42'])(
    'accepts %s',
    (host) => expect(isValidHost(host)).toBe(true)
  );

  it.each(['', 'a b', 'evil.com/x', 'host:3001', '[fe80::1]', 'fe80::1%', 'user@host'])(
    'rejects %s',
    (host) => expect(isValidHost(host)).toBe(false)
  );

  it('normalizes brackets and whitespace', () => {
    expect(normalizeHost(' [fe80::1] ')).toBe('fe80::1');
    expect(normalizeHost('skyglass.local')).toBe('skyglass.local');
    expect(normalizeHost('a/b')).toBeNull();
    expect(normalizeHost(undefined)).toBeNull();
  });

  it('brackets IPv6 in origins', () => {
    expect(mirrorOrigin('192.168.1.27', 3001)).toBe('http://192.168.1.27:3001');
    expect(mirrorOrigin('skyglass.local', 3001)).toBe('http://skyglass.local:3001');
    expect(mirrorOrigin('fe80::1', 3001)).toBe('http://[fe80::1]:3001');
    expect(mirrorOrigin('fe80::1%en0', 3001)).toBe('http://[fe80::1%25en0]:3001');
  });
});
