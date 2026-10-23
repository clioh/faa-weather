import { EventEmitter } from 'events';
import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Panel mounting: landscape, or portrait with the panel turned clockwise
 * ("turned right", portrait-cw) or counter-clockwise ("turned left",
 * portrait-ccw), seen from the front.
 */
export const MIRROR_ORIENTATIONS = ['landscape', 'portrait-cw', 'portrait-ccw'] as const;
export type MirrorOrientation = (typeof MIRROR_ORIENTATIONS)[number];

/**
 * display.orientation as written in YAML. `portrait` (before the rotation
 * direction existed) reads as portrait-cw; anything unknown or missing is
 * landscape.
 */
export function normalizeOrientation(value: unknown): MirrorOrientation {
  if (typeof value !== 'string') return 'landscape';
  const v = value.trim().toLowerCase();
  if (v === 'portrait') return 'portrait-cw';
  return (MIRROR_ORIENTATIONS as readonly string[]).includes(v)
    ? (v as MirrorOrientation)
    : 'landscape';
}

/**
 * Pre-flashed orientation for a kit whose mount is known before first boot.
 * Used until config.yaml sets display.orientation, so the Wi-Fi screen (shown
 * before the app's Orientation step) is already the right way up.
 * packages/presence/rotation.py reads the same file for the camera.
 */
export const DEFAULT_ORIENTATION_FILE = '/boot/firmware/skyglass-orientation.txt';

export function readBootOrientation(): string | null {
  const path = process.env.SKYGLASS_ORIENTATION_FILE || DEFAULT_ORIENTATION_FILE;
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null;
  } catch {
    return null;
  }
}

/** Whether `value` names an orientation (including the legacy `portrait`). */
function isOrientation(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v === 'portrait' || (MIRROR_ORIENTATIONS as readonly string[]).includes(v);
}

/** config.yaml's display.orientation, else the pre-flashed file's, else landscape. */
export function resolveOrientation(
  configured: unknown,
  preflashed: string | null
): MirrorOrientation {
  return normalizeOrientation(
    !isOrientation(configured) && isOrientation(preflashed) ? preflashed : configured
  );
}

export interface Config {
  airport: string;
  /**
   * SkyGlass cloud service base URL (default https://skyglass.dev): calendar
   * sign-in, NOTAMs and stock quotes. The mirror holds no third-party API keys
   * or OAuth secrets; they live on this service (docs/CLOUD_SERVICE.md).
   * https only (http for localhost/127.0.0.1). Self-hosters point it at their own deployment.
   */
  skyglass_service?: string;
  location: {
    latitude: number;
    longitude: number;
    timezone: string;
  };
  display: {
    presence_timeout: number;
    fade_duration: number;
    brightness: number;
    /**
     * How the panel is mounted; the mirror rotates its own UI to match and
     * widgets reflow for portrait. Read through normalizeOrientation, so the
     * legacy value `portrait` arrives as `portrait-cw`.
     */
    orientation: MirrorOrientation;
  };
  /**
   * Calendar accounts are connected from the phone app (data/calendar-accounts.json).
   * The mirror holds no OAuth app credentials; Google/Outlook sign-in goes through
   * the SkyGlass service at `skyglass_service` (see docs/CALENDAR.md).
   */
  calendar?: {
    refresh_minutes?: number;
  };
  /** Read by packages/presence/detector.py (keep in sync with its PRESENCE_SETTINGS). */
  presence: {
    camera_index: number;
    /** Turns camera frames upright (packages/presence/rotation.py): auto follows display.orientation, else degrees clockwise. */
    camera_rotation?: 'auto' | 0 | 90 | 180 | 270;
    detection_method: 'face_recognition' | 'opencv' | 'auto';
    /** Face match tolerance 0-1, lower = stricter (face_recognition only). */
    tolerance: number;
    min_detection_frames: number;
    /** Seconds without a face before reporting absent. */
    timeout: number;
  };
  /** Licensing (docs/LICENSING.md). SKYGLASS_LICENSE=off forces enabled=false. */
  license: {
    enabled: boolean;
    /** Cloud license API base URL; the mirror POSTs to `${server}/api/license/*`. */
    server: string;
  };
}

function substituteEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, varName) => {
    return process.env[varName] || '';
  });
}

function processConfig(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return substituteEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(processConfig);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = processConfig(value);
    }
    return result;
  }
  return obj;
}

export function loadConfig(): Config {
  // Find config directory (4 levels up from dist/config or src/config to project root)
  const projectRoot = join(__dirname, '..', '..', '..', '..');
  const configDir = join(projectRoot, 'config');

  const defaultPath = join(configDir, 'default.yaml');
  const userPath = join(configDir, 'config.yaml');

  if (!existsSync(defaultPath)) {
    throw new Error(`Default config not found at ${defaultPath}`);
  }

  return parseConfig(
    readFileSync(defaultPath, 'utf-8'),
    existsSync(userPath) ? readFileSync(userPath, 'utf-8') : null,
    readBootOrientation()
  );
}

/**
 * default.yaml with config.yaml (if any) merged over it, env vars applied.
 * `bootOrientation` (the pre-flashed file's contents) stands in for
 * display.orientation while config.yaml doesn't set a valid one.
 */
export function parseConfig(
  defaultYaml: string,
  userYaml: string | null,
  bootOrientation: string | null = null
): Config {
  let config = parse(defaultYaml) as Config;
  let userOrientation: unknown;

  // Merge user config if exists
  if (userYaml !== null) {
    const userConfig = parse(userYaml) as Record<string, unknown> | null;
    if (userConfig) config = deepMerge(config, userConfig);
    userOrientation = (userConfig?.display as Record<string, unknown> | undefined)?.orientation;
  }

  // Substitute environment variables
  config = processConfig(config) as Config;
  const preflashed = isOrientation(bootOrientation) && !isOrientation(userOrientation);
  config.display = {
    ...config.display,
    orientation: normalizeOrientation(preflashed ? bootOrientation : config.display?.orientation),
  };

  return applyEnvOverrides(config);
}

const DEFAULT_LICENSE_SERVER = 'https://skyglass.dev';

/** Environment switches that take precedence over the YAML files. */
function applyEnvOverrides(config: Config): Config {
  const license = config.license ?? { enabled: true, server: DEFAULT_LICENSE_SERVER };
  const licenseEnv = process.env.SKYGLASS_LICENSE?.trim().toLowerCase();
  config.license = {
    // Anything but an explicit false keeps licensing on.
    enabled: licenseEnv === 'off' ? false : license.enabled !== false,
    server: (license.server || DEFAULT_LICENSE_SERVER).replace(/\/+$/, ''),
  };
  return config;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: Record<string, unknown>): Config {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];
    if (
      sourceVal &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal, sourceVal as Record<string, unknown>);
    } else {
      result[key] = sourceVal;
    }
  }
  return result as Config;
}

/**
 * Emits 'changed' after config/config.yaml is rewritten (setup routes).
 * Long-lived consumers that cached loadConfig() at startup subscribe so a
 * new airport/location takes effect without a restart.
 */
export const configEvents = new EventEmitter();

export function notifyConfigChanged(): void {
  configEvents.emit('changed');
}
