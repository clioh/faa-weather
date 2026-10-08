import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface WidgetConfig {
  type: string;
  position: string;
  [key: string]: unknown;
}

export interface Config {
  airport: string;
  notam_api_key: string;
  location: {
    latitude: number;
    longitude: number;
    timezone: string;
  };
  display: {
    presence_timeout: number;
    fade_duration: number;
    brightness: number;
  };
  calendar: {
    google: {
      enabled: boolean;
      calendar_ids: string[];
    };
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
  widgets: WidgetConfig[];
  presence: {
    camera_index: number;
    detection_method: 'face_recognition' | 'haar' | 'mediapipe' | 'auto';
    sensitivity: number;
    min_detection_frames: number;
  };
  license?: {
    enabled: boolean;
    key: string;
    serverUrl: string;
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
