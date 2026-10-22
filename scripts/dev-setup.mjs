#!/usr/bin/env node
/**
 * SkyGlass local setup tool
 *
 * Drives the first-run setup pipeline on a development machine so the whole
 * flow (setup screen -> orientation -> location -> airport -> face -> live mirror -> presence
 * wake/sleep) can be exercised without a Raspberry Pi, a phone, or a camera.
 *
 * Every step goes through the same backend endpoints the mobile app uses when
 * the backend is running, and falls back to writing the same files the
 * backend reads when it is not. The mirror UI on :5173 polls setup status every
 * two seconds, so you can watch it advance while you run these commands.
 *
 *   npm run setup:dev -- status
 *   npm run setup:dev -- walkthrough
 *   npm run setup:dev -- complete
 *   npm run setup:dev -- reset --yes
 *
 * Run with --help for the full command list.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import YAML from 'yaml';

// ---------------------------------------------------------------------------
// Paths and endpoints
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_DIR = path.join(ROOT, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');
const DEFAULT_CONFIG = path.join(CONFIG_DIR, 'default.yaml');
const PRESENCE_DIR = path.join(ROOT, 'packages', 'presence');
const FACE_DATA_DIR = path.join(PRESENCE_DIR, 'face_data');
const USERS_DIR = path.join(FACE_DATA_DIR, 'users');
const WIFI_FLAG = path.join(FACE_DATA_DIR, '.wifi_configured');
const VENV_DIR = path.join(PRESENCE_DIR, 'venv');
const VENV_PYTHON = path.join(VENV_DIR, 'bin', 'python');

const BACKEND_URL = process.env.SKYGLASS_BACKEND_URL || 'http://localhost:3001';
const ADMIN_URL = process.env.SKYGLASS_ADMIN_URL || 'http://localhost:5000';
const FRONTEND_URL = process.env.SKYGLASS_FRONTEND_URL || 'http://localhost:5173';

// Sample values for complete/walkthrough. Any value counts once it is saved:
// the backend records each step in config.yaml's setup.completed.
const DEFAULTS = {
  airport: 'KSFO',
  latitude: 37.6213,
  longitude: -122.379,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
  userName: 'Dev Pilot',
  userId: 'dev-pilot',
  samples: 5,
};

// pickle.dumps([], protocol=2): a valid, empty encodings list. detector.py
// unpickles this without error and simply has no faces to match.
const EMPTY_PICKLE = Buffer.from([0x80, 0x02, 0x5d, 0x71, 0x00, 0x2e]);

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

const useColor = stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = {
  green: paint('32'),
  red: paint('31'),
  yellow: paint('33'),
  blue: paint('34'),
  dim: paint('2'),
  bold: paint('1'),
};
const OK = c.green('✓');
const NO = c.red('✗');

const info = (msg) => console.log(`${c.blue('›')} ${msg}`);
const done = (msg) => console.log(`${OK} ${msg}`);
const warn = (msg) => console.log(`${c.yellow('!')} ${msg}`);
const fail = (msg) => console.error(`${NO} ${msg}`);

class UsageError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Argument parsing: `cmd positional... --flag value --bool`
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  const [cmd = 'help', ...rest] = positional;
  return { cmd, positional: rest, flags };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

// The backend trusts callers on the same machine (loopback). Pointed at a
// mirror elsewhere (SKYGLASS_BACKEND_URL), pass a paired device token:
// SKYGLASS_TOKEN=sgp_... (see docs/LOCAL_DEVELOPMENT.md, "Pairing").
const BACKEND_TOKEN = process.env.SKYGLASS_TOKEN || '';
let warnedPairing = false;

async function request(method, url, body, timeoutMs = 4000) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (BACKEND_TOKEN && url.startsWith(BACKEND_URL)) headers.Authorization = `Bearer ${BACKEND_TOKEN}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON response (e.g. HTML from a wrong port)
  }
  if (res.status === 401 && data?.error === 'pairing_required' && !warnedPairing) {
    warnedPairing = true;
    console.error(
      `! ${BACKEND_URL} refused the request: not a local caller and no valid SKYGLASS_TOKEN. ` +
        'Run this on the mirror itself, or pair first (docs/LOCAL_DEVELOPMENT.md, "Pairing").'
    );
  }
  return { ok: res.ok, status: res.status, data };
}

const getJson = (url, timeoutMs) => request('GET', url, undefined, timeoutMs);
const postJson = (url, body, timeoutMs) => request('POST', url, body ?? {}, timeoutMs);
const del = (url) => request('DELETE', url);

async function probe(url, timeoutMs = 1500) {
  try {
    const r = await getJson(url, timeoutMs);
    return r.ok ? r.data : null;
  } catch {
    return null;
  }
}

async function backendUp() {
  return (await probe(`${BACKEND_URL}/api/health`)) !== null;
}

async function adminStatus() {
  return probe(`${ADMIN_URL}/api/status`);
}

async function frontendUp() {
  try {
    const res = await fetch(FRONTEND_URL, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function requireBackend(up, what) {
  if (!up) {
    throw new Error(
      `${what} needs the backend at ${BACKEND_URL}. Start it with "npm run dev" (or "npm run dev:mirror").`
    );
  }
}

// ---------------------------------------------------------------------------
// File-level state (what the backend's /api/setup/status derives from)
// ---------------------------------------------------------------------------

function readConfigDoc() {
  const file = fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : DEFAULT_CONFIG;
  return YAML.parse(fs.readFileSync(file, 'utf8')) ?? {};
}

function writeConfigDoc(doc) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, YAML.stringify(doc), 'utf8');
}

function enrolledUsers() {
  try {
    return fs
      .readdirSync(USERS_DIR, { withFileTypes: true })
      .filter(
        (e) => e.isDirectory() && fs.existsSync(path.join(USERS_DIR, e.name, 'encodings.pkl'))
      )
      .map((e) => {
        let meta = {};
        try {
          meta = JSON.parse(fs.readFileSync(path.join(USERS_DIR, e.name, 'metadata.json'), 'utf8'));
        } catch {
          // no metadata
        }
        return { id: e.name, name: meta.name || e.name, simulated: Boolean(meta.simulated) };
      });
  } catch {
    return [];
  }
}

const ORIENTATIONS = ['landscape', 'portrait-cw', 'portrait-ccw'];

/** Same reading as the backend's normalizeOrientation (legacy "portrait" = portrait-cw). */
function normalizeOrientation(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v === 'portrait') return 'portrait-cw';
  return ORIENTATIONS.includes(v) ? v : 'landscape';
}

