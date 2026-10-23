import express from 'express';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { fileURLToPath } from 'url';
import { configWriteLimiter } from '../middleware/rateLimiter.js';
import { searchAirports, nearbyAirports } from '../services/airports.js';
import { validateBody } from '../middleware/validate.js';
import {
  setupAirportSchema,
  setupLocationSchema,
  setupOrientationSchema,
} from '../validation/schemas.js';
import {
  notifyConfigChanged,
  readBootOrientation,
  resolveOrientation,
  type MirrorOrientation,
} from '../config/index.js';
import { licenseManager } from '../license/index.js';
import { orientationPreview, type OrientationPreview } from '../services/orientation.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths
const CONFIG_DIR = path.resolve(__dirname, '../../../../config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');
const DEFAULT_CONFIG = path.join(CONFIG_DIR, 'default.yaml');
const FACE_DATA_DIR = path.resolve(__dirname, '../../../presence/face_data');
const FACE_USERS_DIR = path.join(FACE_DATA_DIR, 'users');
const WIFI_CONFIGURED_FLAG = path.join(FACE_DATA_DIR, '.wifi_configured');

const DEFAULT_TIMEZONE = 'America/New_York';

/**
 * True if at least one user enrollment exists, i.e. a
 * face_data/users/<userId>/ directory containing encodings.pkl
 * (written by presence/web_server.py save_user_face_data). The file is
 * present, but holds an empty list, when the mirror has no face_recognition
 * installed; OpenCV detection needs no encodings, so that still
 * counts as enrolled.
 */
export function hasEnrolledUsers(usersDir: string = FACE_USERS_DIR): boolean {
  try {
    return fs
      .readdirSync(usersDir, { withFileTypes: true })
      .some(
        (entry) =>
          entry.isDirectory() && fs.existsSync(path.join(usersDir, entry.name, 'encodings.pkl'))
      );
  } catch {
    return false;
  }
}

