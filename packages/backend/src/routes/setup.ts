import express from 'express';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { fileURLToPath } from 'url';
import { criticalLimiter, configWriteLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import {
  setupConfigSchema,
  setupAirportSchema,
  setupLocationSchema,
} from '../validation/schemas.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Common US airports for autocomplete (can be expanded)
const AIRPORTS = [
  { icao: 'KATL', name: 'Hartsfield-Jackson Atlanta', city: 'Atlanta, GA' },
  { icao: 'KLAX', name: 'Los Angeles International', city: 'Los Angeles, CA' },
  { icao: 'KORD', name: "O'Hare International", city: 'Chicago, IL' },
  { icao: 'KDFW', name: 'Dallas/Fort Worth International', city: 'Dallas, TX' },
  { icao: 'KDEN', name: 'Denver International', city: 'Denver, CO' },
  { icao: 'KJFK', name: 'John F. Kennedy International', city: 'New York, NY' },
  { icao: 'KSFO', name: 'San Francisco International', city: 'San Francisco, CA' },
  { icao: 'KSEA', name: 'Seattle-Tacoma International', city: 'Seattle, WA' },
  { icao: 'KMCO', name: 'Orlando International', city: 'Orlando, FL' },
  { icao: 'KLAS', name: 'Harry Reid International', city: 'Las Vegas, NV' },
  { icao: 'KMIA', name: 'Miami International', city: 'Miami, FL' },
  { icao: 'KPHX', name: 'Phoenix Sky Harbor', city: 'Phoenix, AZ' },
  { icao: 'KIAH', name: 'George Bush Intercontinental', city: 'Houston, TX' },
  { icao: 'KBOS', name: 'Boston Logan International', city: 'Boston, MA' },
  { icao: 'KMSP', name: 'Minneapolis-St Paul International', city: 'Minneapolis, MN' },
  { icao: 'KDTW', name: 'Detroit Metropolitan', city: 'Detroit, MI' },
  { icao: 'KEWR', name: 'Newark Liberty International', city: 'Newark, NJ' },
  { icao: 'KLGA', name: 'LaGuardia', city: 'New York, NY' },
  { icao: 'KPHL', name: 'Philadelphia International', city: 'Philadelphia, PA' },
  { icao: 'KCLT', name: 'Charlotte Douglas International', city: 'Charlotte, NC' },
  { icao: 'KSAN', name: 'San Diego International', city: 'San Diego, CA' },
  { icao: 'KTPA', name: 'Tampa International', city: 'Tampa, FL' },
  { icao: 'KPDX', name: 'Portland International', city: 'Portland, OR' },
  { icao: 'KSLC', name: 'Salt Lake City International', city: 'Salt Lake City, UT' },
  { icao: 'KAUS', name: 'Austin-Bergstrom International', city: 'Austin, TX' },
  { icao: 'KBWI', name: 'Baltimore/Washington International', city: 'Baltimore, MD' },
  { icao: 'KIAD', name: 'Washington Dulles International', city: 'Washington, DC' },
  { icao: 'KDCA', name: 'Ronald Reagan Washington National', city: 'Washington, DC' },
  { icao: 'KFLL', name: 'Fort Lauderdale-Hollywood', city: 'Fort Lauderdale, FL' },
  { icao: 'KOAK', name: 'Oakland International', city: 'Oakland, CA' },
  { icao: 'KSJC', name: 'San Jose International', city: 'San Jose, CA' },
  { icao: 'KSMF', name: 'Sacramento International', city: 'Sacramento, CA' },
  { icao: 'KRDU', name: 'Raleigh-Durham International', city: 'Raleigh, NC' },
  { icao: 'KMKE', name: 'Milwaukee Mitchell International', city: 'Milwaukee, WI' },
  { icao: 'KPIT', name: 'Pittsburgh International', city: 'Pittsburgh, PA' },
  { icao: 'KCLE', name: 'Cleveland Hopkins International', city: 'Cleveland, OH' },
  { icao: 'KCVG', name: 'Cincinnati/Northern Kentucky', city: 'Cincinnati, OH' },
  { icao: 'KIND', name: 'Indianapolis International', city: 'Indianapolis, IN' },
  { icao: 'KMCI', name: 'Kansas City International', city: 'Kansas City, MO' },
  { icao: 'KSTL', name: 'St. Louis Lambert International', city: 'St. Louis, MO' },
  { icao: 'KMDW', name: 'Chicago Midway', city: 'Chicago, IL' },
  { icao: 'KHOU', name: 'William P. Hobby', city: 'Houston, TX' },
  { icao: 'KDAL', name: 'Dallas Love Field', city: 'Dallas, TX' },
  { icao: 'KBUR', name: 'Hollywood Burbank', city: 'Burbank, CA' },
  { icao: 'KSNA', name: 'John Wayne Airport', city: 'Santa Ana, CA' },
  { icao: 'KTEB', name: 'Teterboro', city: 'Teterboro, NJ' },
  { icao: 'KVNY', name: 'Van Nuys', city: 'Van Nuys, CA' },
  { icao: 'KPAO', name: 'Palo Alto', city: 'Palo Alto, CA' },
  { icao: 'KSQL', name: 'San Carlos', city: 'San Carlos, CA' },
  // International
  { icao: 'EGLL', name: 'London Heathrow', city: 'London, UK' },
  { icao: 'EGKK', name: 'London Gatwick', city: 'London, UK' },
  { icao: 'LFPG', name: 'Paris Charles de Gaulle', city: 'Paris, France' },
  { icao: 'EDDF', name: 'Frankfurt', city: 'Frankfurt, Germany' },
  { icao: 'EHAM', name: 'Amsterdam Schiphol', city: 'Amsterdam, Netherlands' },
  { icao: 'LEMD', name: 'Madrid-Barajas', city: 'Madrid, Spain' },
  { icao: 'CYYZ', name: 'Toronto Pearson', city: 'Toronto, Canada' },
  { icao: 'CYVR', name: 'Vancouver International', city: 'Vancouver, Canada' },
  { icao: 'MMMX', name: 'Mexico City International', city: 'Mexico City, Mexico' },
];

// Paths
const CONFIG_DIR = path.resolve(__dirname, '../../../../config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');
const DEFAULT_CONFIG = path.join(CONFIG_DIR, 'default.yaml');
const FACE_DATA_DIR = path.resolve(__dirname, '../../../presence/face_data');
const FACE_ENCODING_FILE = path.join(FACE_DATA_DIR, 'enrolled_face.pkl');
const FACE_USERS_DIR = path.join(FACE_DATA_DIR, 'users');
const WIFI_CONFIGURED_FLAG = path.join(FACE_DATA_DIR, '.wifi_configured');

const DEFAULT_LOCATION = {
  latitude: 40.6413,
  longitude: -73.7781,
  timezone: 'America/New_York',
};

/**
 * True if at least one multi-user enrollment exists, i.e. a
 * face_data/users/<userId>/ directory containing encodings.pkl
 * (written by presence/web_server.py save_user_face_data).
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

/**
 * True if a face is enrolled either via the legacy single-user file or via
 * multi-user enrollment.
 */
export function isFaceEnrolled(
  legacyFile: string = FACE_ENCODING_FILE,
  usersDir: string = FACE_USERS_DIR
): boolean {
  return fs.existsSync(legacyFile) || hasEnrolledUsers(usersDir);
}

interface ConfigDoc {
  airport?: string;
  location?: { latitude?: number; longitude?: number; timezone?: string };
  [key: string]: unknown;
}

/** Read the user config (or default config if none written yet). */
function readConfig(): ConfigDoc {
  const configPath = fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : DEFAULT_CONFIG;
  return yaml.parse(fs.readFileSync(configPath, 'utf-8')) ?? {};
}

/** Persist the config to config/config.yaml (same as POST /config). */
function writeConfig(config: ConfigDoc): void {
  fs.writeFileSync(CONFIG_FILE, yaml.stringify(config), 'utf-8');
}

/**
 * Check setup status
 */
router.get('/status', (_req, res) => {
  const configExists = fs.existsSync(CONFIG_FILE);
  const faceEnrolled = isFaceEnrolled();
  const wifiConfigured = fs.existsSync(WIFI_CONFIGURED_FLAG);

  // Load config to check if airport is set
  let config = null;
  let airportConfigured = false;
  let locationConfigured = false;

  try {
    const configPath = configExists ? CONFIG_FILE : DEFAULT_CONFIG;
    const configContent = fs.readFileSync(configPath, 'utf-8');
    config = yaml.parse(configContent);

    // Check if airport is configured (not the default KJFK)
    airportConfigured = !!config.airport && config.airport !== 'KJFK';

    // Check if location is configured (not the default JFK coords)
    locationConfigured =
      config.location?.latitude !== DEFAULT_LOCATION.latitude ||
      config.location?.longitude !== DEFAULT_LOCATION.longitude;
  } catch {
    // Config not readable
  }

  const setupComplete = configExists && faceEnrolled;

  // Mobile app (packages/mobile/lib/api.ts SetupStatus) expects snake_case
  // step flags plus the first incomplete `step`.
  let step: 'wifi' | 'airport' | 'location' | 'face' | 'complete' = 'complete';
  if (!setupComplete) {
    if (!wifiConfigured) step = 'wifi';
    else if (!airportConfigured) step = 'airport';
    else if (!locationConfigured) step = 'location';
    else if (!faceEnrolled) step = 'face';
  }

  res.json({
    configExists,
    faceEnrolled,
    airportConfigured,
    locationConfigured,
    wifiConfigured,
    setupComplete,
    needsSetup: !setupComplete,
    // Mobile app shape
    step,
    wifi_configured: wifiConfigured,
    airport_configured: airportConfigured,
    location_configured: locationConfigured,
    face_registered: faceEnrolled,
  });
});

/**
 * Get current configuration
 */
router.get('/config', (_req, res) => {
  try {
    const configPath = fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : DEFAULT_CONFIG;
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.parse(configContent);

    // Return non-sensitive config
    res.json({
      airport: config.airport || 'KJFK',
      location: config.location || {
        latitude: 40.6413,
        longitude: -73.7781,
        timezone: 'America/New_York',
      },
    });
  } catch {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

/**
 * Update configuration
 */
router.post('/config', criticalLimiter, validateBody(setupConfigSchema), (req, res) => {
  try {
    const { airport, location } = req.body;

    // Load existing config or default
    const configPath = fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : DEFAULT_CONFIG;
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.parse(configContent);

    // Update fields
    if (airport) {
      config.airport = airport.toUpperCase();
    }
    if (location) {
      config.location = {
        ...config.location,
        ...location,
      };
    }

    // Write to user config file
    const newContent = yaml.stringify(config);
    fs.writeFileSync(CONFIG_FILE, newContent, 'utf-8');

    res.json({ success: true, config: { airport: config.airport, location: config.location } });
  } catch (error) {
    console.error('Failed to update config:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

/**
 * POST /api/setup/airport
 * Body: { icao } (mobile app setup flow). Writes config.yaml like POST /config.
 */
router.post('/airport', configWriteLimiter, validateBody(setupAirportSchema), (req, res) => {
  try {
    const { icao } = req.body as { icao: string };
    const config = readConfig();
    config.airport = icao.toUpperCase();
    writeConfig(config);
    res.json({ success: true, airport: config.airport });
  } catch (error) {
    console.error('Failed to update airport:', error);
    res.status(500).json({ error: 'Failed to update airport' });
  }
});

/**
 * GET /api/setup/location
 * Returns { latitude, longitude, timezone } or null if still the default.
 */
router.get('/location', (_req, res) => {
  try {
    const config = readConfig();
    const loc = config.location;
    if (
      !loc ||
      typeof loc.latitude !== 'number' ||
      typeof loc.longitude !== 'number' ||
      (loc.latitude === DEFAULT_LOCATION.latitude && loc.longitude === DEFAULT_LOCATION.longitude)
    ) {
      return res.json(null);
    }
    res.json({
      latitude: loc.latitude,
      longitude: loc.longitude,
      timezone: loc.timezone || DEFAULT_LOCATION.timezone,
    });
  } catch (error) {
    console.error('Failed to read location:', error);
    res.status(500).json({ error: 'Failed to load location' });
  }
});

/**
 * POST /api/setup/location
 * Body: { latitude, longitude, timezone? }. Writes config.yaml like POST /config.
 */
router.post('/location', configWriteLimiter, validateBody(setupLocationSchema), (req, res) => {
  try {
    const location = req.body as { latitude: number; longitude: number; timezone?: string };
    const config = readConfig();
    config.location = {
      ...config.location,
      ...location,
    };
    writeConfig(config);
    res.json({ success: true, location: config.location });
  } catch (error) {
    console.error('Failed to update location:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

/**
 * Airport search/autocomplete endpoint
 */
router.get('/airports', (req, res) => {
  const query = (req.query.q as string || '').toUpperCase().trim();

  if (query.length < 2) {
    return res.json([]);
  }

  // Filter airports matching the query
  const matches = AIRPORTS.filter(
    (a) =>
      a.icao.includes(query) ||
      a.name.toUpperCase().includes(query) ||
      a.city.toUpperCase().includes(query)
  ).slice(0, 10);

  res.json(matches);
});

/**
 * Serve the setup wizard HTML page
 */
router.get('/', (_req, res) => {
  res.send(SETUP_WIZARD_HTML);
});

const SETUP_WIZARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SkyGlass - Setup Wizard</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 40px 20px;
            color: #fff;
        }
        h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .subtitle {
            color: #888;
            margin-bottom: 40px;
            font-size: 1.1rem;
        }
        .container {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 20px;
            padding: 40px;
            max-width: 600px;
            width: 100%;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .step {
            display: none;
        }
        .step.active {
            display: block;
        }
        .step-header {
            display: flex;
            align-items: center;
            gap: 15px;
            margin-bottom: 25px;
        }
        .step-number {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            color: #1a1a2e;
        }
        .step-title {
            font-size: 1.5rem;
        }
        .step-description {
            color: #aaa;
            margin-bottom: 30px;
            line-height: 1.6;
        }
        .form-group {
            margin-bottom: 25px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            color: #ccc;
            font-weight: 500;
        }
        input[type="text"],
        input[type="number"],
        select {
            width: 100%;
            padding: 14px 16px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 10px;
            background: rgba(0, 0, 0, 0.3);
            color: #fff;
            font-size: 1rem;
            transition: border-color 0.3s;
        }
        input[type="text"]:focus,
        input[type="number"]:focus,
        select:focus {
            outline: none;
            border-color: #00d9ff;
        }
        .location-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }
        .button-row {
            display: flex;
            gap: 15px;
            margin-top: 35px;
        }
        button {
            flex: 1;
            padding: 15px 25px;
            border: none;
            border-radius: 10px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        .btn-primary {
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            color: #1a1a2e;
        }
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(0, 217, 255, 0.4);
        }
        .btn-secondary {
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.2);
        }
        .progress-bar {
            display: flex;
            justify-content: center;
            gap: 10px;
            margin-bottom: 40px;
        }
        .progress-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.2);
            transition: all 0.3s;
        }
        .progress-dot.active {
            background: #00d9ff;
        }
        .progress-dot.completed {
            background: #00ff88;
        }
        .checklist {
            background: rgba(0, 0, 0, 0.3);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 30px;
        }
        .checklist-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .checklist-item:last-child {
            border-bottom: none;
        }
        .check-icon {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
        }
        .check-icon.done {
            background: #00ff88;
            color: #1a1a2e;
        }
        .check-icon.pending {
            background: rgba(255, 255, 255, 0.2);
            color: #666;
        }
        .airport-preview {
            margin-top: 20px;
            padding: 20px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 12px;
            display: none;
        }
        .airport-preview.show {
            display: block;
        }
        .airport-preview h4 {
            color: #00d9ff;
            margin-bottom: 10px;
        }
        .metar-display {
            font-family: monospace;
            background: #000;
            padding: 15px;
            border-radius: 8px;
            font-size: 0.9rem;
            word-break: break-all;
        }
        .flight-rules {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-weight: bold;
            font-size: 0.85rem;
            margin-top: 10px;
        }
        .flight-rules.VFR { background: #00ff88; color: #000; }
        .flight-rules.MVFR { background: #00d9ff; color: #000; }
        .flight-rules.IFR { background: #ff4444; color: #fff; }
        .flight-rules.LIFR { background: #ff00ff; color: #fff; }
        .success-container {
            text-align: center;
            padding: 40px 20px;
        }
        .success-icon {
            font-size: 5rem;
            margin-bottom: 25px;
        }
        .success-container h2 {
            color: #00ff88;
            margin-bottom: 15px;
            font-size: 2rem;
        }
        .success-container p {
            color: #aaa;
            margin-bottom: 30px;
            line-height: 1.6;
        }
        .hint {
            color: #888;
            font-size: 0.9rem;
            margin-top: 8px;
        }
        a {
            color: #00d9ff;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .suggestions-dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: #1a1a2e;
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 10px;
            margin-top: 5px;
            max-height: 250px;
            overflow-y: auto;
            z-index: 100;
            display: none;
        }
        .suggestions-dropdown.show {
            display: block;
        }
        .suggestion-item {
            padding: 12px 16px;
            cursor: pointer;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            transition: background 0.2s;
        }
        .suggestion-item:last-child {
            border-bottom: none;
        }
        .suggestion-item:hover {
            background: rgba(0,217,255,0.2);
        }
        .suggestion-icao {
            font-weight: bold;
            color: #00d9ff;
            font-family: monospace;
        }
        .suggestion-name {
            font-size: 0.9rem;
            color: #ccc;
        }
        .suggestion-city {
            font-size: 0.8rem;
            color: #888;
        }
        .location-card {
            background: rgba(0,0,0,0.3);
            border-radius: 15px;
            padding: 25px;
            text-align: center;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <h1>SkyGlass</h1>
    <p class="subtitle">Setup Wizard</p>

    <div class="progress-bar">
        <div class="progress-dot active" id="dot-1"></div>
        <div class="progress-dot" id="dot-2"></div>
        <div class="progress-dot" id="dot-3"></div>
        <div class="progress-dot" id="dot-4"></div>
    </div>

    <div class="container">
        <!-- Step 1: Welcome -->
        <div class="step active" id="step-1">
            <div class="step-header">
                <div class="step-number">1</div>
                <div class="step-title">Welcome</div>
            </div>
            <p class="step-description">
                Welcome to SkyGlass for Pilots! This wizard will help you configure your
                smart mirror with aviation data, weather, and presence detection.
            </p>

            <div class="checklist">
                <div class="checklist-item">
                    <div class="check-icon" id="check-config">&#10007;</div>
                    <span>Configure your airport</span>
                </div>
                <div class="checklist-item">
                    <div class="check-icon" id="check-location">&#10007;</div>
                    <span>Set your location</span>
                </div>
                <div class="checklist-item">
                    <div class="check-icon" id="check-face">&#10007;</div>
                    <span>Enroll your face</span>
                </div>
            </div>

            <div class="button-row">
                <button class="btn-primary" onclick="nextStep()">Get Started</button>
            </div>
        </div>

        <!-- Step 2: Airport Configuration -->
        <div class="step" id="step-2">
            <div class="step-header">
                <div class="step-number">2</div>
                <div class="step-title">Airport Configuration</div>
            </div>
            <p class="step-description">
                Enter your home airport's ICAO code. This will be used to display METAR,
                TAF, NOTAMs, and nearby TFRs.
            </p>

            <div class="form-group" style="position: relative;">
                <label for="airport">Home Airport (ICAO Code)</label>
                <input type="text" id="airport" placeholder="Search by city or airport code..."
                       autocomplete="off" style="text-transform: uppercase;">
                <div id="airport-suggestions" class="suggestions-dropdown"></div>
                <p class="hint">Type to search (e.g., "JFK", "Los Angeles", "Teterboro")</p>
            </div>

            <div class="airport-preview" id="airport-preview">
                <h4 id="airport-name">Current Weather</h4>
                <div class="metar-display" id="metar-display">Loading...</div>
                <span class="flight-rules" id="flight-rules"></span>
            </div>

            <div class="button-row">
                <button class="btn-secondary" onclick="prevStep()">Back</button>
                <button class="btn-primary" onclick="validateAirport()">Next</button>
            </div>
        </div>

        <!-- Step 3: Location -->
        <div class="step" id="step-3">
            <div class="step-header">
                <div class="step-number">3</div>
                <div class="step-title">Location</div>
            </div>
            <p class="step-description">
                Your location is used for accurate sunrise/sunset times and to show nearby TFRs.
            </p>

            <!-- Location detection prompt -->
            <div id="location-prompt" class="location-card">
                <div style="font-size: 3rem; margin-bottom: 15px;">📍</div>
                <h3 style="margin-bottom: 10px;">Detect Your Location</h3>
                <p style="color: #888; margin-bottom: 20px;">
                    We'll use your phone's location to set up the mirror.
                    This stays on your device.
                </p>
                <button class="btn-primary" onclick="requestLocation()" style="width: 100%;">
                    Allow Location Access
                </button>
                <button class="btn-secondary" onclick="showManualLocation()" style="width: 100%; margin-top: 10px;">
                    Enter Manually Instead
                </button>
            </div>

            <!-- Location detected -->
            <div id="location-detected" class="location-card" style="display: none;">
                <div style="font-size: 3rem; margin-bottom: 15px;">✅</div>
                <h3 style="margin-bottom: 10px;">Location Found</h3>
                <div style="background: rgba(0,0,0,0.3); border-radius: 10px; padding: 15px; margin-bottom: 15px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="color: #888;">Latitude</span>
                        <span id="detected-lat" style="font-family: monospace;">--</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #888;">Longitude</span>
                        <span id="detected-lng" style="font-family: monospace;">--</span>
                    </div>
                </div>
                <div class="form-group">
                    <label for="timezone">Timezone</label>
                    <select id="timezone">
                        <option value="America/New_York">Eastern Time (ET)</option>
                        <option value="America/Chicago">Central Time (CT)</option>
                        <option value="America/Denver">Mountain Time (MT)</option>
                        <option value="America/Los_Angeles">Pacific Time (PT)</option>
                        <option value="America/Anchorage">Alaska Time (AKT)</option>
                        <option value="Pacific/Honolulu">Hawaii Time (HT)</option>
                        <option value="Europe/London">GMT/UTC</option>
                        <option value="Europe/Paris">Central European (CET)</option>
                    </select>
                </div>
            </div>

            <!-- Manual location entry -->
            <div id="location-manual" class="location-card" style="display: none;">
                <h3 style="margin-bottom: 15px;">Enter Location</h3>
                <div class="form-group">
                    <label>Coordinates</label>
                    <div class="location-row">
                        <div>
                            <input type="number" id="latitude" placeholder="Latitude" step="0.0001">
                        </div>
                        <div>
                            <input type="number" id="longitude" placeholder="Longitude" step="0.0001">
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label for="timezone-manual">Timezone</label>
                    <select id="timezone-manual">
                        <option value="America/New_York">Eastern Time (ET)</option>
                        <option value="America/Chicago">Central Time (CT)</option>
                        <option value="America/Denver">Mountain Time (MT)</option>
                        <option value="America/Los_Angeles">Pacific Time (PT)</option>
                        <option value="America/Anchorage">Alaska Time (AKT)</option>
                        <option value="Pacific/Honolulu">Hawaii Time (HT)</option>
                        <option value="Europe/London">GMT/UTC</option>
                        <option value="Europe/Paris">Central European (CET)</option>
                    </select>
                </div>
                <a href="#" onclick="showLocationPrompt(); return false;" style="font-size: 0.9rem;">
                    ← Try auto-detect instead
                </a>
            </div>

            <div class="button-row">
                <button class="btn-secondary" onclick="prevStep()">Back</button>
                <button class="btn-primary" onclick="saveConfig()">Save & Continue</button>
            </div>
        </div>

        <!-- Step 4: Face Enrollment -->
        <div class="step" id="step-4">
            <div class="step-header">
                <div class="step-number">4</div>
                <div class="step-title">Face Registration</div>
            </div>

            <!-- Not started state -->
            <div id="face-not-started">
                <p class="step-description">
                    Register your face so the mirror activates when you approach.
                    The camera will capture 5 photos of your face.
                </p>

                <div class="location-card">
                    <div style="font-size: 3rem; margin-bottom: 15px;">👤</div>
                    <h3 style="margin-bottom: 10px;">Ready to Register</h3>
                    <ol style="text-align: left; color: #888; margin: 20px 0; padding-left: 20px;">
                        <li style="margin-bottom: 10px;">Stand in front of the mirror</li>
                        <li style="margin-bottom: 10px;">Make sure your face is well-lit</li>
                        <li style="margin-bottom: 10px;">Look at the mirror's camera</li>
                        <li>Follow the on-screen prompts</li>
                    </ol>
                    <button class="btn-primary" onclick="startEnrollment()" style="width: 100%;">
                        Start Face Registration
                    </button>
                </div>

                <div style="text-align: center; margin-top: 15px;">
                    <a href="#" onclick="skipEnrollment(); return false;" style="font-size: 0.9rem;">
                        Skip for now (use motion detection only)
                    </a>
                </div>
            </div>

            <!-- In progress state -->
            <div id="face-in-progress" style="display: none;">
                <div class="location-card">
                    <div class="spinner" style="margin: 0 auto 20px;"></div>
                    <h3 style="margin-bottom: 10px;">Registration in Progress</h3>
                    <p style="color: #888; margin-bottom: 15px;">
                        Look at the mirror and follow the prompts on screen
                    </p>
                    <div style="background: rgba(0,0,0,0.3); border-radius: 10px; padding: 15px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span style="color: #888;">Photos captured</span>
                            <span id="capture-count" style="color: #00d9ff; font-weight: bold;">0 / 5</span>
                        </div>
                        <div style="background: rgba(255,255,255,0.1); border-radius: 5px; height: 8px; overflow: hidden;">
                            <div id="capture-progress" style="background: linear-gradient(90deg, #00d9ff, #00ff88); height: 100%; width: 0%; transition: width 0.3s;"></div>
                        </div>
                    </div>
                </div>
                <button class="btn-secondary" onclick="cancelEnrollment()" style="width: 100%; margin-top: 15px;">
                    Cancel
                </button>
            </div>

            <!-- Complete state -->
            <div id="face-complete" style="display: none;">
                <div class="location-card">
                    <div style="font-size: 3rem; margin-bottom: 15px;">✅</div>
                    <h3 style="margin-bottom: 10px; color: #00ff88;">Face Registered!</h3>
                    <p style="color: #888;">
                        Your mirror will now activate when it recognizes you.
                    </p>
                </div>
            </div>

            <div class="button-row">
                <button class="btn-secondary" onclick="prevStep()">Back</button>
                <button class="btn-primary" id="face-next-btn" onclick="finishSetup()">Finish Setup</button>
            </div>
        </div>

        <!-- Step 5: Complete -->
        <div class="step" id="step-5">
            <div class="success-container">
                <div class="success-icon">&#10004;</div>
                <h2>Setup Complete!</h2>
                <p>
                    Your SkyGlass is configured and ready to use.<br>
                    The mirror will display aviation data for <strong id="final-airport">KJFK</strong>.
                </p>
                <button class="btn-primary" onclick="window.location.href='/'">
                    Launch SkyGlass
                </button>
            </div>
        </div>
    </div>

    <script>
        let currentStep = 1;
        let config = { airport: 'KJFK', location: {} };
        let setupStatus = {};

        // Load initial status
        async function loadStatus() {
            try {
                const response = await fetch('/api/setup/status');
                setupStatus = await response.json();

                // Update checklist
                updateChecklist();

                // Load config
                const configResponse = await fetch('/api/setup/config');
                config = await configResponse.json();

                document.getElementById('airport').value = config.airport || '';
                document.getElementById('latitude').value = config.location?.latitude || '';
                document.getElementById('longitude').value = config.location?.longitude || '';
                document.getElementById('timezone').value = config.location?.timezone || 'America/New_York';

            } catch (err) {
                console.error('Failed to load status:', err);
            }
        }

        function updateChecklist() {
            const checkConfig = document.getElementById('check-config');
            const checkLocation = document.getElementById('check-location');
            const checkFace = document.getElementById('check-face');

            checkConfig.className = 'check-icon ' + (setupStatus.airportConfigured ? 'done' : 'pending');
            checkConfig.innerHTML = setupStatus.airportConfigured ? '&#10004;' : '&#10007;';

            checkLocation.className = 'check-icon ' + (setupStatus.locationConfigured ? 'done' : 'pending');
            checkLocation.innerHTML = setupStatus.locationConfigured ? '&#10004;' : '&#10007;';

            checkFace.className = 'check-icon ' + (setupStatus.faceEnrolled ? 'done' : 'pending');
            checkFace.innerHTML = setupStatus.faceEnrolled ? '&#10004;' : '&#10007;';

            // Face status in step 4
            const faceStatus = document.getElementById('face-status');
            const faceStatusText = document.getElementById('face-status-text');
            if (setupStatus.faceEnrolled) {
                faceStatus.className = 'check-icon done';
                faceStatus.innerHTML = '&#10004;';
                faceStatusText.textContent = 'Face enrolled successfully';
            }
        }

        function showStep(step) {
            document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
            document.getElementById('step-' + step).classList.add('active');

            document.querySelectorAll('.progress-dot').forEach((d, i) => {
                d.classList.remove('active', 'completed');
                if (i + 1 < step) d.classList.add('completed');
                if (i + 1 === step) d.classList.add('active');
            });
        }

        function nextStep() {
            currentStep++;
            showStep(currentStep);
        }

        function prevStep() {
            currentStep--;
            showStep(currentStep);
        }

        async function validateAirport() {
            const airport = document.getElementById('airport').value.toUpperCase().trim();
            if (airport.length !== 4) {
                alert('Please enter a valid 4-letter ICAO code');
                return;
            }

            const preview = document.getElementById('airport-preview');
            const metarDisplay = document.getElementById('metar-display');
            const flightRules = document.getElementById('flight-rules');

            preview.classList.add('show');
            metarDisplay.textContent = 'Validating airport...';
            flightRules.style.display = 'none';

            try {
                const response = await fetch('/api/aviation/metar/' + airport);
                const data = await response.json();

                if (data.raw) {
                    metarDisplay.textContent = data.raw;
                    flightRules.textContent = data.flightRules;
                    flightRules.className = 'flight-rules ' + data.flightRules;
                    flightRules.style.display = 'inline-block';
                    config.airport = airport;
                    // Move to next step after brief delay to show weather
                    setTimeout(nextStep, 500);
                } else {
                    metarDisplay.textContent = 'No data for ' + airport + ' - but you can still use it';
                    config.airport = airport;
                    // Allow proceeding even without METAR
                    setTimeout(nextStep, 1500);
                }
            } catch (err) {
                metarDisplay.textContent = 'Could not verify airport, but proceeding anyway';
                config.airport = airport;
                setTimeout(nextStep, 1500);
            }
        }

        // Airport autocomplete
        let searchTimeout;
        const airportInput = document.getElementById('airport');
        const suggestionsDropdown = document.getElementById('airport-suggestions');

        airportInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearTimeout(searchTimeout);

            if (query.length < 2) {
                suggestionsDropdown.classList.remove('show');
                return;
            }

            searchTimeout = setTimeout(async () => {
                try {
                    const response = await fetch('/api/setup/airports?q=' + encodeURIComponent(query));
                    const airports = await response.json();

                    if (airports.length === 0) {
                        suggestionsDropdown.classList.remove('show');
                        return;
                    }

                    suggestionsDropdown.innerHTML = airports.map(a =>
                        '<div class="suggestion-item" onclick="selectAirport(\\''+a.icao+'\\', \\''+a.name.replace(/'/g, "\\'")+'\\')">' +
                            '<div class="suggestion-icao">' + a.icao + '</div>' +
                            '<div class="suggestion-name">' + a.name + '</div>' +
                            '<div class="suggestion-city">' + a.city + '</div>' +
                        '</div>'
                    ).join('');
                    suggestionsDropdown.classList.add('show');
                } catch (err) {
                    console.error('Airport search error:', err);
                }
            }, 200);
        });

        // Close suggestions when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.form-group')) {
                suggestionsDropdown.classList.remove('show');
            }
        });

        function selectAirport(icao, name) {
            airportInput.value = icao;
            config.airport = icao;
            document.getElementById('airport-name').textContent = name;
            suggestionsDropdown.classList.remove('show');
            // Show preview
            validateAirportPreview();
        }

        async function validateAirportPreview() {
            const airport = document.getElementById('airport').value.toUpperCase().trim();
            if (airport.length !== 4) return;

            const preview = document.getElementById('airport-preview');
            const metarDisplay = document.getElementById('metar-display');
            const flightRules = document.getElementById('flight-rules');

            preview.classList.add('show');
            metarDisplay.textContent = 'Fetching weather...';
            flightRules.style.display = 'none';

            try {
                const response = await fetch('/api/aviation/metar/' + airport);
                const data = await response.json();

                if (data.raw) {
                    metarDisplay.textContent = data.raw;
                    flightRules.textContent = data.flightRules;
                    flightRules.className = 'flight-rules ' + data.flightRules;
                    flightRules.style.display = 'inline-block';
                } else {
                    metarDisplay.textContent = 'No data available';
                }
            } catch (err) {
                metarDisplay.textContent = 'Could not fetch weather';
            }
        }

        // Location detection functions
        function showLocationPrompt() {
            document.getElementById('location-prompt').style.display = 'block';
            document.getElementById('location-detected').style.display = 'none';
            document.getElementById('location-manual').style.display = 'none';
        }

        function showManualLocation() {
            document.getElementById('location-prompt').style.display = 'none';
            document.getElementById('location-detected').style.display = 'none';
            document.getElementById('location-manual').style.display = 'block';
        }

        function requestLocation() {
            if (!('geolocation' in navigator)) {
                alert('Geolocation is not supported by your browser');
                showManualLocation();
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude.toFixed(4);
                    const lng = position.coords.longitude.toFixed(4);

                    // Update detected display
                    document.getElementById('detected-lat').textContent = lat;
                    document.getElementById('detected-lng').textContent = lng;

                    // Store in config
                    config.location = config.location || {};
                    config.location.latitude = parseFloat(lat);
                    config.location.longitude = parseFloat(lng);

                    // Auto-detect timezone based on longitude (rough estimate)
                    const timezone = guessTimezone(parseFloat(lng));
                    document.getElementById('timezone').value = timezone;
                    config.location.timezone = timezone;

                    // Show detected view
                    document.getElementById('location-prompt').style.display = 'none';
                    document.getElementById('location-detected').style.display = 'block';
                    document.getElementById('location-manual').style.display = 'none';
                },
                (error) => {
                    alert('Could not detect location: ' + error.message);
                    showManualLocation();
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        }

        function guessTimezone(longitude) {
            // Rough timezone estimation based on longitude
            if (longitude >= -67.5 && longitude < -52.5) return 'America/New_York'; // Atlantic
            if (longitude >= -82.5 && longitude < -67.5) return 'America/New_York'; // Eastern
            if (longitude >= -97.5 && longitude < -82.5) return 'America/Chicago';   // Central
            if (longitude >= -112.5 && longitude < -97.5) return 'America/Denver';   // Mountain
            if (longitude >= -127.5 && longitude < -112.5) return 'America/Los_Angeles'; // Pacific
            if (longitude >= -157.5 && longitude < -127.5) return 'America/Anchorage'; // Alaska
            if (longitude >= -180 && longitude < -157.5) return 'Pacific/Honolulu';  // Hawaii
            if (longitude >= -7.5 && longitude < 7.5) return 'Europe/London';        // GMT
            if (longitude >= 7.5 && longitude < 22.5) return 'Europe/Paris';         // CET
            return 'America/New_York'; // Default
        }

        // Legacy function kept for compatibility
        function detectLocation() {
            requestLocation();
        }

        async function saveConfig() {
            // Check if using auto-detected or manual location
            const isAutoDetected = document.getElementById('location-detected').style.display !== 'none';

            let latitude, longitude, timezone;

            if (isAutoDetected) {
                // Use stored config from auto-detection
                latitude = config.location?.latitude;
                longitude = config.location?.longitude;
                timezone = document.getElementById('timezone').value;
            } else {
                // Use manual entry
                latitude = parseFloat(document.getElementById('latitude').value);
                longitude = parseFloat(document.getElementById('longitude').value);
                timezone = document.getElementById('timezone-manual').value;
            }

            if (isNaN(latitude) || isNaN(longitude)) {
                alert('Please provide your location');
                return;
            }

            config.location = { latitude, longitude, timezone };

            try {
                const response = await fetch('/api/setup/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });

                if (response.ok) {
                    nextStep();
                } else {
                    alert('Failed to save configuration');
                }
            } catch (err) {
                alert('Failed to save configuration');
            }
        }

        let enrollmentInterval;

        async function startEnrollment() {
            // Show in-progress state
            document.getElementById('face-not-started').style.display = 'none';
            document.getElementById('face-in-progress').style.display = 'block';
            document.getElementById('face-complete').style.display = 'none';

            // Trigger registration mode via backend
            try {
                await fetch('/api/registration/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });

                // Poll for progress and completion
                enrollmentInterval = setInterval(checkEnrollmentProgress, 1000);

                // Timeout after 5 minutes
                setTimeout(() => {
                    if (enrollmentInterval) {
                        clearInterval(enrollmentInterval);
                        cancelEnrollment();
                    }
                }, 300000);
            } catch (err) {
                alert('Could not start face registration. Make sure the mirror is running.');
                document.getElementById('face-not-started').style.display = 'block';
                document.getElementById('face-in-progress').style.display = 'none';
            }
        }

        async function checkEnrollmentProgress() {
            try {
                const response = await fetch('/api/registration');
                const status = await response.json();

                // Update progress
                const collected = status.samplesCollected || 0;
                const needed = status.samplesNeeded || 5;
                document.getElementById('capture-count').textContent = collected + ' / ' + needed;
                document.getElementById('capture-progress').style.width = (collected / needed * 100) + '%';

                // Check if complete
                if (!status.active && collected >= needed) {
                    clearInterval(enrollmentInterval);
                    enrollmentInterval = null;
                    showEnrollmentComplete();
                } else if (!status.active && collected < needed) {
                    // Cancelled or failed
                    clearInterval(enrollmentInterval);
                    enrollmentInterval = null;
                    document.getElementById('face-not-started').style.display = 'block';
                    document.getElementById('face-in-progress').style.display = 'none';
                }

                // Also check setup status
                const setupResponse = await fetch('/api/setup/status');
                setupStatus = await setupResponse.json();
                if (setupStatus.faceEnrolled) {
                    clearInterval(enrollmentInterval);
                    enrollmentInterval = null;
                    showEnrollmentComplete();
                }
            } catch (err) {
                console.error('Error checking enrollment:', err);
            }
        }

        function showEnrollmentComplete() {
            document.getElementById('face-not-started').style.display = 'none';
            document.getElementById('face-in-progress').style.display = 'none';
            document.getElementById('face-complete').style.display = 'block';
            updateChecklist();
        }

        async function cancelEnrollment() {
            if (enrollmentInterval) {
                clearInterval(enrollmentInterval);
                enrollmentInterval = null;
            }

            try {
                await fetch('/api/registration/cancel', { method: 'POST' });
            } catch (err) {
                // Ignore
            }

            document.getElementById('face-not-started').style.display = 'block';
            document.getElementById('face-in-progress').style.display = 'none';
            document.getElementById('face-complete').style.display = 'none';
        }

        function skipEnrollment() {
            if (confirm('Without face registration, the mirror will use motion detection only. Continue?')) {
                finishSetup();
            }
        }

        function finishSetup() {
            document.getElementById('final-airport').textContent = config.airport;
            currentStep = 5;
            showStep(5);
        }

        // Initialize
        loadStatus();
    </script>
</body>
</html>`;

export default router;
