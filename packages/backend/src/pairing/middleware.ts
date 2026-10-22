/**
 * Deny-by-default gate for /api (docs/SECURITY.md).
 *
 * Mounted with `app.use('/api', apiAuthGate(...))` BEFORE every API route, so
 * a route added later is protected without doing anything. Only the public
 * allowlist below is reachable by an untrusted caller; everything else gets
 * 401 { error: 'pairing_required' }.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { classify, type AuthInfo, type DeviceAuthenticator, type TrustKind } from './trust.js';

/** Public endpoints, as METHOD + path below /api (lower case, no trailing slash). */
export const PUBLIC_API_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/discovery' },
  { method: 'POST', path: '/pairing/claim' },
  { method: 'POST', path: '/pairing/request' },
  { method: 'POST', path: '/pairing/complete' },
];

export const PAIRING_REQUIRED_BODY = {
  error: 'pairing_required',
  message: "This phone isn't paired with this mirror.",
} as const;

/** `path` is relative to the /api mount (req.path inside the gate). */
export function isPublicApiRoute(method: string, path: string): boolean {
  const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  let p = path.toLowerCase();
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return PUBLIC_API_ROUTES.some((r) => r.method === m && r.path === p);
}

/** Trust classification of this request (set by the gate). */
export function getAuth(res: Response): AuthInfo {
  return (res.locals.auth as AuthInfo | undefined) ?? { kind: 'none', deviceId: null };
}

export function classifyExpressRequest(req: Request, authenticateDevice: DeviceAuthenticator): AuthInfo {
  // req.ip honours X-Forwarded-For only from loopback hops (trust proxy: 'loopback').
  return classify({ ip: req.ip, headers: req.headers }, authenticateDevice);
}

export function apiAuthGate(authenticateDevice: DeviceAuthenticator): RequestHandler {
  return function apiAuthGateMiddleware(req: Request, res: Response, next: NextFunction): void {
    let auth: AuthInfo;
    try {
      auth = classifyExpressRequest(req, authenticateDevice);
    } catch (error) {
      console.error('[Auth] Classification failed:', error);
      auth = { kind: 'none', deviceId: null };
    }
    res.locals.auth = auth;
    if (auth.kind !== 'none' || isPublicApiRoute(req.method, req.path)) return next();
    res.setHeader('WWW-Authenticate', 'Bearer realm="skyglass"');
    res.status(401).json(PAIRING_REQUIRED_BODY);
  };
}

/** Per-route guard: only these trust kinds (e.g. local-only endpoints). */
export function requireKind(...kinds: TrustKind[]): RequestHandler {
  return (_req, res, next) => {
    const { kind } = getAuth(res);
    if (kinds.includes(kind)) return next();
    if (kind === 'none') {
      res.status(401).json(PAIRING_REQUIRED_BODY);
      return;
    }
    res.status(403).json({ error: 'forbidden', message: 'Only the mirror itself can do this.' });
  };
}
