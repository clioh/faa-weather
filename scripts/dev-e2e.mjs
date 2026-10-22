#!/usr/bin/env node
/**
 * SkyGlass end-to-end dev runner
 *
 * One command that runs this machine as a mirror and lets a phone on the
 * same WiFi drive it, including the whole first-run setup:
 *
 *   1. starts the backend (:3001), the mirror UI (:5173), the presence
 *      server (:5000, camera enrollment) and the presence detector (webcam)
 *   2. with --reset, wipes setup state so the mirror shows its setup screen;
 *      otherwise airport, location and enrollments are kept across restarts
 *   3. starts the Expo dev server for the phone app (:8081, LAN mode)
 *   4. opens the mirror in your browser; on the setup screen it shows a QR
 *      code that opens the phone app already pointed at this mirror
 *
 *   npm run dev:e2e                 # start everything, keep current setup state
 *   npm run dev:e2e -- --reset      # wipe config/airport/location/enrollment/paired phones first;
 *                                   # the phone app also wipes its own data on the first scan
 *   npm run dev:e2e -- --no-admin   # skip the presence server (no camera enrollment)
 *   npm run dev:e2e -- --no-detector # skip the webcam presence detector
 *   SKYGLASS_DETECTOR_LOG=debug npm run dev:e2e   # per-second detector diagnostics
 *   npm run dev:e2e -- --no-expo    # skip the phone app dev server
 *   npm run dev:e2e -- --no-open    # don't open the browser
 *
 * Phone prerequisites: Expo Go installed, same WiFi as this machine.
 * Ctrl+C stops everything.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = (name) => path.join(ROOT, 'packages', name);
const SETUP_TOOL = path.join(ROOT, 'scripts', 'dev-setup.mjs');

const PORTS = { backend: 3001, frontend: 5173, admin: 5000, metro: 8081 };

const args = new Set(process.argv.slice(2));
const flags = {
  reset: args.has('--reset'),
  noAdmin: args.has('--no-admin'),
  noDetector: args.has('--no-detector'),
  noExpo: args.has('--no-expo'),
  noOpen: args.has('--no-open'),
};
if (args.has('--help') || args.has('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?\n?/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = { green: paint('32'), red: paint('31'), yellow: paint('33'), blue: paint('34'), cyan: paint('36'), magenta: paint('35'), dim: paint('2'), bold: paint('1') };
const info = (m) => console.log(`${c.blue('›')} ${m}`);
const ok = (m) => console.log(`${c.green('✓')} ${m}`);
const warn = (m) => console.log(`${c.yellow('!')} ${m}`);
const fail = (m) => {
  console.error(`${c.red('✗')} ${m}`);
  shutdown(1);
};

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

function lanIp() {
  const ifaces = networkInterfaces();
  const candidates = [];
  for (const [name, infos] of Object.entries(ifaces)) {
    for (const i of infos || []) {
      if (i.internal || i.family !== 'IPv4' || i.address.startsWith('169.254.')) continue;
      candidates.push({ name, address: i.address });
    }
  }
  // Prefer the primary interface on macOS/Linux, then anything else.
  const preferred = ['en0', 'eth0', 'wlan0', 'en1'];
  candidates.sort((a, b) => {
    const ia = preferred.indexOf(a.name);
    const ib = preferred.indexOf(b.name);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return candidates[0]?.address || null;
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}

async function fetchOk(url, timeoutMs = 2000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Connect deep link with a pairing secret, from the backend (local callers only). */
async function pairingQrUrl() {
  try {
    const r = await fetch(`http://localhost:${PORTS.backend}/api/pairing/qr`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    const body = await r.json();
    return typeof body.url === 'string' ? body.url : null;
  } catch {
    return null;
  }
}

async function waitFor(label, probe, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await probe()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  warn(`${label} did not come up within ${Math.round(timeoutMs / 1000)}s`);
  return false;
}

// ---------------------------------------------------------------------------
// Child processes
// ---------------------------------------------------------------------------

const children = [];

function start(label, color, cmd, cmdArgs, { cwd, env = {} }) {
  const child = spawn(cmd, cmdArgs, {
    cwd,
    env: { ...process.env, FORCE_COLOR: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // own process group, so Ctrl+C here kills tsx/vite/metro too
  });
  const prefix = c[color](`[${label}]`);
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trimEnd();
        buf = buf.slice(i + 1);
        if (line) console.log(`${prefix} ${line}`);
      }
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    warn(`${label} exited (${signal || code}).`);
  });
  children.push({ label, child });
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('');
  info('Shutting down...');
  for (const { child } of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => {
    for (const { child } of children) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    process.exit(code);
  }, 2000).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function runSetupTool(...toolArgs) {
  const r = spawnSync(process.execPath, [SETUP_TOOL, ...toolArgs], { cwd: ROOT, stdio: 'inherit' });
  return r.status === 0;
}

