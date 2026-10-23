import type { WebSocket } from 'ws';
import express from 'express';
import { createServer } from 'http';
import { existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { loadConfig, configEvents, type MirrorOrientation } from './config/index.js';
import aviationRoutes from './routes/aviation.js';
import scheduleRoutes from './routes/schedule.js';
import calendarRoutes from './routes/calendar.js';
import setupRoutes, { getSetupStatus } from './routes/setup.js';
import updateRoutes from './routes/update.js';
import layoutRoutes from './routes/layout.js';
import usersRoutes from './routes/users.js';
import licenseRoutes from './routes/license.js';
import cloudRoutes from './routes/cloud.js';
import newsRoutes from './routes/news.js';
import financeRoutes from './routes/finance.js';
import weatherRoutes from './routes/weather.js';
import windsAloftRoutes from './routes/winds-aloft.js';
import todosRoutes from './routes/todos.js';
import photosRoutes from './routes/photos.js';
import { wifiRoutes, presenceFaceRoutes, ADMIN_PORTAL_URL } from './routes/device.js';
import { internalHeaders, isValidInternalToken, INTERNAL_TOKEN_HEADER } from './services/internal-token.js';
import { relayClient } from './services/relay-client.js';
import { aviationData } from './services/aviation.js';
import { updateService } from './services/updater.js';
import { initScheduleService } from './services/schedule.js';
import { calendarService } from './calendar/instance.js';
import { displayManager } from './services/display.js';
import { orientationPreview } from './services/orientation.js';
import { mdnsService } from './services/mdns.js';
import { licenseManager, usingPlaceholderPublicKey } from './license/index.js';
import { initDatabase, updateUserLastSeen, getUserActiveLayout, getMirrorId, getMirrorName } from './db/index.js';

// Security middleware
import { securityMiddleware } from './middleware/security.js';
import { corsMiddleware } from './middleware/cors.js';
import { standardLimiter, authLimiter } from './middleware/rateLimiter.js';
import { validateBody } from './middleware/validate.js';
// Phone pairing / caller trust (docs/SECURITY.md)
import { apiAuthGate } from './pairing/middleware.js';
import { pairingService, authenticateDevice, type PairingEvent } from './pairing/index.js';
import { WsHub } from './pairing/ws.js';
import { createPairingRouter } from './routes/pairing.js';
import {
  presenceSchema,
  gestureSchema,
  registrationStartSchema,
  registrationProgressSchema,
  registrationGuidanceSchema,
  type RegistrationGuidanceInput,
  displayHoldSchema,
  userLayoutModulesSchema,
} from './validation/schemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
// Trust X-Forwarded-For only from a loopback proxy (the Vite dev server, with
// xfwd), so req.ip is the real client: a LAN client is never "local", and
// forwarded clients get their own rate limits. See pairing/trust.ts.
app.set('trust proxy', 'loopback');
const server = createServer(app);
// WebSocket: upgrades are authenticated (local, or a paired phone's token
// subprotocol) before the handshake; see pairing/ws.ts.
const wsHub = new WsHub(authenticateDevice);
wsHub.attach(server);
pairingService.on('pairing', (event: PairingEvent) => {
  wsHub.broadcast('pairing', event);
  // A code is only useful if someone can see it: wake the display for the
  // code's lifetime, like POST /api/display/hold.
  if (event.state === 'show') {
    void displayManager
      .hold(Math.max(0, event.expiresAt - Date.now()) + 5000)
      .then(() =>
        broadcast('presence', {
          present: displayManager.isUserPresent(),
          displayState: displayManager.getState(),
          hold: true,
        })
      )
      .catch((error) => console.error('[Pairing] Could not wake the display:', error));
  }
});
pairingService.on('revoked', (deviceId: string) => wsHub.closeDevice(deviceId));
// License events are only broadcast on change, so a kiosk that reconnects
// after a restart would miss a flip (e.g. active → released). Every new
// socket gets the current status first (and the orientation, for the same
// reason: a preview that started or ended while it was away).
wsHub.wss.on('connection', (ws: WebSocket) => {
  try {
    ws.send(JSON.stringify({ type: 'license', data: licenseManager.getStatus(), timestamp: Date.now() }));
    ws.send(JSON.stringify({ type: 'orientation', data: orientationState(), timestamp: Date.now() }));
  } catch (error) {
    console.error('[WS] Could not send the status snapshot to a new client:', error);
  }
});

// Security middleware (must be first)
app.use(securityMiddleware);
app.use(corsMiddleware);
app.use(express.json({ limit: '1mb' }));

// Apply standard rate limiter to all API routes
app.use('/api', standardLimiter);

// Deny by default: every /api route registered after this line needs a
// trusted caller (local, internal token, or paired phone) unless it is in
// PUBLIC_API_ROUTES (pairing/middleware.ts). Keep this before all routes.
app.use('/api', apiAuthGate(authenticateDevice));

// Load configuration
let config = loadConfig();

/** Display settings the mirror UI needs (non-sensitive). */
function publicDisplayConfig(): {
  orientation: MirrorOrientation;
  fade_duration: number;
  presence_timeout: number;
} {
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    // Normalized by loadConfig (legacy `portrait` reads as portrait-cw).
    orientation: config.display?.orientation ?? 'landscape',
    fade_duration: num(config.display?.fade_duration, 1000),
    presence_timeout: num(config.display?.presence_timeout, 120),
  };
}