/** Same marker the backend's setup routes write (see routes/setup.ts). */
function markCompleted(doc, step) {
  const completed = Array.isArray(doc.setup?.completed) ? doc.setup.completed : [];
  if (!completed.includes(step)) completed.push(step);
  doc.setup = { ...(doc.setup || {}), completed };
}

function localState() {
  const configExists = fs.existsSync(CONFIG_FILE);
  const doc = readConfigDoc();
  const airport = typeof doc.airport === 'string' ? doc.airport.toUpperCase() : null;
  const loc = doc.location || {};
  const users = enrolledUsers();
  const wifi = fs.existsSync(WIFI_FLAG);
  // Mirrors the backend: a step counts only once setup.completed records it.
  const completed = Array.isArray(doc.setup?.completed) ? doc.setup.completed : [];
  // Orientation also counts whenever config.yaml exists (mirrors set up before the step).
  const orientationConfigured = configExists || completed.includes('orientation');
  const orientation = normalizeOrientation(doc.display?.orientation);
  const airportConfigured = completed.includes('airport');
  const locationConfigured = completed.includes('location');
  const faceEnrolled = users.length > 0;
  return {
    configExists,
    orientation,
    orientationConfigured,
    airport,
    airportConfigured,
    location: loc,
    locationConfigured,
    wifi,
    users,
    faceEnrolled,
    // Mirrors packages/backend/src/routes/setup.ts: the display leaves the
    // setup screen once config.yaml exists and a face is enrolled.
    setupComplete: configExists && faceEnrolled,
  };
}

// ---------------------------------------------------------------------------
// Python environment checks
// ---------------------------------------------------------------------------

