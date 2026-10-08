/**
 * Request Validation Schemas
 *
 * Zod schemas for validating all POST/PUT/PATCH request bodies.
 */

import { z } from 'zod';

// ============= Common Schemas =============

/**
 * Module position schema.
 */
const modulePositionSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
});

/**
 * Module size enum.
 */
const moduleSizeSchema = z.enum(['small', 'medium', 'large', 'wide', 'tall', 'full']);

/**
 * Module instance schema.
 */
const moduleInstanceSchema = z.object({
  instanceId: z.string().min(1).max(100),
  moduleId: z.string().min(1).max(100),
  position: modulePositionSchema,
  size: moduleSizeSchema,
  config: z.record(z.string(), z.unknown()).default({}),
});

// ============= Presence Schemas =============

/**
 * Presence update schema (from Python detector).
 */
export const presenceSchema = z.object({
  present: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  state: z.string().max(50).optional(),
  userId: z.string().max(100).optional(),
  userName: z.string().max(100).optional(),
});

export type PresenceInput = z.infer<typeof presenceSchema>;

// ============= User Schemas =============

/**
 * Create/update user schema.
 */
export const createUserSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * User layout modules update schema.
 */
export const userLayoutModulesSchema = z.object({
  modules: z.array(z.record(z.string(), z.unknown())),
});

export type UserLayoutModulesInput = z.infer<typeof userLayoutModulesSchema>;

/**
 * Create user layout schema.
 */
export const createUserLayoutSchema = z.object({
  name: z.string().min(1).max(100),
  modules: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type CreateUserLayoutInput = z.infer<typeof createUserLayoutSchema>;

// ============= Layout Schemas =============

/**
 * Full layout schema.
 */
export const layoutSchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().max(100).optional(),
  modules: z.array(moduleInstanceSchema),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type LayoutInput = z.infer<typeof layoutSchema>;

/**
 * Add module schema.
 */
export const addModuleSchema = moduleInstanceSchema;

export type AddModuleInput = z.infer<typeof addModuleSchema>;

/**
 * Module update schema (PATCH).
 */
export const moduleUpdateSchema = z.object({
  position: modulePositionSchema.optional(),
  size: moduleSizeSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type ModuleUpdateInput = z.infer<typeof moduleUpdateSchema>;

/**
 * OAuth token storage schema.
 */
export const oauthTokenSchema = z.object({
  provider: z.string().max(50).optional(),
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  tokenExpiry: z.number().optional(),
});

export type OAuthTokenInput = z.infer<typeof oauthTokenSchema>;

/**
 * Save layout schema.
 */
export const saveLayoutSchema = z.object({
  name: z.string().min(1).max(100),
});

export type SaveLayoutInput = z.infer<typeof saveLayoutSchema>;

// ============= Setup Schemas =============

/**
 * Setup config schema.
 */
export const setupConfigSchema = z.object({
  airport: z
    .string()
    .length(4)
    .regex(/^[A-Z]{4}$/i, 'Must be a valid 4-letter ICAO code')
    .transform((v) => v.toUpperCase())
    .optional(),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      timezone: z.string().max(100).optional(),
    })
    .optional(),
});

export type SetupConfigInput = z.infer<typeof setupConfigSchema>;

/**
 * POST /api/setup/airport body (mobile app sends `{ icao }`).
 */
export const setupAirportSchema = z.object({
  icao: z
    .string()
    .length(4)
    .regex(/^[A-Z]{4}$/i, 'Must be a valid 4-letter ICAO code')
    .transform((v) => v.toUpperCase()),
});

/**
 * POST /api/setup/location body (mobile app sends `{ latitude, longitude, timezone }`).
 */
export const setupLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().min(1).max(100).optional(),
});

/**
 * POST /api/wifi/connect body.
 */
export const wifiConnectSchema = z.object({
  ssid: z.string().min(1).max(32),
  password: z.string().max(63).optional().default(''),
});

// ============= Gesture Schemas =============

/**
 * Gesture event schema.
 */
export const gestureSchema = z.object({
  gesture: z.enum(['swipe_left', 'swipe_right', 'wave', 'palm', 'thumbs_up', 'thumbs_down']),
  confidence: z.number().min(0).max(1).optional(),
});

export type GestureInput = z.infer<typeof gestureSchema>;

// ============= Registration Schemas =============

/**
 * Start registration schema.
 */
export const registrationStartSchema = z.object({
  // Deprecated and ignored: the backend always targets SKYGLASS_ADMIN_URL.
  presenceServerUrl: z.string().url().optional(),
  userName: z.string().max(100).optional(),
});

export type RegistrationStartInput = z.infer<typeof registrationStartSchema>;

/**
 * Registration progress schema.
 */
export const registrationProgressSchema = z.object({
  samplesCollected: z.number().int().min(0).optional(),
  samplesNeeded: z.number().int().min(1).optional(),
});

export type RegistrationProgressInput = z.infer<typeof registrationProgressSchema>;

// ============= Update Config Schema =============

/**
 * Update config schema.
 */
export const updateConfigSchema = z.object({
  autoUpdate: z.boolean().optional(),
  autoDownload: z.boolean().optional(),
  checkInterval: z.number().int().min(1).max(168).optional(), // 1-168 hours (1 week)
  notifyOnly: z.boolean().optional(),
  githubRepo: z.string().max(200).optional(),
});

export type UpdateConfigInput = z.infer<typeof updateConfigSchema>;

// ============= Export all schemas =============

export default {
  presenceSchema,
  createUserSchema,
  userLayoutModulesSchema,
  createUserLayoutSchema,
  layoutSchema,
  addModuleSchema,
  moduleUpdateSchema,
  oauthTokenSchema,
  saveLayoutSchema,
  setupConfigSchema,
  setupAirportSchema,
  setupLocationSchema,
  wifiConnectSchema,
  gestureSchema,
  registrationStartSchema,
  registrationProgressSchema,
  updateConfigSchema,
};
