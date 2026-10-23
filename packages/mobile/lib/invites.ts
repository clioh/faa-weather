/**
 * Invite links for people added to a mirror from another phone.
 *
 * The inviting phone shares
 *   https://skyglass.dev/invite#h=<host>&p=<port>&t=<token>&n=<name>&m=<mirror>
 * (as a QR code or through the share sheet). The website's invite page
 * (packages/website/src/pages/Invite.tsx) explains it and hands off to the
 * app as skyglass://invite?host=<host>&port=<port>&token=<token>, which
 * app/invite.tsx accepts. Everything sits in the fragment so the single-use
 * token never reaches a server or its logs.
 */

export const INVITE_PAGE = 'https://skyglass.dev/invite';

const HOST_PATTERN = /^[a-zA-Z0-9.-]+$/;
const TOKEN_PATTERN = /^sgi_[A-Za-z0-9_-]{20,120}$/;

export function inviteLink(invite: {
  host: string;
  port: number;
  token: string;
  personName: string;
  mirrorName: string;
}): string {
  const params = [
    ['h', invite.host],
    ['p', String(invite.port)],
    ['t', invite.token],
    ['n', invite.personName],
    ['m', invite.mirrorName],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${INVITE_PAGE}#${params}`;
}

/** The deep link's parameters, or null when they aren't a usable invite. */
export function parseInviteParams(params: {
  host?: string | string[];
  port?: string | string[];
  token?: string | string[];
}): { host: string; port: number; token: string } | null {
  const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '');
  const host = one(params.host);
  const token = one(params.token);
  const port = params.port ? parseInt(one(params.port), 10) : 3001;
  if (!HOST_PATTERN.test(host) || !TOKEN_PATTERN.test(token)) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, token };
}
