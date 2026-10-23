import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo, LookupAddress } from 'net';
import {
  assertPublicUrl,
  createGuardedLookup,
  isBlockedAddress,
  safeFetchText,
  UnsafeUrlError,
} from './ssrf.js';

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

  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '172.32.0.1',
    '192.169.0.1',
    '2606:4700::1111',
    '::ffff:8.8.8.8',
  ])('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

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
    await expect(assertPublicUrl('https://feeds.example.com/rss', resolve)).resolves.toBeInstanceOf(
      URL
    );
    await expect(assertPublicUrl('http://v6.example.com/feed', resolve)).resolves.toBeInstanceOf(
      URL
    );
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

/** Resolver that answers from a list of responses, one per call (last one repeats). */
const sequence = (...answers: string[][]) => {
  let calls = 0;
  const fn = async () => answers[Math.min(calls++, answers.length - 1)];
  return Object.assign(fn, { calls: () => calls });
};

type LookupResult = {
  err: NodeJS.ErrnoException | null;
  address: string | LookupAddress[];
  family?: number;
};

function runLookup(
  lookup: ReturnType<typeof createGuardedLookup>,
  host: string,
  options: { all?: boolean; family?: number } = {}
): Promise<LookupResult> {
  return new Promise((resolve) => {
    lookup(
      host,
      options as never,
      ((err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) =>
        resolve({ err, address, family })) as never
    );
  });
}

describe('createGuardedLookup', () => {
  it('returns the checked addresses (single and all)', async () => {
    const lookup = createGuardedLookup(async () => ['93.184.216.34', '2606:4700::1111']);
    const one = await runLookup(lookup, 'feeds.example.com');
    expect(one).toMatchObject({ err: null, address: '93.184.216.34', family: 4 });
    const all = await runLookup(lookup, 'feeds.example.com', { all: true });
    expect(all.address).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700::1111', family: 6 },
    ]);
    const v6 = await runLookup(lookup, 'feeds.example.com', { family: 6 });
    expect(v6).toMatchObject({ err: null, address: '2606:4700::1111', family: 6 });
  });

  it.each([
    [['10.0.0.5']],
    [['93.184.216.34', '192.168.1.1']],
    [['::1']],
    [['fd00::1']],
    [['::ffff:10.0.0.5']],
    [['::ffff:7f00:1']],
    [['not-an-ip']],
    [[]],
  ])('fails closed for %j', async (answer) => {
    const { err } = await runLookup(
      createGuardedLookup(async () => answer),
      'h.example.com',
      { all: true }
    );
    expect(err).toBeInstanceOf(UnsafeUrlError);
  });

  it('fails closed when resolution errors', async () => {
    const lookup = createGuardedLookup(async () => {
      throw new Error('ENOTFOUND');
    });
    expect((await runLookup(lookup, 'h.example.com')).err).toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses a rebind between the pre-check and the connect-time lookup', async () => {
    const resolve = sequence(['93.184.216.34'], ['10.0.0.5']);
    await expect(assertPublicUrl('http://rebind.example.com/', resolve)).resolves.toBeInstanceOf(
      URL
    );
    const { err } = await runLookup(createGuardedLookup(resolve), 'rebind.example.com', {
      all: true,
    });
    expect(err).toBeInstanceOf(UnsafeUrlError);
  });

  it('checks literal IPs it is handed directly', async () => {
    const lookup = createGuardedLookup(async () => ['93.184.216.34']);
    expect((await runLookup(lookup, '[::ffff:127.0.0.1]')).err).toBeInstanceOf(UnsafeUrlError);
    expect((await runLookup(lookup, '8.8.8.8')).address).toBe('8.8.8.8');
  });
});

describe('safeFetchText', () => {
  // A loopback server stands in for "a public host": the test block check
  // allows 127.0.0.1 only, so everything else private stays blocked. No DNS
  // or outside network is used; hostnames resolve through the test resolver.
  const allowLoopback = (ip: string) => ip !== '127.0.0.1' && isBlockedAddress(ip);
  let server: Server;
  let port = 0;
  let hits: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(`${req.headers.host}${req.url}`);
      const redirects: Record<string, string> = {
        '/to-private-host': 'http://internal.example.com/feed',
        '/to-private-ip': 'http://10.0.0.5/feed',
        '/to-mapped-v6': 'http://[::ffff:a00:5]/feed',
        '/to-rebinder': `http://rebind.example.com:${port}/feed`,
        '/to-ok': `http://other.example.com:${port}/feed`,
      };
      const target = req.url ? redirects[req.url] : undefined;
      if (target) {
        res.writeHead(302, { location: target });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('feed body');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const base = () => `http://feeds.example.com:${port}`;

  it('connects to the address the guarded lookup returned and follows safe redirects', async () => {
    hits = [];
    const resolve = async (host: string) => (host.endsWith('.example.com') ? ['127.0.0.1'] : []);
    await expect(
      safeFetchText(`${base()}/feed`, { resolve, isBlocked: allowLoopback })
    ).resolves.toBe('feed body');
    await expect(
      safeFetchText(`${base()}/to-ok`, { resolve, isBlocked: allowLoopback })
    ).resolves.toBe('feed body');
    expect(hits).toEqual([
      `feeds.example.com:${port}/feed`,
      `feeds.example.com:${port}/to-ok`,
      `other.example.com:${port}/feed`,
    ]);
  });

  it.each([
    ['private IPv4', ['10.0.0.5']],
    ['loopback IPv6', ['::1']],
    ['IPv4-mapped IPv6', ['::ffff:10.0.0.5']],
  ])('refuses a DNS rebind to %s at connect time', async (_label, second) => {
    hits = [];
    const resolve = sequence(['127.0.0.1'], second);
    await expect(
      safeFetchText(`${base()}/feed`, { resolve, isBlocked: allowLoopback })
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(resolve.calls()).toBe(2);
    expect(hits).toEqual([]);
  });

  it.each(['/to-private-host', '/to-private-ip', '/to-mapped-v6'])(
    'refuses a redirect %s',
    async (path) => {
      hits = [];
      const resolve = async (host: string) =>
        host === 'internal.example.com' ? ['10.0.0.5'] : ['127.0.0.1'];
      await expect(
        safeFetchText(`${base()}${path}`, { resolve, isBlocked: allowLoopback })
      ).rejects.toBeInstanceOf(UnsafeUrlError);
      expect(hits).toEqual([`feeds.example.com:${port}${path}`]);
    }
  );

  it('refuses a redirect hop whose host rebinds at connect time', async () => {
    hits = [];
    let rebindCalls = 0;
    const resolve = async (host: string) =>
      host === 'rebind.example.com'
        ? rebindCalls++ === 0
          ? ['127.0.0.1']
          : ['192.168.1.1']
        : ['127.0.0.1'];
    await expect(
      safeFetchText(`${base()}/to-rebinder`, { resolve, isBlocked: allowLoopback })
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(hits).toEqual([`feeds.example.com:${port}/to-rebinder`]);
  });

  it.each([
    'http://10.0.0.1/',
    'http://127.0.0.1:3001/api/config',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[fd00::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:a00:1]/',
  ])('refuses literal private IP %s without connecting', async (url) => {
    await expect(safeFetchText(url, { resolve: async () => [] })).rejects.toBeInstanceOf(
      UnsafeUrlError
    );
  });
});
