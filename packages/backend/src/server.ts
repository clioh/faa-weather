import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { loadConfig } from './config/index.js';
import aviationRoutes from './routes/aviation.js';
import scheduleRoutes, { scheduleAuthRoutes } from './routes/schedule.js';
import setupRoutes from './routes/setup.js';
import updateRoutes from './routes/update.js';
import layoutRoutes from './routes/layout.js';
import usersRoutes from './routes/users.js';
import licenseRoutes from './routes/license.js';
import cloudRoutes from './routes/cloud.js';
import { wifiRoutes, presenceFaceRoutes, ADMIN_PORTAL_URL } from './routes/device.js';
import { relayClient } from './services/relay-client.js';
import { aviationData } from './services/aviation.js';
import { updateService } from './services/updater.js';
import { initScheduleService } from './services/schedule.js';
import { displayManager } from './services/display.js';
import { mdnsService } from './services/mdns.js';
import { licenseService } from './services/license.js';
import { initDatabase, updateUserLastSeen, getUserActiveLayout, getMirrorId, getMirrorName } from './db/index.js';

// Security middleware
import { securityMiddleware } from './middleware/security.js';
import { corsMiddleware } from './middleware/cors.js';
import { standardLimiter, authLimiter } from './middleware/rateLimiter.js';
import { validateBody } from './middleware/validate.js';
import {
  presenceSchema,
  gestureSchema,
  registrationStartSchema,
  registrationProgressSchema,
} from './validation/schemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
// Trust X-Forwarded-For only from a local reverse proxy (nginx on the device),
// so forwarded LAN clients get their real IP for rate limiting instead of
// all sharing 127.0.0.1.
app.set('trust proxy', 'loopback');
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Security middleware (must be first)
app.use(securityMiddleware);
app.use(corsMiddleware);
app.use(express.json({ limit: '1mb' }));

// Apply standard rate limiter to all API routes
app.use('/api', standardLimiter);

// Load configuration
const config = loadConfig();

// Initialize services
initScheduleService();

// API Routes
app.use('/api/aviation', aviationRoutes);
app.use('/api', aviationRoutes); // Also mount astro at /api/astro
app.use('/api/schedule', scheduleRoutes);
// Mount ONLY the Google OAuth + calendar-list routes at /api (/api/auth/google/*,
// /api/calendar/list). Mounting the whole schedule router here would make its
// /status shadow the comprehensive GET /api/status below.
app.use('/api', scheduleAuthRoutes);
app.use('/api/setup', setupRoutes);
app.use('/setup', setupRoutes); // Serve setup wizard at /setup
app.use('/admin/setup', setupRoutes); // Also serve at /admin/setup for consistency
app.use('/api/update', updateRoutes);
app.use('/api/layout', layoutRoutes); // Widget layout management
app.use('/api/users', usersRoutes); // User management
app.use('/api/license', licenseRoutes); // License management
app.use('/api/cloud', cloudRoutes); // Cloud registration and relay
app.use('/api/wifi', wifiRoutes); // WiFi provisioning (proxied to admin portal)
app.use('/api/presence/faces', presenceFaceRoutes); // Enrolled faces (proxied to presence server)

// Store connected clients
const clients = new Set<WebSocket>();