function pythonEnv() {
  if (!fs.existsSync(VENV_PYTHON)) {
    return { venv: false, modules: {} };
  }
  const mods = [
    'cv2',
    'flask',
    'requests',
    'yaml',
    'qrcode',
    'face_recognition',
  ];
  const script = `
import importlib, json
out = {}
for m in ${JSON.stringify(mods)}:
    try:
        importlib.import_module(m); out[m] = True
    except Exception:
        out[m] = False
print(json.dumps(out))
`;
  const r = spawnSync(VENV_PYTHON, ['-c', script], { encoding: 'utf8', timeout: 60000 });
  let modules = {};
  try {
    modules = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    // leave empty
  }
  return { venv: true, modules };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdStatus() {
  const [bUp, admin, fUp] = await Promise.all([backendUp(), adminStatus(), frontendUp()]);
  const s = localState();

  console.log(c.bold('\nServices'));
  console.log(
    `  backend    ${BACKEND_URL.padEnd(24)} ${bUp ? OK + ' up' : NO + ' down  → npm run dev'}`
  );
  if (admin) {
    const bits = [
      admin.camera_ready ? 'camera ready' : c.yellow('camera not ready'),
      admin.face_recognition_available ? 'face_recognition' : c.dim('no face_recognition'),
      admin.registration_active ? c.yellow('registration in progress') : null,
    ].filter(Boolean);
    console.log(`  admin      ${ADMIN_URL.padEnd(24)} ${OK} up  ${c.dim(bits.join(', '))}`);
  } else {
    console.log(
      `  admin      ${ADMIN_URL.padEnd(24)} ${NO} down  → npm run dev:admin ${c.dim('(only needed for camera enrollment)')}`
    );
  }
  console.log(
    `  frontend   ${FRONTEND_URL.padEnd(24)} ${fUp ? OK + ' up' : NO + ' down  → npm run dev'}`
  );

  // The license lives in the backend's SQLite DB, so it is only known while
  // the backend is up. The npm run dev* scripts start it with SKYGLASS_LICENSE=off.
  const [license, remote] = bUp
    ? await Promise.all([
        probe(`${BACKEND_URL}/api/license/status`),
        probe(`${BACKEND_URL}/api/setup/status`),
      ])
    : [null, null];
  const licenseActivated = remote ? Boolean(remote.licenseActivated) : null;
  const setupComplete = s.setupComplete && licenseActivated !== false;

  console.log(c.bold('\nSetup steps') + c.dim('  (what the mirror and the phone see)'));
  console.log(
    `  1 wifi      ${s.wifi ? OK + ' flag present' : NO + ' no flag       → setup:dev wifi'}`
  );
  console.log(
    `  2 orient.   ${
      s.orientationConfigured
        ? `${OK} ${s.orientation}`
        : `${NO} not chosen        → setup:dev orientation [landscape|portrait-cw|portrait-ccw]`
    }`
  );
  let licenseLine;
  if (!license) licenseLine = c.dim('unknown (backend down)');
  else if (license.state === 'disabled') licenseLine = `${OK} licensing disabled (SKYGLASS_LICENSE=off)`;
  else if (licenseActivated)
    licenseLine = `${license.state === 'active' ? OK : NO} ${license.state} …${license.keyLast4 || ''}`;
  else
    licenseLine = `${NO} ${license.state}   → enter a key in the app, or restart with SKYGLASS_LICENSE=off`;
  console.log(`  3 license   ${licenseLine}`);
  console.log(
    `  4 location  ${
      s.locationConfigured
        ? `${OK} ${s.location.latitude}, ${s.location.longitude} ${s.location.timezone || ''}`
        : `${NO} default coords   → setup:dev location LAT LON`
    }`
  );
  console.log(
    `  5 airport   ${
      s.airportConfigured
        ? `${OK} ${s.airport}`
        : `${NO} ${s.airport || 'unset'} (not chosen)  → setup:dev airport KXXX`
    }`
  );
  const faceBits = [];
  if (s.users.length)
    faceBits.push(
      `users: ${s.users.map((u) => u.name + (u.simulated ? ' (simulated)' : '')).join(', ')}`
    );
  console.log(
    `  6 face      ${s.faceEnrolled ? OK + ' ' + faceBits.join('; ') : NO + ' not enrolled   → setup:dev face'}`
  );
  console.log(
    `    config    ${s.configExists ? OK + ' config/config.yaml' : NO + ' config/config.yaml missing (written by orientation/location/airport)'}`
  );
  console.log(
    `\n  Mirror shows: ${setupComplete ? c.green('LIVE MIRROR') : c.yellow('SETUP SCREEN')}` +
      c.dim(`  (${FRONTEND_URL})`)
  );

  if (bUp) {
    if (remote && remote.setupComplete !== setupComplete) {
      warn(
        `Backend reports setupComplete=${remote.setupComplete}; files say ${setupComplete}. Is the backend running from this checkout?`
      );
    }
    const users = await probe(`${BACKEND_URL}/api/users`);
    if (Array.isArray(users)) {
      console.log(
        `  DB users:  ${users.length ? users.map((u) => `${u.name} (${u.id})`).join(', ') : c.dim('none')}`
      );
    }
    const presence = await probe(`${BACKEND_URL}/api/presence`);
    if (presence) {
      console.log(
        `  Presence:  ${presence.present ? 'present' : 'absent'}, display ${presence.displayState}`
      );
    }
  }

  const py = pythonEnv();
  console.log(c.bold('\nPython (packages/presence)'));
  if (!py.venv) {
    console.log(`  ${NO} no venv   → setup:dev deps`);
  } else {
    const m = py.modules;
    const line = (name, required) => `${m[name] ? OK : required ? NO : c.dim('-')} ${name}`;
    console.log(
      `  ${line('cv2', true)}  ${line('flask', true)}  ${line('requests', true)}  ${line('yaml', true)}  ${line('qrcode', false)}`
    );
    console.log(
      `  ${line('face_recognition', true)}  ${c.dim('(without face_recognition enrollment stores no encodings and the mirror wakes for any face)')}`
    );
    if (['cv2', 'flask', 'requests', 'yaml', 'face_recognition'].some((k) => !m[k])) {
      console.log(`  → setup:dev deps`);
    }
  }

  console.log(c.bold('\nNext'));
  if (!s.setupComplete) {
    console.log('  Watch the setup screen advance:  npm run setup:dev -- walkthrough');
    console.log('  Or skip straight to the mirror:   npm run setup:dev -- complete');
  } else {
    console.log('  Wake/sleep the mirror:            npm run setup:dev -- presence on | off');
    console.log('  Back to the setup screen:         npm run setup:dev -- reset');
  }
  console.log('');
}

function cmdWifi({ flags }) {
  fs.mkdirSync(FACE_DATA_DIR, { recursive: true });
  if (flags.clear) {
    fs.rmSync(WIFI_FLAG, { force: true });
    done('WiFi flag cleared (phone will show the WiFi step again)');
    return;
  }
  fs.writeFileSync(
    WIFI_FLAG,
    `configured by scripts/dev-setup.mjs at ${new Date().toISOString()}\n`
  );
  done(
    'WiFi marked configured (dev machines have no hotspot; this is what wifi_provisioning.py writes on a Pi)'
  );
}

async function cmdAirport({ positional, flags }) {
  const icao = String(positional[0] || flags.airport || DEFAULTS.airport).toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(icao)) {
    throw new UsageError(`"${icao}" is not an ICAO code (3-4 letters/digits, e.g. KSFO)`);
  }
  if (await backendUp()) {
    const r = await postJson(`${BACKEND_URL}/api/setup/airport`, { icao });
    if (!r.ok)
      throw new Error(`POST /api/setup/airport failed: ${r.status} ${JSON.stringify(r.data)}`);
    done(`Airport set to ${icao} via backend (config/config.yaml written, backend reloaded)`);
  } else {
    const doc = readConfigDoc();
    doc.airport = icao;
    markCompleted(doc, 'airport');
    writeConfigDoc(doc);
    done(
      `Airport set to ${icao} in config/config.yaml (backend not running; it will load this on start)`
    );
  }
}