// Reload when the setup routes rewrite config/config.yaml so a new airport or
// location takes effect (and reaches the display) without a restart.
configEvents.on('changed', () => {
  try {
    config = loadConfig();
    console.log(`[Config] Reloaded: airport=${config.airport}`);
    broadcast('config', {
      airport: config.airport,
      location: config.location,
      display: publicDisplayConfig(),
    });
    broadcastOrientation();
    void refreshAviationData();
  } catch (error) {
    console.error('[Config] Reload failed:', error);
  }
});

/**
 * WS `orientation`: the saved orientation and the one the app is previewing
 * (null when none). The display turns to `preview ?? orientation` and shows
 * its orientation check while a preview is on. Same shape as GET
 * /api/setup/orientation.
 */
function orientationState(): { orientation: MirrorOrientation; preview: MirrorOrientation | null } {
  return { orientation: config.display?.orientation ?? 'landscape', preview: orientationPreview.current() };
}
function broadcastOrientation(): void {
  broadcast('orientation', orientationState());
}
orientationPreview.on('change', broadcastOrientation);

// Initialize services
const scheduleService = initScheduleService();
scheduleService.onChange = () => calendarService.notifyChanged();

// API Routes
app.use('/api/aviation/winds-aloft', windsAloftRoutes); // FB winds/temps aloft
app.use('/api/aviation', aviationRoutes);
app.use('/api/schedule', scheduleRoutes); // Merged calendar events + XLSX flight duties
app.use('/api/calendar', calendarRoutes); // Calendar accounts (data/calendar-accounts.json)
app.use('/api/setup', setupRoutes);
app.use('/api/update', updateRoutes);
app.use('/api/layout', layoutRoutes); // Widget layout management
app.use('/api/users', usersRoutes); // User management
app.use('/api/license', licenseRoutes); // License management
app.use('/api/cloud', cloudRoutes); // Cloud registration and relay
app.use('/api/wifi', wifiRoutes); // WiFi provisioning (proxied to admin portal)
app.use('/api/presence/faces', presenceFaceRoutes); // Enrolled faces (proxied to presence server)
app.use('/api/news', newsRoutes); // RSS/Atom headlines
app.use('/api/finance', financeRoutes); // Stocks (Stooq) + crypto (CoinGecko)
app.use('/api/weather', weatherRoutes); // General weather (Open-Meteo)
app.use('/api/todos', todosRoutes); // Todo list widget (data/todos.json)
app.use('/api/photos', photosRoutes); // Photo frame widget (data/photos/)
app.use('/api/pairing', createPairingRouter({ service: pairingService })); // Phone pairing (data/paired-devices.json)