// WebSocket connection handling
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connected. Total clients:', clients.size);

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected. Total clients:', clients.size);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// Broadcast to all connected clients
export function broadcast(type: string, data: unknown): void {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Discovery info endpoint (used by mobile app after finding via mDNS)
app.get('/api/discovery', (_req, res) => {
  const mdnsInfo = mdnsService.getServiceInfo();
  res.json({
    mirrorId: getMirrorId(),
    name: getMirrorName(),
    version: process.env.npm_package_version || '0.1.0',
    airport: config.airport,
    addresses: mdnsInfo?.addresses || [],
    port: Number(PORT),
    capabilities: ['aviation', 'calendar', 'presence', 'layout', 'multi-user'],
    setupComplete: existsSync(join(__dirname, '..', '..', '..', 'packages', 'presence', 'face_data', '.wifi_configured')),
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

// Comprehensive status endpoint
app.get('/api/status', async (_req, res) => {
  const startTime = process.uptime();

  // Check service health
  const services = {
    backend: {
      status: 'healthy',
      uptime: Math.floor(startTime),
      version: process.env.npm_package_version || '0.1.0',
    },
    websocket: {
      status: 'healthy',
      clients: clients.size,
    },
    display: {
      status: 'healthy',
      state: displayManager.getState(),
    },
    aviation: {
      status: 'unknown',
      lastUpdate: null as number | null,
    },
  };

  // Check aviation data
  try {
    const metar = await aviationData.getMetar(config.airport);
    services.aviation.status = metar ? 'healthy' : 'degraded';
    services.aviation.lastUpdate = metar?.fetchedAt?.getTime() || null;
  } catch {
    services.aviation.status = 'unhealthy';
  }

  // Calculate overall status
  const unhealthy = Object.values(services).some(
    (s) => typeof s === 'object' && 'status' in s && s.status === 'unhealthy'
  );
  const degraded = Object.values(services).some(
    (s) => typeof s === 'object' && 'status' in s && s.status === 'degraded'
  );

  res.json({
    status: unhealthy ? 'unhealthy' : degraded ? 'degraded' : 'healthy',
    timestamp: Date.now(),
    uptime: Math.floor(startTime),
    airport: config.airport,
    services,
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  });
});

// Config endpoint (non-sensitive data only)
app.get('/api/config', (_req, res) => {
  res.json({
    airport: config.airport,
    location: config.location,
    widgets: config.widgets,
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
  });

  res.json({ received: true, displayState: displayManager.getState(), userId });
});

// Get current presence/display status
app.get('/api/presence', (_req, res) => {
  res.json({
    present: displayManager.isUserPresent(),
    displayState: displayManager.getState(),
  });
});

// Manual display control endpoints
app.post('/api/display/on', async (_req, res) => {
  await displayManager.forceOn();
  broadcast('presence', { present: true, displayState: 'on', manual: true });
  res.json({ displayState: 'on' });
});

app.post('/api/display/off', async (_req, res) => {
  await displayManager.forceOff();
  broadcast('presence', { present: false, displayState: 'off', manual: true });
  res.json({ displayState: 'off' });
});

// Registration mode state
let registrationMode = {
  active: false,
  startedAt: null as Date | null,
  presenceServerUrl: null as string | null,
  samplesCollected: 0,
  samplesNeeded: 5,
  userName: null as string | null,
};

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

app.post('/api/registration/start', authLimiter, validateBody(registrationStartSchema), (req, res) => {
  const { userName } = req.body;

  // The capture target is always the locally configured admin portal
  // (SKYGLASS_ADMIN_URL). A client-supplied URL is ignored so this endpoint
  // cannot be used to make the backend POST to arbitrary hosts.
  const serverUrl = ADMIN_PORTAL_URL;

  registrationMode = {
    active: true,
    startedAt: new Date(),
    presenceServerUrl: serverUrl,
    samplesCollected: 0,
    samplesNeeded: 5,
    userName: userName || null,
  };

  broadcast('registration', {
    ...registrationMode,
    action: 'started',
    currentInstruction: CAPTURE_INSTRUCTIONS[0],
  });
  console.log(`Registration mode started for user: ${userName || 'Unknown'}`);
  res.json(registrationMode);
});

app.post('/api/registration/capture', async (_req, res) => {
  if (!registrationMode.active) {
    return res.status(400).json({ error: 'Registration not active' });
  }

  // Broadcast capture-start to show countdown on mirror
  broadcast('registration', { ...registrationMode, action: 'capture-start' });

  // Wait for countdown (3 seconds)
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Try to trigger capture on presence server
  try {
    const captureUrl = `${registrationMode.presenceServerUrl}/api/capture`;
    const response = await fetch(captureUrl, { method: 'POST' });
    const result = await response.json() as { success: boolean; samples_captured?: number; message?: string };

    if (result.success) {
      registrationMode.samplesCollected = result.samples_captured || registrationMode.samplesCollected + 1;

      // Broadcast captured event
      broadcast('registration', {
        ...registrationMode,
        action: 'captured',
        currentInstruction: CAPTURE_INSTRUCTIONS[Math.min(registrationMode.samplesCollected, CAPTURE_INSTRUCTIONS.length - 1)],
      });

      // Check if complete
      if (registrationMode.samplesCollected >= registrationMode.samplesNeeded) {
        registrationMode.active = false;
        broadcast('registration', { ...registrationMode, action: 'completed' });
        console.log('Registration completed successfully');
      }

      res.json({
        success: true,
        samplesCollected: registrationMode.samplesCollected,
        complete: registrationMode.samplesCollected >= registrationMode.samplesNeeded,
      });
    } else {
      res.json({ success: false, error: result.message || 'Capture failed' });
    }
  } catch (error) {
    console.error('Failed to capture:', error);
    res.status(500).json({ success: false, error: 'Failed to communicate with presence server' });
  }
});

app.post('/api/registration/progress', validateBody(registrationProgressSchema), (req, res) => {
  const { samplesCollected, samplesNeeded } = req.body;
  registrationMode.samplesCollected = samplesCollected ?? registrationMode.samplesCollected;
  registrationMode.samplesNeeded = samplesNeeded ?? registrationMode.samplesNeeded;

  broadcast('registration', {
    ...registrationMode,
    action: 'progress',
    currentInstruction: CAPTURE_INSTRUCTIONS[Math.min(registrationMode.samplesCollected, CAPTURE_INSTRUCTIONS.length - 1)],
  });
  res.json(registrationMode);
});

app.post('/api/registration/complete', (_req, res) => {
  registrationMode.active = false;
  broadcast('registration', { ...registrationMode, action: 'completed' });
  console.log('Registration mode completed');
  res.json(registrationMode);
});

app.post('/api/registration/cancel', (_req, res) => {
  registrationMode.active = false;
  broadcast('registration', { ...registrationMode, action: 'cancelled' });
  console.log('Registration mode cancelled');
  res.json(registrationMode);
});

// Gesture endpoint (receives gesture events from Python detector)
app.post('/api/gesture', validateBody(gestureSchema), async (req, res) => {
  const { gesture, confidence } = req.body;
  console.log(`Gesture detected: ${gesture} (confidence: ${confidence})`);

  // Handle gestures
  if (gesture === 'swipe_left' || gesture === 'swipe_right' || gesture === 'wave') {
    // Dismiss/sleep gesture
    await displayManager.forceOff();
    broadcast('gesture', { gesture, confidence, action: 'sleep' });
  } else if (gesture === 'palm') {
    // Wake gesture
    await displayManager.forceOn();
    broadcast('gesture', { gesture, confidence, action: 'wake' });
  }

  broadcast('gesture', { gesture, confidence });
  res.json({ received: true, gesture });
});

// ============================================================
// Production frontend serving (must be mounted AFTER all API routes)
// ============================================================
// Kiosk loads http://localhost:3001. Enabled when NODE_ENV=production or
// SKYGLASS_SERVE_FRONTEND=1, and packages/frontend/dist exists.
const REPO_ROOT = join(__dirname, '..', '..', '..'); // src/ or dist/ -> packages/backend -> packages -> repo
const FRONTEND_DIST = join(REPO_ROOT, 'packages', 'frontend', 'dist');
const SPA_EXCLUDED_PREFIXES = ['/api', '/ws', '/setup', '/admin'];

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
    const metar = await aviationData.getMetar(config.airport, true);
    if (metar) {
      broadcast('metar', {
        icao: config.airport,
        raw: metar.raw,
        flightRules: metar.flightRules,
        parsed: metar.parsed,
      });
      console.log(`METAR updated: ${config.airport} - ${metar.flightRules}`);
    }

    const taf = await aviationData.getTaf(config.airport, true);
    if (taf) {
      broadcast('taf', {
        icao: config.airport,
        raw: taf.raw,
        parsed: taf.parsed,
      });
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

  // Validate/activate license on startup
  if (config.license?.enabled) {
    console.log('[License] Validating license...');
    const licenseValid = await licenseService.validateLicense();
    if (!licenseValid) {
      console.log('[License] License validation failed - app will show invalid screen');
    } else {
      console.log('[License] License validated successfully');
    }
  }

  // Initialize update service (check every 24 hours, notify only by default)
  await updateService.init(
    {
      autoUpdate: false,
      checkInterval: 24,
      notifyOnly: true,
    },
    (status) => {
      // Broadcast update availability to all connected clients
      broadcast('update', status);
    }
  );

  server.listen(PORT, async () => {
    console.log(`SkyGlass backend running on http://localhost:${PORT}`);
    console.log(`WebSocket server running on ws://localhost:${PORT}`);
    console.log(`Configured airport: ${config.airport}`);

    // Start mDNS service advertising
    try {
      await mdnsService.start({
        port: Number(PORT),
        version: process.env.npm_package_version || '0.1.0',
      });
    } catch (error) {
      console.error('Failed to start mDNS service (discovery may not work):', error);
    }

    // Initial data fetch on startup
    setTimeout(refreshAviationData, 2000);

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
  relayClient.disconnect();
  await mdnsService.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  relayClient.disconnect();
  await mdnsService.stop();
  process.exit(0);
});

start().catch(console.error);
