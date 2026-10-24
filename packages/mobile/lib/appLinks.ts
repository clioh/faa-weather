/**
 * Links that open the app: the mirror's pairing QR code and invite links.
 *
 * Forms accepted:
 *   https://skyglass.dev/connect#h=<host>&p=<port>&pair=<secret>&m=<mirror name>
 *   https://skyglass.dev/invite#h=<host>&p=<port>&t=<token>&n=<person>&m=<mirror>
 *     (also www.skyglass.dev). Universal Links / App Links open the app with
 *     these straight away; the values sit in the fragment so the secrets never
 *     reach a server.
 *   skyglass://connect?host=&port=&pair=        (older mirrors)
 *   exp://<ip>:8081/--/connect?host=&port=      (npm run dev:e2e)
 *   skyglass://invite?host=&port=&token=
 *
 * expo-router only reads route params from the query string, so
 * app/+native-intent.tsx calls redirectAppLink() to rewrite the https forms
 * into /connect?host=… and /invite?host=… before routing. The in-app scanner
 * (app/scan.tsx) uses parseAppLink() on whatever the QR code holds.
 *
 * No URL / URLSearchParams here: React Native's versions are incomplete.
 */

import { normalizeHost } from './hosts';
import { parseInviteParams } from './invites';

export const WEB_HOSTS = ['skyglass.dev', 'www.skyglass.dev'];
const APP_SCHEMES = ['skyglass', 'com.skyglass.app'];

const PORT_PATTERN = /^\d{1,5}$/;
/** The mirror's QR secret: 16 random bytes, base64url (src/pairing/service.ts). */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_NAME_LENGTH = 64;

export type AppLink =
  | { kind: 'connect'; host: string; port: number; pair?: string; name?: string }
  | { kind: 'invite'; host: string; port: number; token: string };

type Params = Record<string, string>;

