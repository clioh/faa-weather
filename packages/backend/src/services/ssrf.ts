/**
 * SSRF guard for user-supplied URLs (custom news feeds).
 *
 * Only http/https URLs are allowed, and every address the host resolves to
 * must be public: loopback, link-local, private (RFC1918 / ULA), CGNAT,
 * unspecified, multicast and reserved ranges are rejected. Redirects are
 * followed manually so each hop is re-validated.
 *
 * DNS rebinding: safeFetchText connects through an undici Agent whose socket
 * `lookup` resolves the host, rejects the connection if any resolved address
 * is blocked, and hands the checked addresses straight to the socket. The
 * address that was checked is the address that is dialled, so a resolver that
 * answers "public" to the pre-check and "private" at connect time is refused.
 * Literal-IP hosts skip DNS and are checked as-is. TLS SNI and certificate
 * verification still use the URL's hostname.
 */

import { lookup } from 'dns/promises';
import { isIP, type LookupFunction } from 'net';
import { Agent } from 'undici';
import { UpstreamError, USER_AGENT, readBodyCapped } from './upstream.js';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (incl. cloud metadata)
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

export function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

/** Expand an IPv6 address into 8 16-bit groups. */
function expandIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf('%');
  if (zone !== -1) addr = addr.slice(0, zone);
  // Embedded IPv4 tail (e.g. ::ffff:1.2.3.4)
  const v4Match = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const n = ipv4ToInt(v4Match[1]);
    addr =
      addr.slice(0, -v4Match[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const parts = addr.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(fill).fill('0'), ...tail].map((g) => parseInt(g, 16));
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null;
  return groups;
}

export function isBlockedIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return true;
  const allZeroPrefix = g.slice(0, 5).every((x) => x === 0);
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible)
  if (
    allZeroPrefix &&
    (g[5] === 0xffff || g[5] === 0) &&
    !(g[5] === 0 && g[6] === 0 && g[7] <= 1)
  ) {
    const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
    return isBlockedIPv4(v4);
  }
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 (could reach private v4)
  if (g[0] === 0x2002) return true; // 6to4 (embeds v4)
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIPv4(ip);
  if (family === 6) return isBlockedIPv6(ip);
  return true;
}

type Resolver = (host: string) => Promise<string[]>;
type BlockCheck = (ip: string) => boolean;

const defaultResolver: Resolver = async (host) => {
  const results = await lookup(host, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

/**
 * Validate a user-supplied URL. Returns the parsed URL or throws UnsafeUrlError.
 */
export async function assertPublicUrl(
  raw: string,
  resolve: Resolver = defaultResolver,
  isBlocked: BlockCheck = isBlockedAddress
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http and https URLs are allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new UnsafeUrlError('URL has no host');
  const lowered = host.toLowerCase();
  if (lowered === 'localhost' || lowered.endsWith('.localhost')) {
    throw new UnsafeUrlError('Private or local addresses are not allowed');
  }

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await resolve(host);
    } catch {
      throw new UnsafeUrlError('Could not resolve host');
    }
  }
  if (addresses.length === 0 || addresses.some((a) => isBlocked(a))) {
    throw new UnsafeUrlError('Private or local addresses are not allowed');
  }
  return url;
}

/**
 * A net/tls `lookup` that resolves with `resolve`, fails closed if the answer
 * is empty, unparseable or contains any blocked address, and otherwise returns
 * exactly the checked addresses for the socket to dial.
 */
export function createGuardedLookup(
  resolve: Resolver = defaultResolver,
  isBlocked: BlockCheck = isBlockedAddress
): LookupFunction {
  return (hostname, options, callback) => {
    const host = hostname.replace(/^\[|\]$/g, '');
    const literal = isIP(host);
    const pending = literal ? Promise.resolve([host]) : resolve(host);
    pending.then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some((a) => isIP(a) === 0 || isBlocked(a))) {
          callback(new UnsafeUrlError('Private or local addresses are not allowed'), '');
          return;
        }
        let entries = addresses.map((address) => ({ address, family: isIP(address) }));
        if (options.family === 4 || options.family === 6) {
          entries = entries.filter((e) => e.family === options.family);
        }
        if (entries.length === 0) {
          callback(Object.assign(new Error(`No address for ${host}`), { code: 'ENOTFOUND' }), '');
          return;
        }
        if (options.all) callback(null, entries);
        else callback(null, entries[0].address, entries[0].family);
      },
      () => callback(new UnsafeUrlError('Could not resolve host'), '')
    );
  };
}

function findUnsafeCause(error: unknown): UnsafeUrlError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof UnsafeUrlError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  resolve?: Resolver;
  /** Test hook: replaces isBlockedAddress (e.g. to allow a loopback test server). */
  isBlocked?: BlockCheck;
}

/**
 * Fetch a user-supplied URL as text, validating the target (and every
 * redirect hop) with assertPublicUrl. Defaults: 5 s total timeout, 2 MB cap.
 */
export async function safeFetchText(raw: string, opts: SafeFetchOptions = {}): Promise<string> {
  const {
    timeoutMs = 5000,
    maxBytes = 2 * 1024 * 1024,
    maxRedirects = 3,
    headers = {},
    resolve = defaultResolver,
    isBlocked = isBlockedAddress,
  } = opts;
  const signal = AbortSignal.timeout(timeoutMs);
  // One Agent per call: every connection it opens (every redirect hop) goes
  // through the guarded lookup, and it is torn down afterwards.
  const dispatcher = new Agent({ connect: { lookup: createGuardedLookup(resolve, isBlocked) } });
  try {
    let current = raw;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const url = await assertPublicUrl(current, resolve, isBlocked);
      let res: Response;
      try {
        // The undici package's Agent and Node's bundled undici-types describe the
        // same Dispatcher interface but are distinct TS types, hence the cast.
        const init: Omit<RequestInit, 'dispatcher'> & { dispatcher: unknown } = {
          headers: { 'User-Agent': USER_AGENT, ...headers },
          redirect: 'manual',
          signal,
          dispatcher,
        };
        res = await fetch(url, init as RequestInit);
      } catch (error) {
        const unsafe = findUnsafeCause(error);
        if (unsafe) throw unsafe;
        const timedOut =
          error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        throw new UpstreamError(
          timedOut ? 'Upstream timed out' : 'Upstream unreachable',
          timedOut ? 504 : 502
        );
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!location) throw new UpstreamError('Upstream redirect without location');
        current = new URL(location, url).toString();
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new UpstreamError(`Upstream returned ${res.status}`);
      }
      return await readBodyCapped(res, maxBytes);
    }
    throw new UpstreamError('Too many redirects');
  } finally {
    dispatcher.destroy().catch(() => undefined);
  }
}
