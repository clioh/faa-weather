/**
 * Mirror addresses: a hostname (skyglass.local), an IPv4 address, or an IPv6
 * address (raw, without brackets, optionally with a %zone).
 */

const HOSTNAME_PATTERN = /^[a-zA-Z0-9.-]{1,253}$/;
const IPV6_PATTERN = /^[0-9a-fA-F:.]{2,45}(%[A-Za-z0-9._-]{1,32})?$/;

function isIpv6(host: string): boolean {
  return IPV6_PATTERN.test(host) && (host.match(/:/g)?.length ?? 0) >= 2;
}

/** True for a hostname, IPv4 or bare IPv6 address. */
export function isValidHost(host: string): boolean {
  return HOSTNAME_PATTERN.test(host) || isIpv6(host);
}

/** Trims and drops IPv6 brackets ("[fe80::1]" → "fe80::1"); null when not a valid host. */
export function normalizeHost(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  let host = raw.trim();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return isValidHost(host) ? host : null;
}

/** http://host:port, with IPv6 addresses bracketed (and a %zone escaped as %25). */
export function mirrorOrigin(host: string, port: number): string {
  const h = isIpv6(host) ? `[${host.replace('%', '%25')}]` : host;
  return `http://${h}:${port}`;
}