async function cmdOrientation({ positional, flags }) {
  if (flags.cancel) {
    requireBackend(await backendUp(), 'Cancelling a preview');
    const r = await del(`${BACKEND_URL}/api/setup/orientation/preview`);
    if (!r.ok) throw new Error(`DELETE /api/setup/orientation/preview failed: ${r.status}`);
    done('Orientation preview cleared (mirror back to the saved orientation)');
    return;
  }
  const orientation = normalizeOrientation(positional[0] ?? flags.orientation ?? 'landscape');
  if (positional[0] && !ORIENTATIONS.includes(String(positional[0])) && positional[0] !== 'portrait') {
    throw new UsageError(`"${positional[0]}" is not one of ${ORIENTATIONS.join(', ')}`);
  }
  const preview = Boolean(flags.preview);
  if (await backendUp()) {
    const r = await postJson(`${BACKEND_URL}/api/setup/orientation`, { orientation, preview });
    if (!r.ok)
      throw new Error(`POST /api/setup/orientation failed: ${r.status} ${JSON.stringify(r.data)}`);
    done(
      preview
        ? `Previewing ${orientation}: the mirror shows "This way up?" (clear with --cancel)`
        : `Orientation set to ${orientation} via backend`
    );
  } else if (preview) {
    requireBackend(false, 'A preview');
  } else {
    const doc = readConfigDoc();
    doc.display = { ...(doc.display || {}), orientation };
    markCompleted(doc, 'orientation');
    writeConfigDoc(doc);
    done(`Orientation set to ${orientation} in config/config.yaml (backend not running)`);
  }
}

