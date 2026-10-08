/**
 * License API Routes
 *
 * Exposes license management to frontend and mobile app.
 */

import { Router } from 'express';
import { z } from 'zod';
import { licenseService } from '../services/license.js';
import { loadConfig } from '../config/index.js';
import { validateBody } from '../middleware/validate.js';
import { broadcast } from '../server.js';

const router = Router();

// License key format: XXXX-XXXX-XXXX-XXXX (alphanumeric)
const licenseKeySchema = z.object({
  licenseKey: z
    .string()
    .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Invalid license key format'),
});

/**
 * GET /api/license/status
 * Returns current license status for the frontend
 */
router.get('/status', (_req, res) => {
  const config = loadConfig();

  // If license system is disabled, always return valid
  if (!config.license?.enabled) {
    res.json({
      enabled: false,
      status: 'valid',
      message: 'License system disabled',
    });
    return;
  }

  const status = licenseService.getLicenseStatus();

  res.json({
    enabled: true,
    status: status.status,
    activatedAt: status.activatedAt,
    supportEmail: 'support@skyglass.dev',
  });
});

/**
 * POST /api/license/key
 * Save and activate a license key (called from mobile app)
 */
router.post('/key', validateBody(licenseKeySchema), async (req, res) => {
  const { licenseKey } = req.body;

  console.log(`[License] Received license key from mobile app: ${licenseKey.slice(0, 9)}...`);

  try {
    const result = await licenseService.setLicenseKey(licenseKey);

    if (result.success) {
      // Broadcast license update to connected clients (mirror frontend)
      broadcast('license', {
        status: 'valid',
        activatedAt: result.activatedAt,
      });

      res.json({
        success: true,
        status: 'active',
        message: result.message,
        activatedAt: result.activatedAt,
      });
    } else {
      res.status(400).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }
  } catch (error) {
    console.error('[License] Error setting license key:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      message: 'Failed to activate license',
    });
  }
});

/**
 * POST /api/license/activate
 * Manually trigger license activation (for debugging/retry)
 */
router.post('/activate', async (_req, res) => {
  const config = loadConfig();

  if (!config.license?.enabled) {
    res.json({
      success: true,
      message: 'License system disabled',
    });
    return;
  }

  try {
    const result = await licenseService.activateLicense();

    if (result.success) {
      broadcast('license', {
        status: 'valid',
        activatedAt: result.activatedAt,
      });
    }

    res.json({
      success: result.success,
      status: result.status,
      message: result.message,
      activatedAt: result.activatedAt,
    });
  } catch (error) {
    console.error('[License] Activation error:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      message: 'Failed to activate license',
    });
  }
});

/**
 * GET /api/license/fingerprint
 * Returns device fingerprint info (for debugging)
 */
router.get('/fingerprint', (_req, res) => {
  try {
    const fingerprint = licenseService.getDeviceFingerprint();

    res.json({
      type: fingerprint.type,
      // Only show partial fingerprint for security
      value: `${fingerprint.value.slice(0, 8)}...${fingerprint.value.slice(-4)}`,
    });
  } catch (error) {
    console.error('[License] Failed to get fingerprint:', error);
    res.status(500).json({
      error: 'Failed to get device fingerprint',
    });
  }
});

export default router;