// Broadcast to all authenticated WebSocket clients (the `pairing` event
// family goes to local sockets only, see pairing/ws.ts).
export function broadcast(type: string, data: unknown): void {
  wsHub.broadcast(type, data);
}

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Discovery info endpoint (used by mobile app after finding via mDNS)
// Public (pairing/middleware.ts): the app calls this before it is paired, so it
// carries only what is needed to identify the mirror and pick the next step.
// Anything about the owner (airport, location) or the network stays behind pairing.
app.get('/api/discovery', (_req, res) => {
  res.json({
    mirrorId: getMirrorId(),
    name: getMirrorName(),
    version: process.env.npm_package_version || '0.1.0',
    // Same meaning as GET /api/setup/status; the app's mirror list shows it.
    setupComplete: getSetupStatus().setupComplete,
    pairingRequired: true,
  });
});

// Provisioning status endpoint
// Checks if WiFi has been configured (used by frontend to show provisioning screen)
app.get('/api/provisioning/status', (_req, res) => {
  // Check for WiFi configured flag file
  // This file is created by wifi_provisioning.py after successful WiFi setup
  const projectRoot = join(__dirname, '..', '..', '..');
  const wifiConfiguredFlag = join(projectRoot, 'packages', 'presence', 'face_data', '.wifi_configured');

  const wifiConfigured = existsSync(wifiConfiguredFlag);

  res.json({
    provisioning: !wifiConfigured,
    wifiConfigured,
    hotspotSSID: 'SkyGlass-Setup',
    setupUrl: 'http://10.42.0.1',
  });
});

// Config endpoint (non-sensitive data only)
app.get('/api/config', (_req, res) => {
  res.json({
    airport: config.airport,
    location: config.location,
    display: publicDisplayConfig(),
  });
});

// Presence endpoint (receives updates from Python detector)
app.post('/api/presence', validateBody(presenceSchema), async (req, res) => {
  const { present, confidence, state, userId, userName } = req.body;

  // Log with user info if available
  if (userId) {
    console.log(`Presence update: ${userName || userId} - ${present ? 'PRESENT' : 'ABSENT'} (confidence: ${confidence?.toFixed(2)})`);
    // Update user's last seen timestamp
    try {
      updateUserLastSeen(userId);
    } catch {
      // User might not exist in DB yet
    }
  } else {
    console.log(`Presence update: ${present ? 'PRESENT' : 'ABSENT'} (confidence: ${confidence}, state: ${state})`);
  }

  // Update display based on presence
  await displayManager.handlePresence(present, confidence);

  // Get user's layout if userId provided
  let userLayout = null;
  if (userId) {
    try {
      const layout = getUserActiveLayout(userId);
      if (layout) {
        userLayout = {
          id: layout.id,
          name: layout.name,
          modules: JSON.parse(layout.modules),
        };
      }
    } catch {
      // Layout fetch failed, continue without it
    }
  }

  // Broadcast to all connected clients
  broadcast('presence', {
    present,
    confidence,
    state,
    userId,
    userName,
    userLayout,
    displayState: displayManager.getState(),
    hold: displayManager.isHeld(),
  });

  res.json({ received: true, displayState: displayManager.getState(), userId });
});

// Get current presence/display status
app.get('/api/presence', (_req, res) => {
  res.json({
    present: displayManager.isUserPresent(),
    displayState: displayManager.getState(),
    hold: displayManager.isHeld(),
  });
});

// Display hold: the phone app keeps the mirror awake while the user edits or
// previews a layout. Time-limited and renewed by the app, so a backgrounded
// app cannot leave the display stuck on. Release also clears any live preview.
app.post('/api/display/hold', validateBody(displayHoldSchema), async (req, res) => {
  const seconds = (req.body as { seconds?: number }).seconds ?? 60;
  const holdUntil = await displayManager.hold(seconds * 1000);
  broadcast('presence', {
    present: displayManager.isUserPresent(),
    displayState: displayManager.getState(),
    hold: true,
  });
  res.json({ displayState: displayManager.getState(), holdUntil });
});