async function cmdLocation({ positional, flags }) {
  const latitude = Number(positional[0] ?? flags.lat ?? DEFAULTS.latitude);
  const longitude = Number(positional[1] ?? flags.lon ?? DEFAULTS.longitude);
  const timezone = String(positional[2] ?? flags.tz ?? DEFAULTS.timezone);
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90)
    throw new UsageError(`bad latitude: ${positional[0]}`);
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180)
    throw new UsageError(`bad longitude: ${positional[1]}`);
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    throw new UsageError(`unknown IANA timezone: ${timezone}`);
  }
  if (await backendUp()) {
    const r = await postJson(`${BACKEND_URL}/api/setup/location`, {
      latitude,
      longitude,
      timezone,
    });
    if (!r.ok)
      throw new Error(`POST /api/setup/location failed: ${r.status} ${JSON.stringify(r.data)}`);
    done(`Location set to ${latitude}, ${longitude} (${timezone}) via backend`);
  } else {
    const doc = readConfigDoc();
    doc.location = { ...(doc.location || {}), latitude, longitude, timezone };
    writeConfigDoc(doc);
    done(
      `Location set to ${latitude}, ${longitude} (${timezone}) in config/config.yaml (backend not running)`
    );
  }
}

async function enrollSimulated({ userId, userName }) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) {
    throw new UsageError(
      `user id "${userId}" must match [A-Za-z0-9_-]{1,64} (the presence server rejects anything else)`
    );
  }
  const dir = path.join(USERS_DIR, userId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'encodings.pkl'), EMPTY_PICKLE);
  fs.writeFileSync(
    path.join(dir, 'metadata.json'),
    JSON.stringify(
      { name: userName, samples: 0, enrolled_at: new Date().toISOString(), simulated: true },
      null,
      2
    ) + '\n'
  );
  done(
    `Simulated enrollment written: face_data/users/${userId}/ (no real encodings; detection method opencv still wakes the mirror)`
  );

  if (await backendUp()) {
    const r = await postJson(`${BACKEND_URL}/api/users`, { id: userId, name: userName });
    if (r.ok) done(`Backend user created: ${userName} (${userId})`);
    else warn(`Could not create backend user: ${r.status} ${JSON.stringify(r.data)}`);
  } else {
    warn(
      'Backend not running; the DB user record was not created (run "setup:dev face" again later or ignore)'
    );
  }
}

async function enrollWithCamera({ userId, userName, samples }) {
  requireBackend(await backendUp(), 'Camera enrollment');
  const admin = await adminStatus();
  if (!admin) {
    throw new Error(
      `Camera enrollment needs the presence server at ${ADMIN_URL}. Start it with "npm run dev:admin".`
    );
  }
  if (!admin.camera_ready) {
    throw new Error(
      'The presence server reports the camera is not ready. On macOS grant camera access to your terminal (System Settings > Privacy & Security > Camera).'
    );
  }
  if (!admin.face_recognition_available) {
    warn(
      'face_recognition is not installed (run: npm run setup:dev -- deps): the user record is written without encodings, so the mirror cannot recognise this person and will wake for any face.'
    );
  }

  info(`Starting registration for "${userName}" (this is exactly what the phone does)`);
  const start = await postJson(`${BACKEND_URL}/api/registration/start`, {
    userName,
    userId,
  });
  if (!start.ok || !start.data?.active) {
    throw new Error(start.data?.error || `POST /api/registration/start failed: ${start.status}`);
  }
  info(`Mirror (${FRONTEND_URL}) now shows the capture overlay. Look at the camera.`);

  const needed = Number(start.data.samplesNeeded || samples);
  let collected = 0;
  let failures = 0;
  while (collected < needed) {
    const reg = await probe(`${BACKEND_URL}/api/registration`);
    info(
      `Sample ${collected + 1}/${needed}: ${reg?.currentInstruction || 'look at the camera'} (3s countdown)`
    );
    const r = await postJson(`${BACKEND_URL}/api/registration/capture`, {}, 15000);
    if (r.ok && r.data?.success) {
      collected = Number(r.data.samplesCollected ?? collected + 1);
      done(`Captured ${collected}/${needed}`);
      failures = 0;
      if (r.data.complete) break;
      await sleep(1000);
    } else {
      failures++;
      warn(`Capture rejected: ${r.data?.error || r.data?.message || `HTTP ${r.status}`}`);
      if (failures >= 8) {
        await postJson(`${BACKEND_URL}/api/registration/cancel`, { source: 'cli' }).catch(() => {});
        throw new Error(
          'Too many rejected captures; registration cancelled. Center your face, improve lighting, and retry.'
        );
      }
      await sleep(2000);
    }
  }
  done('Registration complete');
}

async function cmdFace({ flags }) {
  const userName = String(flags.name || DEFAULTS.userName);
  const userId = String(
    flags.id ||
      userName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') ||
      DEFAULTS.userId
  );
  if (flags.camera) {
    await enrollWithCamera({ userId, userName, samples: Number(flags.samples || DEFAULTS.samples) });
  } else {
    await enrollSimulated({ userId, userName });
  }
  const s = localState();
  if (s.faceEnrolled) done('Backend will now report faceEnrolled=true');
}

