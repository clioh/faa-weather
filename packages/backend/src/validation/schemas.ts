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
 * OAuth token storage schema.
 */
export const oauthTokenSchema = z.object({
  provider: z.string().max(50).optional(),
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  tokenExpiry: z.number().optional(),
});

export type OAuthTokenInput = z.infer<typeof oauthTokenSchema>;

// ============= Setup Schemas =============

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
  gesture: z.enum(['swipe_left', 'swipe_right', 'wave']),
  confidence: z.number().min(0).max(1).optional(),
});

export type GestureInput = z.infer<typeof gestureSchema>;

// ============= Registration Schemas =============

/**
 * Start registration schema.
 */
export const registrationStartSchema = z.object({
  userName: z.string().max(100).optional(),
  // The app's user profile id. The presence server stores the captured face
  // under face_data/users/<userId>/ so the app can list and delete it.
  userId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
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

/**
 * Display hold: keep the mirror awake while the app edits or previews a layout.
 */
export const displayHoldSchema = z.object({
  seconds: z.number().int().min(5).max(600).optional(),
});

// ============= Widget data schemas (query + body) =============

/** Express gives repeated query keys as arrays; take the first value. */
const firstQueryValue = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const queryString = z.preprocess(firstQueryValue, z.string());
const queryNumber = z.preprocess(firstQueryValue, z.coerce.number());

const latitude = queryNumber.pipe(z.number().min(-90).max(90));
const longitude = queryNumber.pipe(z.number().min(-180).max(180));
const unitsQuery = z.preprocess(firstQueryValue, z.enum(['imperial', 'metric']).default('imperial'));

/** Comma-separated list → uppercase, de-duplicated, non-empty tokens. */
const symbolList = (max: number, pattern: RegExp) =>
  queryString
    .transform((s) => [...new Set(s.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean))])
    .pipe(
      z
        .array(z.string().regex(pattern, 'Invalid symbol'))
        .min(1, 'At least one symbol is required')
        .max(max, `At most ${max} symbols`),
    );

export const newsQuerySchema = z
  .object({
    source: z.preprocess(
      firstQueryValue,
      z.enum(['world', 'us', 'business', 'technology', 'sports', 'aviation', 'custom']).default('world'),
    ),
    url: queryString.pipe(z.string().trim().max(2048)).optional(),
    limit: z.preprocess(firstQueryValue, z.coerce.number().int().min(1).max(30).default(10)),
  })
  .refine((q) => q.source !== 'custom' || !!q.url, { message: 'url is required for custom source', path: ['url'] });

export const stocksQuerySchema = z.object({
  symbols: symbolList(12, /^[A-Z0-9^][A-Z0-9.^-]{0,14}$/),
});

export const cryptoQuerySchema = z.object({
  coins: symbolList(10, /^[A-Z0-9]{1,10}$/),
  currency: z.preprocess(
    (v) => (typeof firstQueryValue(v) === 'string' ? (firstQueryValue(v) as string).toUpperCase() : firstQueryValue(v)),
    z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF']).default('USD'),
  ),
});

export const weatherCurrentQuerySchema = z.object({
  lat: latitude,
  lon: longitude,
  units: unitsQuery,
});

export const weatherForecastQuerySchema = weatherCurrentQuerySchema.extend({
  days: z.preprocess(firstQueryValue, z.coerce.number().int().min(1).max(16).default(5)),
});

export const windsAloftQuerySchema = z.object({
  lat: latitude,
  lon: longitude,
  maxAltitude: z.preprocess(firstQueryValue, z.coerce.number().int().min(3000).max(53000).default(12000)),
});

const todoText = z.string().trim().min(1, 'Text is required').max(500);

export const createTodoSchema = z.object({ text: todoText });

export const updateTodoSchema = z
  .object({ text: todoText.optional(), done: z.boolean().optional() })
  .refine((v) => v.text !== undefined || v.done !== undefined, { message: 'Nothing to update' });

export const replaceTodosSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid id'),
        text: todoText,
        done: z.boolean(),
      }),
    )
    .max(200),
});

export const tfrQuerySchema = z
  .object({
    refresh: z.preprocess(firstQueryValue, z.string().optional()),
    lat: latitude.optional(),
    lon: longitude.optional(),
    radiusNm: queryNumber.pipe(z.number().positive().max(3000)).optional(),
  })
  .refine((q) => (q.lat === undefined) === (q.lon === undefined), {
    message: 'lat and lon must be given together',
    path: ['lat'],
  })
  .refine((q) => q.radiusNm === undefined || q.lat !== undefined, {
    message: 'radiusNm requires lat and lon',
    path: ['radiusNm'],
  });

// ============= Calendar Schemas =============
// Messages are shown verbatim by the phone app.

const calendarLabel = z.string().trim().min(1, 'Label is required').max(60, 'Label is too long (max 60 characters)');

export const calendarPatchSchema = z.object({
  label: calendarLabel.optional(),
  calendars: z
    .array(
      z.object({
        id: z.string().min(1).max(1024),
        enabled: z.boolean().optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be #rrggbb')
          .optional(),
      }),
    )
    .max(200)
    .optional(),
});

export const googleStartSchema = z.object({
  returnUrl: z
    .string({ error: 'returnUrl is required' })
    .max(2048, 'Invalid return URL')
    .regex(/^(skyglass|exp|exp\+skyglass):\/\//, 'Invalid return URL'),
});

export const googleCompleteSchema = z.object({
  code: z.string({ error: 'Missing authorization code' }).min(1, 'Missing authorization code').max(4096),
  state: z.string({ error: 'Missing state' }).min(1, 'Missing state').max(4096),
});

export const caldavAccountSchema = z
  .object({
    provider: z.enum(['icloud', 'caldav'], { error: "provider must be 'icloud' or 'caldav'" }),
    serverUrl: z.string().trim().max(2048, 'Server address is too long').optional(),
    username: z.string({ error: 'Username is required' }).trim().min(1, 'Username is required').max(320),
    password: z.string({ error: 'Password is required' }).min(1, 'Password is required').max(1024),
    label: calendarLabel.optional(),
  })
  .refine((v) => v.provider !== 'caldav' || !!v.serverUrl, {
    message: 'Enter the CalDAV server address',
    path: ['serverUrl'],
  });

export const icsAccountSchema = z.object({
  url: z
    .string({ error: 'Calendar link is required' })
    .trim()
    .min(1, 'Calendar link is required')
    .max(4096, 'Calendar link is too long')
    .regex(/^(https?|webcals?):\/\//i, 'Calendar link must start with https://, http:// or webcal://'),
  label: calendarLabel.optional(),
});
