/**
 * Validation schemas for license server API
 */

import { z } from 'zod';

// License key format: XXXX-XXXX-XXXX-XXXX (alphanumeric)
const licenseKeyRegex = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export const activateLicenseSchema = z.object({
  licenseKey: z.string().regex(licenseKeyRegex, 'Invalid license key format'),
  deviceFingerprint: z.string().min(8, 'Device fingerprint too short'),
  deviceFingerprintType: z.enum(['pi_serial', 'machine_id']),
  deviceMirrorId: z.string().optional(),
});

export type ActivateLicenseInput = z.infer<typeof activateLicenseSchema>;

export const createLicenseSchema = z.object({
  email: z.string().email('Invalid email address'),
  stripePaymentId: z.string().optional(),
});

export type CreateLicenseInput = z.infer<typeof createLicenseSchema>;

export const resetLicenseSchema = z.object({
  licenseKey: z.string().regex(licenseKeyRegex, 'Invalid license key format'),
});

export type ResetLicenseInput = z.infer<typeof resetLicenseSchema>;
