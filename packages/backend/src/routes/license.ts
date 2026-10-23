/**
 * License API (docs/LICENSING.md "Mirror").
 *
 *   GET  /api/license/status   → LicenseStatus
 *   POST /api/license/key      { licenseKey } → LicenseStatus, or { status: <code>, message, license }
 *   POST /api/license/refresh  → LicenseStatus
 *
 * State changes reach the mirror as a WS `license` event (wired in server.ts
 * via licenseManager.onChange).
 */

import { Router } from 'express';
import { licenseManager } from '../license/index.js';
import { configWriteLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json(licenseManager.getStatus());
});

router.post('/key', configWriteLimiter, async (req, res) => {
  // submitKey normalizes (dashes/spaces/case forgiven) and answers invalid_key itself.
  const raw: unknown = req.body?.licenseKey;
  const result = await licenseManager.submitKey(typeof raw === 'string' ? raw.slice(0, 64) : raw);
  if (result.ok) {
    res.json(result.status);
    return;
  }
  res
    .status(result.httpStatus)
    .json({ status: result.code, message: result.message, license: result.status });
});

router.post('/refresh', configWriteLimiter, async (_req, res) => {
  res.json(await licenseManager.refreshNow());
});

export default router;
