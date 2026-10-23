/**
 * Who is calling the backend (port 3001)? See docs/SECURITY.md.
 *
 * Three caller classes are trusted:
 *   - local:    the effective client address is loopback (kiosk browser,
 *               presence detector, npm run setup:dev, curl on the device).
 *   - internal: a valid X-SkyGlass-Internal header (presence server).
 *   - device:   Authorization: Bearer <token> of a paired phone.
 * Everything else is 'none' and only reaches the public allowlist.
 *
 * "Effective client address" follows Express `trust proxy: 'loopback'`:
 * X-Forwarded-For is honoured only while the hop that added it is loopback,
 * so a LAN client cannot claim to be 127.0.0.1, and a LAN client reaching us
 * through a local proxy (Vite dev server with xfwd) keeps its LAN address.
 *
 * "local" additionally requires a loopback Host header and, when present, a
 * loopback Origin. A browser on the device visiting a hostile site (DNS
 * rebinding, cross-site form posts) therefore never gets local trust.
 */

import type { IncomingHttpHeaders } from 'http';
import net from 'net';
import { INTERNAL_TOKEN_HEADER, isValidInternalToken } from '../services/internal-token.js';

export type TrustKind = 'local' | 'internal' | 'device' | 'none';

export interface AuthInfo {
  kind: TrustKind;
  /** Paired device id when kind === 'device'. */
  deviceId: string | null;
}

/** Looks up a paired device by bearer token (implemented by the pairing service). */
export type DeviceAuthenticator = (token: string) => { id: string } | null;

/** True for loopback addresses in the forms Node and proxies report them. */
export function isLoopbackAddress(ip: string | undefined | null): boolean {
  if (!ip) return false;
  let addr = ip.trim();
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1);
  if (addr === '::1') return true;
  const lower = addr.toLowerCase();
  if (lower.startsWith('::ffff:')) addr = addr.slice(7);
  return net.isIPv4(addr) && addr.startsWith('127.');
}

/**
 * Effective client address with the same rule as Express `trust proxy:
 * 'loopback'`: start at the socket peer and step left through
 * X-Forwarded-For only while the current hop is loopback. Used for WebSocket
 * upgrades, which never pass through Express (where req.ip does this).
 */
export function effectiveClientIp(
  remoteAddress: string | undefined,
  xff: string | string[] | undefined
): string | undefined {
  const forwarded = (Array.isArray(xff) ? xff.join(',') : (xff ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .reverse();
  const hops = [remoteAddress, ...forwarded];
  let i = 0;
  while (i < hops.length - 1 && isLoopbackAddress(hops[i])) i++;
  return hops[i];
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function hostnameOf(hostPort: string): string {
  const h = hostPort.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.indexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

/** Host header names this machine itself (not a DNS name that rebinds to 127.0.0.1). */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = hostnameOf(host);
  if (LOOPBACK_HOSTNAMES.has(name) || name.endsWith('.localhost')) return true;
  return isLoopbackAddress(name);
}

/** Origin is absent (non-browser client) or a loopback page. */
export function isLoopbackOrigin(origin: string | string[] | undefined): boolean {
  if (origin === undefined) return true;
  if (typeof origin !== 'string') return false;
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHost(url.host);
  } catch {
    return false;
  }
}

/** `Authorization: Bearer <token>` value, or null. */
export function bearerToken(headers: IncomingHttpHeaders): string | null {
  const value = headers.authorization;
  if (typeof value !== 'string') return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(value);
  return match ? match[1] : null;
}

export interface ClassifyInput {
  /** Effective client address (Express req.ip, or effectiveClientIp for upgrades). */
  ip: string | undefined;
  headers: IncomingHttpHeaders;
  /** Device token from somewhere other than the Authorization header (WS subprotocol). */
  token?: string | null;
}

/**
 * Classify a caller. A valid device token wins (so whoami / "this phone"
 * work for a developer curling from the device with a token), then the
 * internal token, then loopback. An invalid bearer token does not take local
 * trust away from a genuinely local caller.
 */
export function classify(input: ClassifyInput, authenticateDevice: DeviceAuthenticator): AuthInfo {
  const token = input.token ?? bearerToken(input.headers);
  if (token) {
    const device = authenticateDevice(token);
    if (device) return { kind: 'device', deviceId: device.id };
  }
  if (isValidInternalToken(input.headers[INTERNAL_TOKEN_HEADER.toLowerCase()])) {
    return { kind: 'internal', deviceId: null };
  }
  if (
    isLoopbackAddress(input.ip) &&
    isLoopbackHost(input.headers.host) &&
    isLoopbackOrigin(input.headers.origin)
  ) {
    return { kind: 'local', deviceId: null };
  }
  return { kind: 'none', deviceId: null };
}