export interface ConfigDoc {
  airport?: string;
  display?: { orientation?: unknown; [key: string]: unknown };
  location?: { latitude?: number; longitude?: number; timezone?: string };
  /** Written by the setup routes: which steps the user has explicitly completed. */
  setup?: { completed?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

export type SetupStep = 'orientation' | 'airport' | 'location';

/**
 * True when the setup flow has recorded this step as done. Values that merely
 * differ from config/default.yaml do not count, so the default airport can be
 * chosen explicitly.
 */
export function isStepCompleted(config: ConfigDoc, step: SetupStep): boolean {
  const completed = config.setup?.completed;
  return Array.isArray(completed) && completed.includes(step);
}

/** Record a step as completed (idempotent). */
export function markStepCompleted(config: ConfigDoc, step: SetupStep): ConfigDoc {
  const existing = config.setup?.completed;
  const completed = Array.isArray(existing) ? existing.filter((s) => typeof s === 'string') : [];
  if (!completed.includes(step)) completed.push(step);
  config.setup = { ...(config.setup ?? {}), completed };
  return config;
}

/** Read the user config (or default config if none written yet). */
function readConfig(): ConfigDoc {
  const configPath = fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : DEFAULT_CONFIG;
  return yaml.parse(fs.readFileSync(configPath, 'utf-8')) ?? {};
}

/** Persist the config to config/config.yaml. */
function writeConfig(config: ConfigDoc): void {
  fs.writeFileSync(CONFIG_FILE, yaml.stringify(config), 'utf-8');
  notifyConfigChanged();
}

export type SetupProgressStep =
  | 'wifi'
  | 'orientation'
  | 'license'
  | 'location'
  | 'airport'
  | 'face'
  | 'complete';

export interface SetupFlags {
  configExists: boolean;
  wifiConfigured: boolean;
  orientationConfigured: boolean;
  licenseActivated: boolean;
  locationConfigured: boolean;
  airportConfigured: boolean;
  faceEnrolled: boolean;
}

export interface SetupStatus extends SetupFlags {
  setupComplete: boolean;
  needsSetup: boolean;
  /** First incomplete step; the phone app navigates by it. */
  step: SetupProgressStep;
}

/**
 * Derive setup status from on-disk state. Orientation, airport and location
 * count only once the setup flow has recorded them in `setup.completed`.
 *
 * Order: WiFi -> Orientation -> License -> Location -> Airport -> Face
 * (docs/LICENSING.md). Orientation comes before License so every later mirror
 * screen is drawn the right way up; location comes before airport so the
 * airport step can suggest fields near the mirror. The mirror leaves the
 * setup screen once config.yaml exists, the license is activated and a face
 * is enrolled (orientation doesn't hold it there).
 *
 * Orientation also counts as configured (landscape) whenever config.yaml
 * exists: mirrors set up before the step existed have one without the marker
 * and must not fall back into setup. A new mirror only writes config.yaml at
 * the Orientation step or later.
 */
export function computeSetupStatus(
  config: ConfigDoc | null,
  state: Pick<SetupFlags, 'configExists' | 'faceEnrolled' | 'wifiConfigured' | 'licenseActivated'>
): SetupStatus {
  const f: SetupFlags = {
    ...state,
    orientationConfigured:
      state.configExists || (!!config && isStepCompleted(config, 'orientation')),
    airportConfigured: !!config && isStepCompleted(config, 'airport'),
    locationConfigured: !!config && isStepCompleted(config, 'location'),
  };
  const setupComplete = f.configExists && f.licenseActivated && f.faceEnrolled;
  let step: SetupProgressStep = 'complete';
  if (!setupComplete) {
    if (!f.wifiConfigured) step = 'wifi';
    else if (!f.orientationConfigured) step = 'orientation';
    else if (!f.licenseActivated) step = 'license';
    else if (!f.locationConfigured) step = 'location';
    else if (!f.airportConfigured) step = 'airport';
    // Also the fallback when every flag is set but config.yaml is missing.
    else step = 'face';
  }
  return { ...f, setupComplete, needsSetup: !setupComplete, step };
}

/** Current setup status of this mirror (also used by /api/discovery). */
export function getSetupStatus(): SetupStatus {
  let config: ConfigDoc | null = null;
  try {
    config = readConfig();
  } catch {
    // Config not readable
  }
  return computeSetupStatus(config, {
    configExists: fs.existsSync(CONFIG_FILE),
    faceEnrolled: hasEnrolledUsers(),
    wifiConfigured: fs.existsSync(WIFI_CONFIGURED_FLAG),
    // Always true when licensing is disabled (SKYGLASS_LICENSE=off, dev scripts).
    licenseActivated: licenseManager.isActivated(),
  });
}

/**
 * GET /api/setup/status
 */
router.get('/status', (_req, res) => {
  // The setup screen's QR (connect + pair deep link) comes from GET
  // /api/pairing/qr, which also honours SKYGLASS_DEV_APP_URL (dev-e2e).
  res.json(getSetupStatus());
});

/**
 * POST /api/setup/airport
 * Body: { icao } (mobile app setup flow). Writes config.yaml.
 */
router.post('/airport', configWriteLimiter, validateBody(setupAirportSchema), (req, res) => {
  try {
    const { icao } = req.body as { icao: string };
    const config = readConfig();
    config.airport = icao.toUpperCase();
    markStepCompleted(config, 'airport');
    writeConfig(config);
    res.json({ success: true, airport: config.airport });
  } catch (error) {
    console.error('Failed to update airport:', error);
    res.status(500).json({ error: 'Failed to update airport' });
  }
});

/**
 * GET /api/setup/location
 * Returns { latitude, longitude, timezone }, or null until the location step is done.
 */
router.get('/location', (_req, res) => {
  try {
    const config = readConfig();
    const loc = config.location;
    if (
      !isStepCompleted(config, 'location') ||
      !loc ||
      typeof loc.latitude !== 'number' ||
      typeof loc.longitude !== 'number'
    ) {
      return res.json(null);
    }
    res.json({
      latitude: loc.latitude,
      longitude: loc.longitude,
      timezone: loc.timezone || DEFAULT_TIMEZONE,
    });
  } catch (error) {
    console.error('Failed to read location:', error);
    res.status(500).json({ error: 'Failed to load location' });
  }
});

/**
 * POST /api/setup/location
 * Body: { latitude, longitude, timezone? }. Writes config.yaml.
 */
router.post('/location', configWriteLimiter, validateBody(setupLocationSchema), (req, res) => {
  try {
    const location = req.body as { latitude: number; longitude: number; timezone?: string };
    const config = readConfig();
    config.location = {
      ...config.location,
      ...location,
    };
    markStepCompleted(config, 'location');
    writeConfig(config);
    res.json({ success: true, location: config.location });
  } catch (error) {
    console.error('Failed to update location:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

export interface OrientationRouteDeps {
  readConfig: () => ConfigDoc;
  writeConfig: (config: ConfigDoc) => void;
  preview: OrientationPreview;
  /** Pre-flashed orientation file contents (config/index.ts); defaults to reading it. */
  bootOrientation?: () => string | null;
}

/**
 * /api/setup/orientation (the app's Orientation step and Settings › Mirror).
 *
 * GET              { orientation, preview }: the saved value and the one
 *                  being previewed (null when none is).
 * POST             { orientation, preview? }. With preview: true the mirror
 *                  turns to it live and shows its "This way up?" check;
 *                  nothing is saved. Otherwise it is written to config.yaml,
 *                  the step is marked done and any preview ends.
 * DELETE /preview  Ends the preview (the app's Back): the mirror returns to
 *                  the saved orientation.
 */
export function createOrientationRouter(deps: OrientationRouteDeps): express.Router {
  const orientation = express.Router();
  const bootOrientation = deps.bootOrientation ?? readBootOrientation;
  const saved = (): MirrorOrientation =>
    resolveOrientation(deps.readConfig().display?.orientation, bootOrientation());

  orientation.get('/', (_req, res) => {
    try {
      res.json({ orientation: saved(), preview: deps.preview.current() });
    } catch (error) {
      console.error('Failed to read orientation:', error);
      res.status(500).json({ error: 'Failed to load orientation' });
    }
  });

  orientation.post(
    '/',
    validateBody(setupOrientationSchema),
    // Previews are taps on a radio card; only saves count as config writes.
    (req, res, next) =>
      (req.body as { preview?: boolean }).preview ? next() : configWriteLimiter(req, res, next),
    (req, res) => {
      const body = req.body as { orientation: MirrorOrientation; preview?: boolean };
      if (body.preview) {
        deps.preview.set(body.orientation);
        return res.json({ success: true, orientation: body.orientation, preview: true });
      }
      try {
        const config = deps.readConfig();
        config.display = { ...(config.display ?? {}), orientation: body.orientation };
        markStepCompleted(config, 'orientation');
        deps.writeConfig(config);
        deps.preview.clear();
        res.json({ success: true, orientation: body.orientation, preview: false });
      } catch (error) {
        console.error('Failed to update orientation:', error);
        res.status(500).json({ error: 'Failed to update orientation' });
      }
    }
  );

  orientation.delete('/preview', (_req, res) => {
    deps.preview.clear();
    try {
      res.json({ success: true, orientation: saved() });
    } catch {
      res.json({ success: true });
    }
  });

  return orientation;
}

router.use(
  '/orientation',
  createOrientationRouter({ readConfig, writeConfig, preview: orientationPreview })
);

/**
 * Airport search/autocomplete endpoint (ICAO, IATA, name, city or keyword).
 * Backed by data/airports.json; see services/airports.ts.
 */
router.get('/airports', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  res.json(searchAirports(query, 10));
});

/**
 * Airports nearest a point, for suggesting a home airport after the location
 * step. Query: lat, lon (decimal degrees); limit (default 8, max 20). With no
 * coordinates, uses the location saved in config.yaml.
 */
router.get('/airports/nearby', (req, res) => {
  let lat = Number(req.query.lat);
  let lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const loc = readConfig().location;
    lat = Number(loc?.latitude);
    lon = Number(loc?.longitude);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 8));
  res.json(nearbyAirports(lat, lon, limit));
});

export default router;