async function cmdComplete(ctx) {
  const { flags } = ctx;
  cmdWifi({ flags: {} });
  await cmdOrientation({ positional: [], flags: { orientation: flags.orientation } });
  await cmdLocation({ positional: [], flags: { lat: flags.lat, lon: flags.lon, tz: flags.tz } });
  await cmdAirport({ positional: [], flags: { airport: flags.airport || DEFAULTS.airport } });
  await cmdFace({ flags });
  const s = localState();
  console.log('');
  if (s.setupComplete) {
    done(`Setup complete. ${FRONTEND_URL} switches to the live mirror within ~2s.`);
    console.log(c.dim('  Wake it:  npm run setup:dev -- presence on'));
  } else {
    fail('Something is still missing:');
    await cmdStatus();
    process.exitCode = 1;
  }
}

async function confirm(question, flags) {
  if (flags.yes) return true;
  if (!stdin.isTTY) {
    throw new UsageError(
      'Refusing to delete without confirmation in a non-interactive shell; pass --yes.'
    );
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function cmdReset({ flags }) {
  const s = localState();
  const targets = [];
  if (!flags['keep-config'] && s.configExists) targets.push('config/config.yaml');
  if (s.wifi) targets.push('face_data/.wifi_configured');
  if (s.users.length)
    targets.push(
      `face_data/users/ (${s.users.length} enrollment${s.users.length === 1 ? '' : 's'})`
    );

  const bUp = await backendUp();
  let dbUsers = [];
  if (bUp && !flags['keep-users']) {
    const list = await probe(`${BACKEND_URL}/api/users`);
    if (Array.isArray(list)) dbUsers = list;
    if (dbUsers.length) targets.push(`backend DB users (${dbUsers.map((u) => u.id).join(', ')})`);
  }
  let pairedPhones = [];
  if (bUp && !flags['keep-phones']) {
    const list = await probe(`${BACKEND_URL}/api/pairing/devices`);
    if (Array.isArray(list?.devices)) pairedPhones = list.devices;
    if (pairedPhones.length)
      targets.push(`paired phones (${pairedPhones.map((d) => d.name || d.id).join(', ')})`);
  }

  if (!targets.length) {
    done('Nothing to reset; the mirror is already on the setup screen.');
    return;
  }
  console.log('This removes:');
  for (const t of targets) console.log(`  - ${t}`);
  if (!(await confirm('Reset local setup state?', flags))) {
    info('Aborted');
    return;
  }

  if (!flags['keep-config']) fs.rmSync(CONFIG_FILE, { force: true });
  fs.rmSync(WIFI_FLAG, { force: true });
  fs.rmSync(USERS_DIR, { recursive: true, force: true });
  for (const u of dbUsers) {
    const r = await del(`${BACKEND_URL}/api/users/${encodeURIComponent(u.id)}`);
    if (!r.ok) warn(`Could not delete DB user ${u.id}: ${r.status}`);
  }
  for (const d of pairedPhones) {
    const r = await del(`${BACKEND_URL}/api/pairing/devices/${encodeURIComponent(d.id)}`);
    if (!r.ok) warn(`Could not unpair phone ${d.id}: ${r.status}`);
  }
  if (bUp) {
    await postJson(`${BACKEND_URL}/api/registration/cancel`, { source: 'cli' }).catch(() => {});
    await postJson(`${BACKEND_URL}/api/presence`, {
      present: false,
      confidence: 0,
      state: 'absent',
    }).catch(() => {});
  }
  done(
    `Reset. Reload ${FRONTEND_URL} to see the setup screen (the live mirror only polls setup status while on it).`
  );
  if (!bUp) {
    warn(
      'Backend was not running: DB users (if any) were left in place. Run "setup:dev reset" again with the backend up to clear them.'
    );
  }
}

async function cmdPresence({ positional, flags }) {
  requireBackend(await backendUp(), 'Presence simulation');
  let want = positional[0];
  if (!['on', 'off', 'toggle'].includes(want)) {
    throw new UsageError('usage: presence on|off|toggle [--user ID] [--name NAME]');
  }
  if (want === 'toggle') {
    const cur = await probe(`${BACKEND_URL}/api/presence`);
    want = cur?.present ? 'off' : 'on';
  }
  const present = want === 'on';
  const body = { present, confidence: present ? 1 : 0, state: present ? 'present' : 'absent' };
  const users = localState().users;
  const userId = flags.user || (present && users[0]?.id) || undefined;
  if (userId) {
    body.userId = String(userId);
    body.userName = String(flags.name || users.find((u) => u.id === userId)?.name || userId);
  }
  const r = await postJson(`${BACKEND_URL}/api/presence`, body);
  if (!r.ok) throw new Error(`POST /api/presence failed: ${r.status} ${JSON.stringify(r.data)}`);
  const state = r.data?.displayState;
  done(
    `Reported ${present ? 'PRESENT' : 'ABSENT'}${body.userName ? ` as ${body.userName}` : ''}; display is ${state}`
  );
  if (!present && state === 'on') {
    info(
      'The display sleeps after display.presence_timeout (config.yaml, default 120s), not immediately.'
    );
  }
}

async function pause(label, flags) {
  if (flags.yes) {
    const secs = Number(flags.delay || 4);
    info(`${label} ${c.dim(`(continuing in ${secs}s)`)}`);
    await sleep(secs * 1000);
    return;
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    await rl.question(`${c.dim('↵')} ${label} ${c.dim('(Enter to continue)')} `);
  } finally {
    rl.close();
  }
}

async function cmdWalkthrough(ctx) {
  const { flags } = ctx;
  if (!stdin.isTTY && !flags.yes) {
    throw new UsageError('walkthrough is interactive; pass --yes to auto-advance.');
  }
  requireBackend(await backendUp(), 'The walkthrough');
  console.log(c.bold('\nSkyGlass setup walkthrough'));
  console.log(
    `Open ${c.bold(FRONTEND_URL)} next to this terminal. Each step changes what it shows.\n`
  );

  if (
    flags.yes ||
    (await confirm('Start from a clean slate (reset current setup state)?', flags))
  ) {
    await cmdReset({ flags: { ...flags, yes: true } });
  } else {
    info('Keeping the current state; steps already done will simply be re-applied.');
  }
  // The npm run dev* scripts start the backend with SKYGLASS_LICENSE=off, so
  // the License step is normally hidden on both the mirror and the phone.
  const license = await probe(`${BACKEND_URL}/api/license/status`);
  const licensingOff = license?.state === 'disabled';
  await pause(
    licensingOff
      ? 'The mirror should show the setup screen at "Location Setup" (licensing is off, so there is no License step).'
      : 'The mirror should show the setup screen at step 1, "Activate Your License".',
    flags
  );

  cmdWifi({ flags: {} });
  await pause(
    licensingOff
      ? 'No change on the mirror (it does not show WiFi). The phone app would now skip its WiFi step and, with licensing off, the License step too.'
      : 'No change on the mirror (it does not show WiFi). The phone app would now go from WiFi to its License step.',
    flags
  );
  if (!licensingOff && license?.state !== 'active') {
    warn(
      'Licensing is on and this mirror has no active license: the mirror stays on "Activate Your License" ' +
        'until a key is entered in the app. Restart with SKYGLASS_LICENSE=off to skip it.'
    );
  }

  await cmdOrientation({
    positional: [],
    flags: { orientation: flags.orientation || 'portrait-cw', preview: true },
  });
  await pause('Mirror turns its screen and shows the "This way up?" check (what the app\'s Orientation step does).', flags);
  await cmdOrientation({ positional: [], flags: { orientation: flags.orientation } });
  await pause('Mirror turns back to landscape (or --orientation) and leaves the check.', flags);

  await cmdLocation({ positional: [], flags: { lat: flags.lat, lon: flags.lon, tz: flags.tz } });
  await pause('Mirror advances to "Airport Setup".', flags);

  await cmdAirport({ positional: [], flags: { airport: flags.airport || DEFAULTS.airport } });
  await pause('Mirror advances to "Face Registration".', flags);

  await cmdFace({ flags });
  await pause(
    'Mirror shows "Setup Complete" then switches to the live display (airport weather, clock, ...).',
    flags
  );

  await cmdPresence({ positional: ['on'], flags: { name: flags.name } });
  await pause('Display woke up (and greets the user if one is enrolled).', flags);

  await cmdPresence({ positional: ['off'], flags: {} });
  console.log('');
  done('Walkthrough finished. The display sleeps after the configured presence timeout.');
  console.log(c.dim('  Run it again:        npm run setup:dev -- walkthrough'));
  console.log(
    c.dim('  Real camera instead: npm run dev:admin, then npm run setup:dev -- face --camera')
  );
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: PRESENCE_DIR, ...opts });
  if (r.error) {
    throw new Error(`${cmd} ${args.join(' ')} could not start: ${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status}`);
  }
}