interface SplitUrl {
  scheme: string | null; // lowercase, null for a bare path
  authority: string; // lowercase
  path: string;
  query: string;
  fragment: string;
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/** `a=1&b=2` → { a: '1', b: '2' }. The first value of a repeated key wins. */
function parseParams(text: string): Params {
  const out: Params = {};
  for (const part of text.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = decode(eq < 0 ? part : part.slice(0, eq));
    const value = decode(eq < 0 ? '' : part.slice(eq + 1));
    if (key === null || value === null || key in out) continue;
    out[key] = value;
  }
  return out;
}

function splitUrl(input: string): SplitUrl | null {
  const text = input.trim();
  const full = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(
    text
  );
  if (full) {
    return {
      scheme: full[1].toLowerCase(),
      authority: full[2].toLowerCase(),
      path: full[3],
      query: full[4] ?? '',
      fragment: full[5] ?? '',
    };
  }
  const bare = /^(\/[^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(text);
  if (bare) {
    return {
      scheme: null,
      authority: '',
      path: bare[1],
      query: bare[2] ?? '',
      fragment: bare[3] ?? '',
    };
  }
  return null;
}

/** `/connect/` → 'connect'. */
function routeName(path: string): string {
  return path.replace(/^\/+|\/+$/g, '').toLowerCase();
}

function isWebLink(url: SplitUrl): boolean {
  return url.scheme === 'https' && WEB_HOSTS.includes(url.authority.replace(/:443$/, ''));
}

/** The route ('connect', 'invite', …) a link points at, or null for other links. */
function linkRoute(url: SplitUrl): string | null {
  if (url.scheme === null || isWebLink(url)) return routeName(url.path);
  if (APP_SCHEMES.includes(url.scheme)) {
    // skyglass://connect?… puts the route in the authority; skyglass:///connect in the path.
    return routeName(`${url.authority}${url.path}`);
  }
  if (url.scheme === 'exp' || url.scheme === 'exps') {
    const at = url.path.indexOf('/--/');
    return at < 0 ? null : routeName(url.path.slice(at + 4));
  }
  return null;
}

function parsePort(value: string | undefined): number | null {
  if (value === undefined || value === '') return 3001;
  if (!PORT_PATTERN.test(value)) return null;
  const port = parseInt(value, 10);
  return port >= 1 && port <= 65535 ? port : null;
}

/** Control characters out, trimmed and capped; undefined when nothing is left. */
function cleanName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // eslint-disable-next-line no-control-regex
  const CONTROL = /[\u0000-\u001f\u007f]/g;
  const name = value.replace(CONTROL, '').trim().slice(0, MAX_NAME_LENGTH).trim();
  return name || undefined;
}

function connectLink(params: Params): AppLink | null {
  const host = normalizeHost(params.h ?? params.host);
  const port = parsePort((params.p ?? params.port)?.trim());
  const pair = (params.pair ?? '').trim();
  if (!host || port === null) return null;
  if (pair && !SECRET_PATTERN.test(pair)) return null;
  const link: AppLink = { kind: 'connect', host, port };
  if (pair) link.pair = pair;
  const name = cleanName(params.m ?? params.name);
  if (name) link.name = name;
  return link;
}

function inviteLink(params: Params): AppLink | null {
  const invite = parseInviteParams({
    host: params.h ?? params.host,
    port: params.p ?? params.port,
    token: params.t ?? params.token,
  });
  return invite ? { kind: 'invite', ...invite } : null;
}

/**
 * A pairing or invite link in any of the forms above, or null when the text
 * isn't one (or its values don't pass validation).
 *
 * `anyOrigin` (the in-app scanner): also accept a /connect link with its
 * values in the fragment on any https origin, since a mirror pointed at a
 * staging service (its skyglass_service setting) puts that origin in its QR.
 * The OS-level app links stay limited to skyglass.dev.
 */
export function parseAppLink(text: string, options: { anyOrigin?: boolean } = {}): AppLink | null {
  if (typeof text !== 'string' || text.length > 2048) return null;
  const url = splitUrl(text);
  if (!url) return null;
  let route = linkRoute(url);
  if (route === null && options.anyOrigin && url.scheme === 'https' && url.fragment) {
    route = routeName(url.path) === 'connect' ? 'connect' : null;
  }
  if (route !== 'connect' && route !== 'invite') return null;
  // Fragment values (the https forms) win over query values (the older forms).
  const params = { ...parseParams(url.query), ...parseParams(url.fragment) };
  return route === 'connect' ? connectLink(params) : inviteLink(params);
}

/** The in-app path for a parsed link, e.g. /connect?host=…&port=…&pair=…&name=…. */
export function appLinkPath(link: AppLink): string {
  const params: [string, string][] =
    link.kind === 'connect'
      ? [
          ['host', link.host],
          ['port', String(link.port)],
          ...(link.pair ? ([['pair', link.pair]] as [string, string][]) : []),
          ...(link.name ? ([['name', link.name]] as [string, string][]) : []),
        ]
      : [
          ['host', link.host],
          ['port', String(link.port)],
          ['token', link.token],
        ];
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `/${link.kind}?${query}`;
}

/**
 * For app/+native-intent.tsx: rewrite a skyglass.dev link (a full https URL,
 * or just its path with the fragment) into the route expo-router can read.
 * A skyglass.dev link that isn't a valid pairing or invite link goes home.
 * Everything else (skyglass://, exp://, OAuth redirects, plain paths) passes
 * through unchanged.
 */
export function redirectAppLink(path: string): string {
  const url = splitUrl(path);
  if (!url) return path;
  if (isWebLink(url)) {
    const link = parseAppLink(path);
    return link ? appLinkPath(link) : '/';
  }
  // A path with the values in the fragment (in case the host was stripped).
  if (url.scheme === null && url.fragment) {
    const route = routeName(url.path);
    if (route === 'connect' || route === 'invite') {
      const link = parseAppLink(path);
      return link ? appLinkPath(link) : '/';
    }
  }
  return path;
}
