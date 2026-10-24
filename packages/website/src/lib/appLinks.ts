/**
 * Shared parsing for the app-link pages (/connect, /invite). Their parameters live in the URL
 * fragment, so secrets never reach a server, logs or analytics. Read them in the browser only,
 * and never copy them into a query string or send them anywhere except to the app.
 */

export const DEFAULT_MIRROR_PORT = 3001
const MAX_LABEL_LENGTH = 60

const HOST_PATTERN = /^[a-zA-Z0-9.-]+$/
// An IPv6 address as the mirror sends it: unbracketed, optional %zone ("fe80::1%wlan0")
const IPV6_PATTERN = /^[0-9a-fA-F:]*:[0-9a-fA-F:]*:[0-9a-fA-F:.]*(%[A-Za-z0-9._-]+)?$/
const PORT_PATTERN = /^\d{1,5}$/

/** Fragment parameters as a URLSearchParams ("#h=…&p=…" → h, p). */
export function hashParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.replace(/^#/, ''))
}

/** The mirror's host name, IPv4 or IPv6 address, or null when missing or malformed. */
export function parseHost(value: string | null): string | null {
  let host = value?.trim() ?? ''
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host.length > 253) return null
  return HOST_PATTERN.test(host) || IPV6_PATTERN.test(host) ? host : null
}

/** The mirror's port: the default when absent, null when malformed or out of range. */
export function parsePort(value: string | null): number | null {
  const raw = value?.trim() ?? ''
  if (!raw) return DEFAULT_MIRROR_PORT
  if (!PORT_PATTERN.test(raw)) return null
  const port = Number(raw)
  return port >= 1 && port <= 65535 ? port : null
}

// Display-only text from the link: drop control characters, collapse whitespace and cap the
// length (by code point, so an emoji is never cut in half). Rendered as React text, never HTML.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

export function cleanLabel(value: string | null): string | null {
  if (!value) return null
  const text = value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const chars = Array.from(text)
  return chars.length > MAX_LABEL_LENGTH
    ? `${chars.slice(0, MAX_LABEL_LENGTH).join('').trimEnd()}…`
    : text
}
