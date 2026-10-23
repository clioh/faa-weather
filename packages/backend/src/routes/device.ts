/**
 * Device routes: thin proxies to the Python admin portal / presence server
 * (packages/presence/web_server.py + admin_portal.py, default port 5000).
 *
 * The mobile app talks only to the backend (port 3001) for these:
 *   GET    /api/wifi/scan            -> GET  {ADMIN}/api/admin/wifi/scan
 *   GET    /api/wifi/status          -> GET  {ADMIN}/api/admin/wifi/status
 *   POST   /api/wifi/connect         -> POST {ADMIN}/api/admin/wifi/connect
 *   GET    /api/presence/faces       -> GET  {ADMIN}/api/users
 *   DELETE /api/presence/faces/:id   -> DELETE {ADMIN}/api/users/:id/face
 *
 * Admin portal base URL: env SKYGLASS_ADMIN_URL, default http://127.0.0.1:5000.
 *
 * Every call carries the internal service token (X-SkyGlass-Internal, see
 * services/internal-token.ts); the presence server refuses these routes
 * without it or an admin session. Only what the phone app uses is proxied:
 * settings, restart, reboot, clear-cache, logs, updates and the admin
 * password are deliberately NOT reachable through port 3001. See
 * docs/SECURITY.md.
 */

import { Router, Response } from 'express';
import { validateBody } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { wifiConnectSchema } from '../validation/schemas.js';
import { isSafeId } from '../validation/safe-id.js';
import { internalHeaders } from '../services/internal-token.js';

export const ADMIN_PORTAL_URL = (process.env.SKYGLASS_ADMIN_URL || 'http://127.0.0.1:5000').replace(
  /\/+$/,
  ''
);

interface ProxyResult {
  status: number;
  body: unknown;
}

/**
 * Call the admin portal with the internal service token. The caller's
 * cookies are never forwarded.
 */
async function callAdmin(
  method: string,
  pathname: string,
  body?: unknown,
  timeoutMs = 15000
): Promise<ProxyResult> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...internalHeaders(),
  };

  const response = await fetch(`${ADMIN_PORTAL_URL}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status >= 300 && response.status < 400) {
    return { status: 502, body: { error: 'Unexpected redirect from admin portal' } };
  }
  if (response.status === 401 || response.status === 403) {
    // The token was refused: data/internal-token differs between the two
    // processes (e.g. SKYGLASS_INTERNAL_TOKEN_FILE set for only one of them).
    console.error(`[Device] Admin portal refused the internal token for ${method} ${pathname}`);
    return {
      status: 502,
      body: { error: 'Admin portal refused the backend', message: 'Internal token mismatch' },
    };
  }

  const parsed = await response.json().catch(() => null);
  return { status: response.status, body: parsed };
}

function sendUnavailable(res: Response, error: unknown): void {
  console.error('[Device] Admin portal request failed:', error);
  res.status(502).json({
    error: 'Admin portal unavailable',
    message: 'Could not reach the SkyGlass admin portal',
  });
}

// ============================================================
// WiFi
// ============================================================

export const wifiRoutes = Router();

wifiRoutes.get('/scan', async (_req, res) => {
  try {
    const result = await callAdmin('GET', '/api/admin/wifi/scan', undefined, 40000);
    const data = (result.body ?? {}) as {
      networks?: { ssid: string; signal: number; secure?: boolean }[];
      error?: string;
    };
    if (result.status !== 200) {
      return res.status(result.status).json(result.body ?? { error: 'WiFi scan failed' });
    }
    // Mobile expects an array of { ssid, signal, secure }. The portal does not
    // report security; assume secured so the app prompts for a password
    // (an empty password is still allowed for open networks).
    res.json(
      (data.networks ?? []).map((n) => ({
        ssid: n.ssid,
        signal: n.signal,
        secure: n.secure ?? true,
      }))
    );
  } catch (error) {
    sendUnavailable(res, error);
  }
});

wifiRoutes.get('/status', async (_req, res) => {
  try {
    const result = await callAdmin('GET', '/api/admin/wifi/status');
    res.status(result.status).json(result.body ?? { connected: false });
  } catch (error) {
    sendUnavailable(res, error);
  }
});

wifiRoutes.post('/connect', authLimiter, validateBody(wifiConnectSchema), async (req, res) => {
  try {
    const { ssid, password } = req.body as { ssid: string; password: string };
    const result = await callAdmin('POST', '/api/admin/wifi/connect', { ssid, password }, 60000);
    const data = (result.body ?? {}) as { success?: boolean; error?: string };
    if (result.status !== 200) {
      return res.status(result.status).json(result.body ?? { success: false });
    }
    res.json({
      success: !!data.success,
      ...(data.error ? { error: data.error, message: data.error } : {}),
    });
  } catch (error) {
    sendUnavailable(res, error);
  }
});

// ============================================================
// Registered faces (multi-user enrollment)
// ============================================================

export const presenceFaceRoutes = Router();

presenceFaceRoutes.get('/', async (_req, res) => {
  try {
    const result = await callAdmin('GET', '/api/users');
    if (result.status !== 200) {
      return res.status(result.status).json(result.body ?? { error: 'Failed to list faces' });
    }
    const data = (result.body ?? {}) as {
      users?: { userId: string; name?: string; enrolledAt?: string | null }[];
    };
    // Mobile expects [{ id, name, createdAt }]
    res.json(
      (data.users ?? []).map((u) => ({
        id: u.userId,
        name: u.name ?? 'Unknown',
        createdAt: u.enrolledAt ?? null,
      }))
    );
  } catch (error) {
    sendUnavailable(res, error);
  }
});

presenceFaceRoutes.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) {
    return res
      .status(400)
      .json({ success: false, error: 'Invalid face id', message: 'Invalid face id' });
  }
  try {
    const result = await callAdmin('DELETE', `/api/users/${encodeURIComponent(id)}/face`);
    res.status(result.status).json(result.body ?? { success: result.status === 200 });
  } catch (error) {
    sendUnavailable(res, error);
  }
});
