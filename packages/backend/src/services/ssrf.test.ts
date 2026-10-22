import { describe, it, expect } from 'vitest';
import { assertPublicUrl, isBlockedAddress, UnsafeUrlError } from './ssrf.js';

const resolver = (map: Record<string, string[]>) => async (host: string) => {
  if (!(host in map)) throw new Error('ENOTFOUND');
  return map[host];
};

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.0.9',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.251',
    '::1',
    '::',
    'fe80::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:192.168.0.1',
    '::ffff:7f00:1',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '192.169.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );

  it('blocks non-IP input', () => {
    expect(isBlockedAddress('example.com')).toBe(true);
  });
});

describe('assertPublicUrl', () => {
  const resolve = resolver({
    'feeds.example.com': ['93.184.216.34'],
    'internal.example.com': ['10.0.0.5'],
    'mixed.example.com': ['93.184.216.34', '192.168.1.1'],
    'v6.example.com': ['2606:4700::1111'],
  });

  it('accepts public http(s) URLs', async () => {
    await expect(assertPublicUrl('https://feeds.example.com/rss', resolve)).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl('http://v6.example.com/feed', resolve)).resolves.toBeInstanceOf(URL);
  });

  it.each([
    'ftp://feeds.example.com/rss',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
    'http://localhost:3001/api/config',
    'http://foo.localhost/',
    'http://127.0.0.1/',
    'http://[::1]:3001/',
    'http://169.254.169.254/latest/meta-data/',
    'http://internal.example.com/feed',
    'http://mixed.example.com/feed',
    'http://unresolvable.example.com/',
  ])('rejects %s', async (url) => {
    await expect(assertPublicUrl(url, resolve)).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});