app.post('/api/display/release', async (_req, res) => {
  await displayManager.release();
  broadcast('layout-preview', { modules: null });
  broadcast('presence', {
    present: displayManager.isUserPresent(),
    displayState: displayManager.getState(),
    hold: false,
  });
  res.json({ displayState: displayManager.getState() });
});

// Live layout preview: shown on the mirror immediately, never persisted.
app.post('/api/display/preview', validateBody(userLayoutModulesSchema), (req, res) => {
  const { modules } = req.body;
  broadcast('layout-preview', { modules });
  res.json({ success: true });
});

// Registration mode state.
//
// Only the backend opens camera sessions on the presence server (its
// /api/start needs the internal token), and it always broadcasts the
// 'registration' event that puts the full-screen overlay on the mirror, so
// the camera can never be viewed without the mirror showing it. The
// presence server returns a short-lived enrollment token; it is the only key
// to /video_feed and is handed to the phone (start response) and the mirror
// overlay (WebSocket event / GET /api/registration). See docs/SECURITY.md.
const presenceServerUrl = ADMIN_PORTAL_URL;

interface RegistrationMode {
  active: boolean;
  startedAt: Date | null;
  presenceServerUrl: string;
  samplesCollected: number;
  samplesNeeded: number;
  userName: string | null;
  userId: string | null;
  /** Token for /video_feed?token= (and X-SkyGlass-Enrollment); null when idle. */
  enrollmentToken: string | null;
  /** Session expiry, ms since epoch. */
  expiresAt: number | null;
  /** Latest hands-free capture hint from the presence server; null when idle and at start. */
  guidance: RegistrationGuidanceInput | null;
}

function idleRegistration(previous?: RegistrationMode): RegistrationMode {
  return {
    active: false,
    startedAt: previous?.startedAt ?? null,
    presenceServerUrl,
    samplesCollected: previous?.samplesCollected ?? 0,
    samplesNeeded: previous?.samplesNeeded ?? 5,
    userName: previous?.userName ?? null,
    userId: previous?.userId ?? null,
    enrollmentToken: null,
    expiresAt: null,
    guidance: null,
  };
}

let registrationMode: RegistrationMode = idleRegistration();
let registrationExpiryTimer: NodeJS.Timeout | null = null;

function clearRegistrationTimer(): void {
  if (registrationExpiryTimer) clearTimeout(registrationExpiryTimer);
  registrationExpiryTimer = null;
}

/** End the session locally; the token is dropped from every later message. */
function endRegistration(action: 'completed' | 'cancelled'): void {
  clearRegistrationTimer();
  registrationMode = idleRegistration(registrationMode);
  broadcast('registration', { ...registrationMode, action });
}

