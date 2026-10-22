import { EventEmitter } from 'events';
import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    /** Mirror screen orientation; widgets reflow for portrait panels. */
    orientation: 'landscape' | 'portrait';
  };
  /**
   * Calendar accounts are connected from the phone app (data/calendar-accounts.json).
   * The mirror holds no OAuth app credentials; Google/Outlook sign-in goes through
   * the SkyGlass service at `skyglass_service` (see docs/CALENDAR.md).
   */
  calendar?: {
    refresh_minutes?: number;
  };
  schedule: {
    email: {
      enabled: boolean;
      imap_host: string;
      imap_port: number;
      username: string;
      password: string;
      folder: string;
      poll_interval: number;
      sender_filter: string;
    };
  };
  /** Read by packages/presence/detector.py (keep in sync with its PRESENCE_SETTINGS). */
  presence: {
    camera_index: number;
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

  // Load default config
  const defaultYaml = readFileSync(defaultPath, 'utf-8');
  let config = parse(defaultYaml) as Config;

  // Merge user config if exists
  if (existsSync(userPath)) {
    const userYaml = readFileSync(userPath, 'utf-8');
    const userConfig = parse(userYaml) as Record<string, unknown>;
    config = deepMerge(config, userConfig);
  }

  // Substitute environment variables
  config = processConfig(config) as Config;

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
