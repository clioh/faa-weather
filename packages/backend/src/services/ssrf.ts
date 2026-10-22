/**
 * SSRF guard for user-supplied URLs (custom news feeds).
 *
 * Only http/https URLs are allowed, and every address the host resolves to
 * must be public: loopback, link-local, private (RFC1918 / ULA), CGNAT,
 * unspecified, multicast and reserved ranges are rejected. Redirects are
 * followed manually so each hop is re-validated.
 *
 * Note: there is a small DNS-rebinding window between validation and the
 * actual connection; acceptable for a LAN appliance fetching RSS.
 */

import { lookup } from 'dns/promises';
import { isIP } from 'net';
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
    addr = addr.slice(0, -v4Match[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
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
  if (allZeroPrefix && (g[5] === 0xffff || g[5] === 0) && !(g[5] === 0 && g[6] === 0 && g[7] <= 1)) {
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

const defaultResolver: Resolver = async (host) => {
  const results = await lookup(host, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

/**
 * Validate a user-supplied URL. Returns the parsed URL or throws UnsafeUrlError.
 */
export async function assertPublicUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
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
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new UnsafeUrlError('Private or local addresses are not allowed');
  }
  return url;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  resolve?: Resolver;
}

/**
 * Fetch a user-supplied URL as text, validating the target (and every
 * redirect hop) with assertPublicUrl. Defaults: 5 s total timeout, 2 MB cap.
 */
export async function safeFetchText(raw: string, opts: SafeFetchOptions = {}): Promise<string> {
  const { timeoutMs = 5000, maxBytes = 2 * 1024 * 1024, maxRedirects = 3, headers = {}, resolve } = opts;
  const signal = AbortSignal.timeout(timeoutMs);
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(current, resolve);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...headers },
        redirect: 'manual',
        signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new UpstreamError(timedOut ? 'Upstream timed out' : 'Upstream unreachable', timedOut ? 504 : 502);
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
    return readBodyCapped(res, maxBytes);
  }
  throw new UpstreamError('Too many redirects');
}
