/**
 * Phone pairing API (docs/SECURITY.md, "Pairing").
 *
 * Public (rate limited):
 *   POST /api/pairing/claim     { secret, deviceName }  → { deviceId, token, mirror }
 *   POST /api/pairing/request   { deviceName }          → { requestId, expiresAt }
 *   POST /api/pairing/complete  { requestId, code }     → { deviceId, token, mirror }
 * Local only:
 *   GET  /api/pairing/qr                                → { url, expiresAt }
 * Any trusted caller:
 *   GET    /api/pairing/whoami                          → { kind, deviceId }
 *   GET    /api/pairing/devices                         → { devices: [...] }
 *   PATCH  /api/pairing/devices/:id  { name }           → { device }
 *   DELETE /api/pairing/devices/self                    → 204 (a paired phone unpairs itself)
 *   DELETE /api/pairing/devices/:id                     → 204
 *
 * expiresAt values are milliseconds since the epoch.
 */

import { Router, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { networkInterfaces } from 'os';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { isLoopbackIp } from '../middleware/rateLimiter.js';
import { getAuth, requireKind } from '../pairing/middleware.js';
import { PairingError, type PairingService } from '../pairing/service.js';
import { loadConfig } from '../config/index.js';
import { getMirrorName } from '../db/index.js';
import { DEFAULT_SKYGLASS_SERVICE, skyglassServiceUrl } from '../services/skyglass-service.js';

// 1–60 printable characters: no control characters, line/paragraph
// separators or bidi overrides (names are shown on the mirror and phones).
const PRINTABLE_NAME = /^[^\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]+$/u;
export const deviceNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(60, 'Name must be at most 60 characters')
  .regex(PRINTABLE_NAME, 'Name contains characters that cannot be shown');

export const pairingClaimSchema = z.object({
  secret: z.string().min(1).max(100),
  deviceName: deviceNameSchema,
});
export const pairingRequestSchema = z.object({ deviceName: deviceNameSchema });
export const pairingCompleteSchema = z.object({
  requestId: z.string().min(1).max(100),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});
export const pairingRenameSchema = z.object({ name: deviceNameSchema });

const DEVICE_ID = /^[0-9a-f-]{36}$/;

/** The mirror's primary LAN IPv4 address, for the pairing QR link. */
export function primaryLanIp(): string | null {
  const preferred = ['en0', 'eth0', 'wlan0', 'en1'];
  const candidates: { name: string; address: string }[] = [];
  for (const [name, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.internal || info.family !== 'IPv4' || info.address.startsWith('169.254.')) continue;
      candidates.push({ name, address: info.address });
    }
  }
  candidates.sort((a, b) => {
    const ia = preferred.indexOf(a.name);
    const ib = preferred.indexOf(b.name);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return candidates[0]?.address ?? null;
}

export interface ConnectUrlSources {
  /** Site the link opens (origin of `skyglass_service`, default https://skyglass.dev). */
  site?: () => string;
  /** Shown by the connect page and the app before pairing (getMirrorName()). */
  mirrorName?: () => string | null;
  host?: () => string;
  port?: () => number;
}

/**
 * Origin of `skyglass_service` (path dropped), so a staging service gets
 * matching links; https://skyglass.dev when unset, invalid or unreadable.
 */
export function connectSiteOrigin(
  config: () => Parameters<typeof skyglassServiceUrl>[0] = loadConfig
): string {
  try {
    const base = skyglassServiceUrl(config());
    if (base) return new URL(base).origin;
  } catch {
    // Unreadable config: fall back to the default site.
  }
  return DEFAULT_SKYGLASS_SERVICE;
}

function safeMirrorName(): string | null {
  try {
    return getMirrorName();
  } catch {
    return null;
  }
}

/**
 * `<site>/connect#h=<host>&p=<port>&m=<mirror name>`. Values sit in the
 * fragment so nothing (least of all the pairing secret withPairSecret adds)
 * reaches the web server, its logs or analytics. With the app installed the
 * link opens it directly (Universal Links / App Links); without it the page
 * offers the store.
 */
export function buildConnectUrl({
  site,
  host,
  port,
  mirrorName,
}: {
  site: string;
  host: string;
  port: number;
  mirrorName?: string | null;
}): string {
  const params = [`h=${encodeURIComponent(host)}`, `p=${encodeURIComponent(String(port))}`];
  if (mirrorName) params.push(`m=${encodeURIComponent(mirrorName)}`);
  return `${site.replace(/\/+$/, '')}/connect#${params.join('&')}`;
}

/**
 * Pairing link without the secret. SKYGLASS_DEV_APP_URL (set by
 * scripts/dev-e2e.mjs: exp://<ip>:8081/--/connect?host=<ip>&port=3001, or
 * skyglass://connect?... with --device) wins so the dev build opens.
 */
export function defaultConnectUrl(sources: ConnectUrlSources = {}): string {
  const dev = process.env.SKYGLASS_DEV_APP_URL;
  if (dev) return dev;
  return buildConnectUrl({
    site: sources.site ? sources.site() : connectSiteOrigin(),
    host: sources.host ? sources.host() : (primaryLanIp() ?? 'skyglass.local'),
    port: sources.port ? sources.port() : Number(process.env.PORT) || 3001,
    mirrorName: (sources.mirrorName ?? safeMirrorName)(),
  });
}

/**
 * Adds `pair=<secret>`: inside the fragment for https links (so it stays off
 * servers), as a query parameter for exp:// and skyglass:// links.
 */
export function withPairSecret(url: string, secret: string): string {
  const param = `pair=${encodeURIComponent(secret)}`;
  const hash = url.indexOf('#');
  if (hash !== -1) {
    const sep = hash === url.length - 1 || url.endsWith('&') ? '' : '&';
    return `${url}${sep}${param}`;
  }
  return `${url}${url.includes('?') ? '&' : '?'}${param}`;
}

/** claim/request/complete: 10 per 5 minutes per client, 60 per 5 minutes overall. */
export function createPairingLimiters(): RequestHandler[] {
  const message = {
    error: 'too_many_requests',
    message: 'Too many pairing attempts. Wait a few minutes and try again.',
  };
  const skip = (req: Parameters<RequestHandler>[0]) =>
    isLoopbackIp(req.ip || req.socket.remoteAddress);
  return [
    rateLimit({
      windowMs: 5 * 60 * 1000,
      max: 60,
      keyGenerator: () => 'global',
      standardHeaders: true,
      legacyHeaders: false,
      message,
      skip,
    }),
    rateLimit({
      windowMs: 5 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message,
      skip,
    }),
  ];
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof PairingError) {
    res
      .status(error.httpStatus)
      .json({ error: error.code, message: error.message, ...error.extra });
    return;
  }
  console.error('[Pairing] Unexpected error:', error);
  res.status(500).json({ error: 'internal_error', message: 'Pairing failed. Try again.' });
}

export interface PairingRouterOptions {
  service: PairingService;
  /** Rate limiters for claim/request/complete (default: createPairingLimiters()). */
  limiters?: RequestHandler[];
  /** Pairing link without the secret (default: defaultConnectUrl). */
  connectUrl?: () => string;
}

export function createPairingRouter({
  service,
  limiters,
  connectUrl = () => defaultConnectUrl(),
}: PairingRouterOptions): Router {
  const router = Router();
  const limit = limiters ?? createPairingLimiters();

  router.get('/qr', requireKind('local'), (_req, res) => {
    const { secret, expiresAt } = service.getQrSecret();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ url: withPairSecret(connectUrl(), secret), expiresAt });
  });

  router.post('/claim', ...limit, validateBody(pairingClaimSchema), (req, res) => {
    const { secret, deviceName } = req.body as z.infer<typeof pairingClaimSchema>;
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(service.claim(secret, deviceName));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/request', ...limit, validateBody(pairingRequestSchema), (req, res) => {
    const { deviceName } = req.body as z.infer<typeof pairingRequestSchema>;
    try {
      res.json(service.request(deviceName));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/complete', ...limit, validateBody(pairingCompleteSchema), (req, res) => {
    const { requestId, code } = req.body as z.infer<typeof pairingCompleteSchema>;
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(service.complete(requestId, code));
    } catch (error) {
      sendError(res, error);
    }
  });

  // The routes below are behind the /api gate (any trusted caller).
  router.get('/whoami', (_req, res) => {
    const { kind, deviceId } = getAuth(res);
    res.json({ kind, deviceId });
  });

  router.get('/devices', (_req, res) => {
    const { deviceId } = getAuth(res);
    res.json({ devices: service.listDevices().map((d) => ({ ...d, current: d.id === deviceId })) });
  });

  router.patch('/devices/:id', validateBody(pairingRenameSchema), (req, res) => {
    const id = String(req.params.id);
    if (!DEVICE_ID.test(id)) {
      res.status(404).json({ error: 'not_found', message: 'No paired phone with that id.' });
      return;
    }
    try {
      const device = service.renameDevice(
        id,
        (req.body as z.infer<typeof pairingRenameSchema>).name
      );
      res.json({ device: { ...device, current: device.id === getAuth(res).deviceId } });
    } catch (error) {
      sendError(res, error);
    }
  });

  // A phone revokes its own token (unlinking the mirror in My Mirrors). Only
  // device callers have a token to revoke; the mirror itself gets 400.
  router.delete('/devices/self', (_req, res) => {
    const { kind, deviceId } = getAuth(res);
    if (kind !== 'device' || !deviceId) {
      res
        .status(400)
        .json({ error: 'not_a_paired_phone', message: 'Only a paired phone can unpair itself.' });
      return;
    }
    try {
      service.revokeDevice(deviceId);
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete('/devices/:id', (req, res) => {
    const id = String(req.params.id);
    if (!DEVICE_ID.test(id)) {
      res.status(404).json({ error: 'not_found', message: 'No paired phone with that id.' });
      return;
    }
    try {
      service.revokeDevice(id);
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