function printQr(text) {
  try {
    const require = createRequire(import.meta.url);
    const qr = require('qrcode-terminal');
    qr.generate(text, { small: true }, (out) => console.log(out));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(c.bold('\nSkyGlass end-to-end dev runner\n'));

  const ip = lanIp();
  if (!ip) return fail('No LAN IPv4 address found. Connect to WiFi or Ethernet first.');
  ok(`This machine on the LAN: ${c.bold(ip)}`);

  // Ports must be free: the backend must be started here so it gets the
  // SKYGLASS_DEV_APP_URL that puts the QR code on the setup screen.
  const needed = [
    ['backend', PORTS.backend],
    ['frontend', PORTS.frontend],
    ...(flags.noAdmin ? [] : [['admin', PORTS.admin]]),
    ...(flags.noExpo ? [] : [['metro', PORTS.metro]]),
  ];
  for (const [label, port] of needed) {
    if (await portInUse(port)) {
      return fail(`Port ${port} (${label}) is already in use. Stop other SkyGlass dev servers (npm run dev / dev:all / dev:admin / expo start) and retry.`);
    }
  }

  // The deep link the QR code carries. In Expo Go, exp://host:port/--/<path>
  // opens <path> inside the app served by that Metro instance. The backend
  // (GET /api/pairing/qr) appends &pair=<secret> to it. With --reset,
  // &reset=<nonce> makes the app wipe its own data the first time this
  // run's QR is scanned (packages/mobile/lib/devReset.ts).
  const resetParam = flags.reset ? `&reset=${randomBytes(4).toString('hex')}` : '';
  const appUrl = flags.noExpo
    ? null
    : `exp://${ip}:${PORTS.metro}/--/connect?host=${ip}&port=${PORTS.backend}${resetParam}`;

  // 1. Backend
  info('Starting backend on :3001');
  start('backend', 'green', 'npm', ['run', 'dev'], {
    cwd: PKG('backend'),
    // Licensing off unless the caller set SKYGLASS_LICENSE (docs/LICENSING.md).
    env: {
      SKYGLASS_LICENSE: process.env.SKYGLASS_LICENSE || 'off',
      ...(appUrl ? { SKYGLASS_DEV_APP_URL: appUrl } : {}),
    },
  });
  if (!(await waitFor('backend', () => fetchOk(`http://localhost:${PORTS.backend}/api/health`)))) {
    return fail('Backend failed to start. See [backend] output above.');
  }
  ok('Backend ready');

  // 2. Setup state
  if (flags.reset) {
    info('Resetting setup state so the mirror starts on its setup screen (--reset)');
    if (!runSetupTool('reset', '--yes')) warn('Reset reported a problem; continuing');
  } else {
    info('Keeping existing setup state (pass --reset to start from the setup screen)');
  }
  // The phone app insists on the WiFi step first and that step only works on
  // a Pi (nmcli). Mark it done so the phone goes straight to airport setup.
  runSetupTool('wifi');

  // 3. Mirror UI, presence server, Expo
  info('Starting mirror UI on :5173');
  start('mirror', 'cyan', 'npm', ['run', 'dev', '--', '--host'], { cwd: PKG('frontend') });

  if (!flags.noAdmin) {
    const venvPython = path.join(PKG('presence'), 'venv', 'bin', 'python');
    const python = fs.existsSync(venvPython) ? venvPython : 'python3';
    if (python === 'python3') warn('packages/presence/venv missing; using system python3 (run: npm run setup:dev -- deps)');
    info('Starting presence server on :5000');
    start('admin', 'magenta', python, ['web_server.py', '--port', String(PORTS.admin), '--camera', process.env.CAMERA_INDEX || '0'], {
      cwd: PKG('presence'),
    });
  }

  if (!flags.noDetector) {
    // Wakes the mirror from the webcam for enrolled users only (face_recognition;
    // it falls back to OpenCV, which wakes for any face, only if dlib is missing
    // and says so). New registrations are picked up without a restart. Its log
    // shows state changes and a 10s heartbeat; set
    // SKYGLASS_DETECTOR_LOG=debug|trace for per-frame detail.
    const venvPython = path.join(PKG('presence'), 'venv', 'bin', 'python');
    const python = fs.existsSync(venvPython) ? venvPython : 'python3';
    info('Starting presence detector (webcam)');
    // CAMERA_INDEX overrides presence.camera_index from config.yaml only when set.
    const detectorArgs = process.env.CAMERA_INDEX ? ['--camera', process.env.CAMERA_INDEX] : [];
    start('detector', 'blue', python, ['detector.py', ...detectorArgs], {
      cwd: PKG('presence'),
      env: process.env.SKYGLASS_DETECTOR_LOG ? { SKYGLASS_DETECTOR_LOG: process.env.SKYGLASS_DETECTOR_LOG } : {},
    });
  }

  if (!flags.noExpo) {
    info('Starting Expo dev server on :8081 (LAN)');
    start('expo', 'yellow', 'npx', ['expo', 'start', '--host', 'lan', '--port', String(PORTS.metro)], {
      cwd: PKG('mobile'),
      env: {
        CI: '1', // non-interactive: no keyboard UI, no prompts
        EXPO_NO_TELEMETRY: '1',
        REACT_NATIVE_PACKAGER_HOSTNAME: ip, // make Metro advertise the same IP the QR uses
      },
    });
  }

  await waitFor('mirror UI', () => fetchOk(`http://localhost:${PORTS.frontend}/`));
  if (!flags.noExpo) {
    await waitFor('Expo', () => fetchOk(`http://localhost:${PORTS.metro}/status`), 120_000);
  }

  // 4. Browser
  const mirrorUrl = `http://localhost:${PORTS.frontend}`;
  if (!flags.noOpen) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [mirrorUrl], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  }

  console.log('');
  console.log(c.green('========================================'));
  console.log(c.green('  Mirror is up'));
  console.log(c.green('========================================'));
  console.log('');
  console.log(`  Mirror (this screen):   ${mirrorUrl}`);
  console.log(`  Mirror (from phone):    http://${ip}:${PORTS.frontend}`);
  console.log(`  Backend API:            http://${ip}:${PORTS.backend}`);
  if (!flags.noAdmin) console.log(`  Presence / admin:       http://${ip}:${PORTS.admin}`);
  if (!flags.noDetector) console.log('  Presence detector:      running, see [detector] lines (preview window: npm run dev:detector)');
  if (appUrl) {
    // The backend adds a single-use pairing secret (&pair=...) to the deep
    // link, so the phone that scans it is paired at once. This terminal copy
    // stops working after one scan or 10 minutes; the mirror screen always
    // shows the current one (GET /api/pairing/qr, local callers only).
    const pairUrl = await pairingQrUrl();
    console.log(`  Phone app (Expo Go):    ${pairUrl || appUrl}`);
    console.log('');
    console.log('  Scan the QR code on the mirror\'s setup screen with your phone camera,');
    console.log(pairUrl ? '  or this one (single use, valid 10 minutes):' : '  or this one (it does not pair; the phone will ask for a code):');
    console.log('');
    if (!printQr(pairUrl || appUrl)) console.log(c.dim('  (qrcode-terminal not installed; use the QR on the mirror screen)'));
  }
  console.log('');
  console.log(`  Status / simulate steps:  npm run setup:dev -- status | presence on | off`);
  console.log(`  ${c.dim('Ctrl+C stops everything')}`);
  console.log('');
}

main().catch((err) => fail(err?.stack || String(err)));
