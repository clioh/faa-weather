/**
 * License API Routes
 */

import { Router, Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  getLicenseByKey,
  getLicenseByFingerprint,
  activateLicense,
  createLicense,
  resetLicense,
  getAllLicenses,
} from '../db/index.js';
import { validateBody } from '../middleware/validate.js';
import {
  activateLicenseSchema,
  createLicenseSchema,
  resetLicenseSchema,
} from '../validation/schemas.js';

const router = Router();

// Admin/internal routes require LICENSE_API_KEY. Fail closed: if it is not
// configured, those routes are disabled (503) rather than left open.
if (!process.env.LICENSE_API_KEY) {
  console.error(
    '[License] LICENSE_API_KEY is not set. Protected routes (POST /, POST /reset, GET /) ' +
      'will return 503 until it is configured.'
  );
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Require `Authorization: Bearer <LICENSE_API_KEY>`.
 * Returns 503 when the key is not configured and 401 when it doesn't match.
 */
function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const expectedKey = process.env.LICENSE_API_KEY;

  if (!expectedKey) {
    console.error('[License] Rejected protected request: LICENSE_API_KEY is not configured');
    res.status(503).json({ error: 'License admin API is not configured' });
    return;
  }

  const authHeader = req.headers.authorization ?? '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';

  // Compare fixed-length digests in constant time
  if (!provided || !timingSafeEqual(sha256(provided), sha256(expectedKey))) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

/**
 * Generate a license key in format XXXX-XXXX-XXXX-XXXX
 */
function generateLicenseKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars (I, O, 0, 1)
  const segment = () =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${segment()}-${segment()}-${segment()}-${segment()}`;
}

/**
 * POST /api/v1/licenses/activate
 * Bind a license to a device (called on first startup)
 */
router.post('/activate', validateBody(activateLicenseSchema), (req: Request, res: Response) => {
  const { licenseKey, deviceFingerprint, deviceFingerprintType, deviceMirrorId } = req.body;

  console.log(`[License] Activation request for key: ${licenseKey.slice(0, 9)}...`);

  // Check if this device already has a license
  const existingByFingerprint = getLicenseByFingerprint(deviceFingerprint);
  if (existingByFingerprint) {
    if (existingByFingerprint.license_key === licenseKey) {
      // Same license on same device - return success
      console.log(`[License] Device already activated with this license`);
      res.json({
        success: true,
        status: 'active',
        message: 'License already activated on this device',
        activatedAt: existingByFingerprint.activated_at,
      });
      return;
    } else {
      // Different license on same device - unusual but allowed
      console.log(`[License] Device has different license, checking new key`);
    }
  }

  // Get the license
  const license = getLicenseByKey(licenseKey);

  if (!license) {
    console.log(`[License] License key not found`);
    res.status(404).json({
      success: false,
      status: 'invalid',
      message: 'License key not found',
    });
    return;
  }

  // Check if already activated on a different device
  if (license.status === 'active' && license.device_fingerprint !== deviceFingerprint) {
    console.log(`[License] License already bound to another device`);
    res.status(403).json({
      success: false,
      status: 'bound_to_another_device',
      message: 'This license is already activated on another device. Please contact support@skyglass.dev for assistance.',
    });
    return;
  }

  // Check if revoked
  if (license.status === 'revoked') {
    console.log(`[License] License has been revoked`);
    res.status(403).json({
      success: false,
      status: 'revoked',
      message: 'This license has been revoked. Please contact support@skyglass.dev for assistance.',
    });
    return;
  }

  // Activate the license
  const activated = activateLicense(
    licenseKey,
    deviceFingerprint,
    deviceFingerprintType,
    deviceMirrorId
  );

  if (!activated) {
    console.log(`[License] Failed to activate license`);
    res.status(500).json({
      success: false,
      status: 'error',
      message: 'Failed to activate license',
    });
    return;
  }

  console.log(`[License] License activated successfully`);
  res.json({
    success: true,
    status: 'active',
    message: 'License activated successfully',
    activatedAt: activated.activated_at,
  });
});

/**
 * POST /api/v1/licenses
 * Create a new license (internal, from Stripe webhook)
 */
router.post('/', requireApiKey, validateBody(createLicenseSchema), (req: Request, res: Response) => {
  const { email, stripePaymentId } = req.body;

  console.log(`[License] Creating new license for: ${email}`);

  const id = uuidv4();
  const licenseKey = generateLicenseKey();

  try {
    const license = createLicense({
      id,
      licenseKey,
      email,
      stripePaymentId,
    });

    console.log(`[License] Created license: ${licenseKey.slice(0, 9)}...`);
    res.status(201).json({
      success: true,
      license: {
        id: license.id,
        licenseKey: license.license_key,
        email: license.email,
        status: license.status,
        createdAt: license.created_at,
      },
    });
  } catch (error) {
    console.error('[License] Failed to create license:', error);
    res.status(500).json({ error: 'Failed to create license' });
  }
});

/**
 * POST /api/v1/licenses/reset
 * Reset a license (unbind from device) - admin only
 */
router.post('/reset', requireApiKey, validateBody(resetLicenseSchema), (req: Request, res: Response) => {
  const { licenseKey } = req.body;

  console.log(`[License] Reset request for key: ${licenseKey.slice(0, 9)}...`);

  const success = resetLicense(licenseKey);

  if (success) {
    console.log(`[License] License reset successfully`);
    res.json({ success: true, message: 'License reset successfully' });
  } else {
    res.status(404).json({ success: false, message: 'License not found' });
  }
});

/**
 * GET /api/v1/licenses
 * List all licenses (admin only)
 */
router.get('/', requireApiKey, (_req: Request, res: Response) => {
  const licenses = getAllLicenses();
  res.json({
    licenses: licenses.map((l) => ({
      id: l.id,
      licenseKey: l.license_key,
      email: l.email,
      status: l.status,
      deviceFingerprintType: l.device_fingerprint_type,
      deviceMirrorId: l.device_mirror_id,
      activatedAt: l.activated_at,
      createdAt: l.created_at,
    })),
  });
});

/**
 * GET /api/v1/licenses/:key/status
 * Check license status (public, used by mirrors)
 */
router.get('/:key/status', (req: Request, res: Response) => {
  const { key } = req.params as { key: string };

  const license = getLicenseByKey(key);

  if (!license) {
    res.status(404).json({
      valid: false,
      status: 'not_found',
      message: 'License not found',
    });
    return;
  }

  res.json({
    valid: license.status === 'active',
    status: license.status,
    activatedAt: license.activated_at,
  });
});

export default router;