/** Best-effort: tell the presence server to close its camera session. */
function resetPresenceSession(): void {
  fetch(`${presenceServerUrl}/api/reset`, {
    method: 'POST',
    headers: internalHeaders(),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}

/** Express guard for endpoints only the presence server may call. */
function requireInternal(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (isValidInternalToken(req.headers[INTERNAL_TOKEN_HEADER.toLowerCase()])) return next();
  res.status(401).json({ error: 'Internal endpoint' });
}

// Guided instructions for each capture step
const CAPTURE_INSTRUCTIONS = [
  'Look straight at the mirror',
  'Turn your head slightly left',
  'Turn your head slightly right',
  'Tilt your head up a little',
  'Now smile naturally',
];

// Registration mode endpoints
app.get('/api/registration', (_req, res) => {
  res.json({
    ...registrationMode,
    currentInstruction: CAPTURE_INSTRUCTIONS[Math.min(registrationMode.samplesCollected, CAPTURE_INSTRUCTIONS.length - 1)],
  });
});

app.post('/api/registration/start', authLimiter, validateBody(registrationStartSchema), async (req, res) => {
  const { userName, userId } = req.body as { userName?: string; userId: string };

  clearRegistrationTimer();
  let session: { enrollmentToken: string; expiresAt: number };
  try {
    const response = await fetch(`${presenceServerUrl}/api/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...internalHeaders() },
      body: JSON.stringify({ userId, name: userName ?? null }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 503) {
      // Reachable, but the camera could not be opened (packages/presence/cameras.py).
      registrationMode = idleRegistration(registrationMode);
      return res.status(503).json({
        ...registrationMode,
        error: 'The mirror camera is not available. Check that it is connected, then try again.',
      });
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = (await response.json()) as { enrollmentToken?: string; expiresAt?: number };
    if (!body.enrollmentToken || typeof body.expiresAt !== 'number') {
      throw new Error('presence server returned no enrollment token');
    }
    session = { enrollmentToken: body.enrollmentToken, expiresAt: body.expiresAt };
  } catch (error) {
    registrationMode = idleRegistration(registrationMode);
    console.error(`Presence server unreachable at ${presenceServerUrl}:`, error);
    return res.status(502).json({
      ...registrationMode,
      error:
        `Presence server unreachable at ${presenceServerUrl}. ` +
        'Start it with "npm run dev:admin" (packages/presence/web_server.py) and try again.',
    });
  }

  registrationMode = {
    active: true,
    startedAt: new Date(),
    presenceServerUrl,
    samplesCollected: 0,
    samplesNeeded: 5,
    userName: userName || null,
    userId,
    enrollmentToken: session.enrollmentToken,
    expiresAt: session.expiresAt,
    guidance: null,
  };
  // The presence server expires the token on its own; mirror that here so the
  // overlay closes even if its notification is lost.
  const token = session.enrollmentToken;
  registrationExpiryTimer = setTimeout(() => {
    if (registrationMode.active && registrationMode.enrollmentToken === token) {
      console.log('Registration session expired');
      endRegistration('cancelled');
      resetPresenceSession();
    }
  }, Math.max(0, session.expiresAt - Date.now()));
  registrationExpiryTimer.unref?.();

  // Shows the full-screen registration overlay (and camera preview) on the mirror.
  broadcast('registration', {
    ...registrationMode,
    action: 'started',
    currentInstruction: CAPTURE_INSTRUCTIONS[0],
  });
  console.log(`Registration mode started for user: ${registrationMode.userName || 'Unknown'}`);
  res.json(registrationMode);
});

// Manual fallback ("Take photo now"). The presence server takes photos on its
// own once the face is framed and steady; this asks it for one now. It waits
// out the 3-2-1 countdown itself (delay) and reports the sample through
// /progress, which is the only source of the 'captured' broadcast.
app.post('/api/registration/capture', async (_req, res) => {
  if (!registrationMode.active) {
    return res.status(400).json({ error: 'Registration not active' });
  }

  // Broadcast capture-start to show countdown on mirror
  broadcast('registration', { ...registrationMode, action: 'capture-start' });

  try {
    const response = await fetch(`${presenceServerUrl}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...internalHeaders() },
      body: JSON.stringify({ delay: 3 }),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json() as { success: boolean; samples_captured?: number; message?: string; complete?: boolean };

    if (result.success) {
      // Normally /progress has already arrived; never move the count backwards.
      registrationMode.samplesCollected = Math.max(
        registrationMode.samplesCollected,
        result.samples_captured || registrationMode.samplesCollected + 1,
      );
      const complete = registrationMode.samplesCollected >= registrationMode.samplesNeeded;

      if (complete && registrationMode.active) {
        endRegistration('completed');
        console.log('Registration completed successfully');
      }

      res.json({
        success: true,
        samplesCollected: registrationMode.samplesCollected,
        complete,
      });
    } else {
      res.json({ success: false, error: result.message || 'Capture failed' });
    }
  } catch (error) {
    console.error('Failed to capture:', error);
    res.status(500).json({ success: false, error: 'Failed to communicate with presence server' });
  }
});

// Progress / completion notifications come only from the presence server.
app.post('/api/registration/progress', requireInternal, validateBody(registrationProgressSchema), (req, res) => {
  const { samplesCollected, samplesNeeded } = req.body;
  const before = registrationMode.samplesCollected;
  registrationMode.samplesCollected = samplesCollected ?? registrationMode.samplesCollected;
  registrationMode.samplesNeeded = samplesNeeded ?? registrationMode.samplesNeeded;

  // A new sample (auto or manual): mirror and phone flash / buzz on 'captured'.
  broadcast('registration', {
    ...registrationMode,
    action: registrationMode.samplesCollected > before ? 'captured' : 'progress',
    currentInstruction: CAPTURE_INSTRUCTIONS[Math.min(registrationMode.samplesCollected, CAPTURE_INSTRUCTIONS.length - 1)],
  });
  res.json({ success: true });
});

// Live hint while the presence server waits for a framed, posed, steady face.
// Sent only when the reason changes; ignored outside a session.
app.post('/api/registration/guidance', requireInternal, validateBody(registrationGuidanceSchema), (req, res) => {
  if (!registrationMode.active) return res.json({ success: true, ignored: true });
  registrationMode.guidance = req.body as RegistrationGuidanceInput;
  broadcast('registration', {
    ...registrationMode,
    action: 'guidance',
    currentInstruction: CAPTURE_INSTRUCTIONS[Math.min(registrationMode.samplesCollected, CAPTURE_INSTRUCTIONS.length - 1)],
  });
  res.json({ success: true });
});

app.post('/api/registration/complete', requireInternal, (_req, res) => {
  if (registrationMode.active) endRegistration('completed');
  console.log('Registration mode completed');
  res.json({ success: true });
});

// Called by the phone / CLI (cancel button) and by the presence server when
// its session ends (source=presence-server, then we do not call it back).
app.post('/api/registration/cancel', (req, res) => {
  const source = (req.body as { source?: string } | undefined)?.source;
  const fromPresence =
    source === 'presence-server' && isValidInternalToken(req.headers[INTERNAL_TOKEN_HEADER.toLowerCase()]);
  endRegistration('cancelled');
  console.log('Registration mode cancelled');
  if (!fromPresence) resetPresenceSession();
  res.json(registrationMode);
});

// Gesture endpoint (receives gesture events from Python detector)
app.post('/api/gesture', validateBody(gestureSchema), async (req, res) => {
  const { gesture, confidence } = req.body;
  console.log(`Gesture detected: ${gesture} (confidence: ${confidence})`);

  // Every gesture the detector reports (swipe left/right, wave) dismisses the display
  await displayManager.forceOff();

  res.json({ received: true, gesture });
});

// ============================================================
// Production frontend serving (must be mounted AFTER all API routes)
// ============================================================
// Kiosk loads http://localhost:3001. Enabled when NODE_ENV=production or
// SKYGLASS_SERVE_FRONTEND=1, and packages/frontend/dist exists.
const REPO_ROOT = join(__dirname, '..', '..', '..'); // src/ or dist/ -> packages/backend -> packages -> repo
const FRONTEND_DIST = join(REPO_ROOT, 'packages', 'frontend', 'dist');
const SPA_EXCLUDED_PREFIXES = ['/api', '/ws', '/admin'];

const wantFrontend =
  process.env.NODE_ENV === 'production' || process.env.SKYGLASS_SERVE_FRONTEND === '1';
const frontendIndex = join(FRONTEND_DIST, 'index.html');

if (wantFrontend && existsSync(frontendIndex)) {
  app.use(express.static(FRONTEND_DIST, { index: 'index.html' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const p = req.path;
    if (SPA_EXCLUDED_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) {
      return next();
    }
    if (extname(p) !== '') return next(); // missing asset -> 404, not index.html
    res.sendFile(frontendIndex);
  });
  console.log(`[Frontend] Serving built frontend from ${FRONTEND_DIST}`);
} else if (wantFrontend) {
  console.warn(
    `[Frontend] NOT serving frontend: ${frontendIndex} not found (run "npm run build" in packages/frontend)`
  );
} else {
  console.log('[Frontend] Not serving frontend (set NODE_ENV=production or SKYGLASS_SERVE_FRONTEND=1)');
}

const PORT = process.env.PORT || 3001;

// Scheduled data refresh jobs
async function refreshAviationData() {
  console.log('Refreshing aviation data...');
  try {
    // Cache warmer: widgets fetch /api/aviation/metar|taf themselves.
    const metar = await aviationData.getMetar(config.airport, true);
    if (metar) {
      console.log(`METAR updated: ${config.airport} - ${metar.flightRules}`);
    }

    const taf = await aviationData.getTaf(config.airport, true);
    if (taf) {
      console.log(`TAF updated: ${config.airport}`);
    }
  } catch (error) {
    console.error('Failed to refresh aviation data:', error);
  }
}

// Refresh METAR every 5 minutes
cron.schedule('*/5 * * * *', refreshAviationData);

// Refresh TFRs every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log('Refreshing TFR data...');
  try {
    const tfrs = await aviationData.getTfrs(true);
    broadcast('tfrs', { count: tfrs.length, tfrs });
    console.log(`TFRs updated: ${tfrs.length} active`);
  } catch (error) {
    console.error('Failed to refresh TFR data:', error);
  }
});

// Initialize and start server
async function start() {
  // Initialize database
  try {
    initDatabase();
    console.log('Database initialized');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }

  // Initialize display manager
  await displayManager.init();

  // License (docs/LICENSING.md): load the stored state now and check with
  // the server in the background; startup never waits on the network.
  licenseManager.onChange((status) => broadcast('license', status));
  if (config.license.enabled) {
    if (usingPlaceholderPublicKey()) {
      console.warn('[License] Using the placeholder public key: no activation token will verify');
    }
    // A throw here (DB or config trouble) must not abort start() before
    // listen(): the process would stay up without serving anything.
    try {
      licenseManager.start();
      console.log(`[License] State: ${licenseManager.getStatus().state}`);
    } catch (error) {
      console.error('[License] Failed to start license checks:', error);
    }
  } else {
    console.log('[License] Licensing disabled');
  }

  // Initialize update service (check every 24 hours, notify only by default)
  await updateService.init({
    autoUpdate: false,
    checkInterval: 24,
    notifyOnly: true,
  });

  server.listen(PORT, async () => {
    console.log(`SkyGlass backend running on http://localhost:${PORT}`);
    console.log(`WebSocket server running on ws://localhost:${PORT}`);
    console.log(`Configured airport: ${config.airport}`);

    // Start mDNS service advertising
    try {
      await mdnsService.start({
        mirrorId: getMirrorId(),
        port: Number(PORT),
        version: process.env.npm_package_version || '0.1.0',
      });
    } catch (error) {
      console.error('Failed to start mDNS service (discovery may not work):', error);
    }

    // Initial data fetch on startup
    setTimeout(refreshAviationData, 2000);

    // Calendar accounts: background sync every calendar.refresh_minutes
    calendarService.start();

    // Connect to cloud relay if token exists
    setTimeout(() => {
      const status = relayClient.getStatus();
      if (status.hasToken) {
        console.log('[Cloud] Attempting to connect to cloud relay...');
        relayClient.connect();
      }
    }, 3000);
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  calendarService.stop();
  licenseManager.stop();
  relayClient.disconnect();
  await mdnsService.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  calendarService.stop();
  licenseManager.stop();
  relayClient.disconnect();
  await mdnsService.stop();
  process.exit(0);
});

// Tests import this module for the route stack (pairing/deny-by-default.test.ts)
// and set SKYGLASS_NO_LISTEN=1 so nothing starts or listens.
export { app };
if (process.env.SKYGLASS_NO_LISTEN !== '1') {
  // A stray rejection (a background job without a catch) is logged instead
  // of terminating the mirror's backend (Node's default since v15).
  process.on('unhandledRejection', (reason) => {
    console.error('[Process] Unhandled promise rejection:', reason);
  });
  start().catch((error) => {
    // Alive but not listening helps nobody: exit so PM2/systemd restarts us.
    console.error('[Server] Startup failed:', error);
    process.exit(1);
  });
}