// A venv remembers the absolute path it was created at: bin/pip, bin/activate
// and every console script hard-code it. Moving or renaming the checkout
// leaves them pointing at a directory that no longer exists.
function venvIsRelocated() {
  const cfg = path.join(VENV_DIR, 'pyvenv.cfg');
  if (!fs.existsSync(cfg)) return false;
  // pyvenv.cfg: "command = /usr/bin/python3 -m venv /abs/path/to/venv"
  const m = fs.readFileSync(cfg, 'utf8').match(/^command\s*=.*\s(\S+)\s*$/m);
  return Boolean(m && path.resolve(m[1]) !== VENV_DIR);
}

function cmdDeps() {
  if (fs.existsSync(VENV_DIR) && venvIsRelocated()) {
    info(
      'packages/presence/venv was created at a different path (checkout moved or renamed); recreating it'
    );
    fs.rmSync(VENV_DIR, { recursive: true, force: true });
  }
  if (!fs.existsSync(VENV_PYTHON)) {
    info('Creating packages/presence/venv');
    run('python3', ['-m', 'venv', 'venv']);
  }
  // Always go through the interpreter: bin/pip is a script whose shebang
  // breaks if the venv is ever moved, while bin/python is a symlink.
  const pip = [VENV_PYTHON, '-m', 'pip'];
  info('Installing requirements.txt (first run compiles dlib for face_recognition; needs cmake, takes several minutes)');
  run(pip[0], [...pip.slice(1), 'install', '--upgrade', 'pip']);
  run(pip[0], [...pip.slice(1), 'install', '-r', 'requirements.txt']);
  info('Testing camera access');
  const r = spawnSync(
    VENV_PYTHON,
    [
      '-c',
      "import cv2\ncap = cv2.VideoCapture(0)\nprint('camera: OK' if cap.isOpened() else 'camera: NOT AVAILABLE')\ncap.release()",
    ],
    { encoding: 'utf8', timeout: 30000 }
  );
  const out = (r.stdout || '').trim();
  if (out.includes('OK')) done('Camera opens from Python');
  else
    warn(
      `${out || 'camera test failed'} (on macOS grant camera access to your terminal app; enrollment can still be simulated)`
    );
  done('Python environment ready. Start the presence server with: npm run dev:admin');
}

function cmdHelp() {
  console.log(`
${c.bold('SkyGlass local setup tool')}  ${c.dim('scripts/dev-setup.mjs')}

Usage: npm run setup:dev -- <command> [options]

  status                         What the mirror/phone see, which services are up, Python env
  walkthrough [--yes] [--camera] Reset, then step through setup with pauses so you can watch :5173
  complete [--camera]            Do every step at once; mirror goes live
  reset [--yes] [--keep-config] [--keep-phones]
                                 Back to the setup screen (deletes dev config, enrollments, DB users, paired phones)

  wifi [--clear]                 Mark WiFi configured (satisfies the phone app's first step)
  orientation [landscape|portrait-cw|portrait-ccw] [--preview | --cancel]
                                 Save how the panel is mounted, or preview it ("This way up?" check)
  airport <ICAO>                 Set the home airport (default ${DEFAULTS.airport})
  location <LAT> <LON> [TZ]      Set coordinates/timezone (default ${DEFAULTS.latitude} ${DEFAULTS.longitude} ${DEFAULTS.timezone})
  face [--name N] [--id ID]      Simulated enrollment (no camera needed)
  face --camera [--name N]       Real enrollment through the backend + presence server, like the phone
  presence on|off|toggle         Report presence to the backend (wake/sleep the display)
  deps                           Create packages/presence/venv and install Python requirements

Options shared by complete/walkthrough: --orientation O --airport KXXX --lat N --lon N --tz Zone --name "Name" --id id --camera
Environment: SKYGLASS_BACKEND_URL (${BACKEND_URL}), SKYGLASS_ADMIN_URL (${ADMIN_URL}), SKYGLASS_FRONTEND_URL (${FRONTEND_URL})

Typical session:
  npm run dev                       # backend :3001, mirror UI :5173 (plus optional packages)
  npm run setup:dev -- walkthrough  # watch the setup screen advance step by step
  npm run setup:dev -- presence on  # wake the mirror as the enrolled user
  npm run setup:dev -- reset        # start over
`);
}

const COMMANDS = {
  status: cmdStatus,
  wifi: cmdWifi,
  orientation: cmdOrientation,
  airport: cmdAirport,
  location: cmdLocation,
  face: cmdFace,
  complete: cmdComplete,
  reset: cmdReset,
  presence: cmdPresence,
  walkthrough: cmdWalkthrough,
  deps: cmdDeps,
  help: cmdHelp,
};

async function main() {
  const ctx = parseArgs(process.argv.slice(2));
  if (ctx.flags.help || ctx.flags.h) ctx.cmd = 'help';
  const handler = COMMANDS[ctx.cmd];
  if (!handler) {
    fail(`Unknown command "${ctx.cmd}"`);
    cmdHelp();
    process.exit(2);
  }
  try {
    await handler(ctx);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}

main();
