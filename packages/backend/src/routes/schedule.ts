/**
 * Schedule API Routes
 * Endpoints for calendar events, flight schedules, and OAuth
 */

import { Router } from 'express';
import multer from 'multer';
import { getGoogleAuth, initGoogleAuth } from '../auth/google-oauth.js';
import { googleCalendar } from '../services/calendar.js';
import { getScheduleService } from '../services/schedule.js';
import { getXlsxHeaders } from '../services/schedule-parser.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';

const router = Router();
/**
 * Google OAuth + calendar-list routes. Mounted at /api (so /api/auth/google/*
 * and /api/calendar/list work, matching the OAuth redirect URI) and also
 * nested under /api/schedule for backwards compatibility. Kept separate from
 * `router` so mounting at /api does not expose schedule's /status, /, etc.
 * at the API root (which previously shadowed GET /api/status).
 */
export const scheduleAuthRoutes = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Google Auth if credentials are available
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  initGoogleAuth({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  });
}

/**
 * GET /api/schedule
 * Get all upcoming events from all sources
 */
router.get('/', async (req, res) => {
  try {
    const service = getScheduleService();
    if (!service) {
      return res.status(503).json({ error: 'Schedule service not initialized' });
    }

    const daysAhead = parseInt(req.query.days as string) || 7;
    const events = await service.getAllEvents(daysAhead);

    res.json({
      count: events.length,
      events: events.map((event) => ({
        ...event,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Schedule route error:', error);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

/**
 * GET /api/schedule/today
 * Get today's events
 */
router.get('/today', async (_req, res) => {
  try {
    const service = getScheduleService();
    if (!service) {
      return res.status(503).json({ error: 'Schedule service not initialized' });
    }

    const events = await service.getTodaysEvents();

    res.json({
      date: new Date().toISOString().split('T')[0],
      count: events.length,
      events: events.map((event) => ({
        ...event,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Today schedule route error:', error);
    res.status(500).json({ error: 'Failed to fetch today\'s schedule' });
  }
});

/**
 * GET /api/schedule/flights
 * Get upcoming flights only
 */
router.get('/flights', (req, res) => {
  try {
    const service = getScheduleService();
    if (!service) {
      return res.status(503).json({ error: 'Schedule service not initialized' });
    }

    const daysAhead = parseInt(req.query.days as string) || 7;
    const flights = service.getUpcomingFlights(daysAhead);

    res.json({
      count: flights.length,
      flights: flights.map((flight) => ({
        ...flight,
        startTime: flight.startTime.toISOString(),
        endTime: flight.endTime.toISOString(),
        reportTime: flight.reportTime?.toISOString(),
        releaseTime: flight.releaseTime?.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Flights route error:', error);
    res.status(500).json({ error: 'Failed to fetch flights' });
  }
});

/**
 * GET /api/schedule/next-flight
 * Get the next upcoming flight
 */
router.get('/next-flight', (_req, res) => {
  try {
    const service = getScheduleService();
    if (!service) {
      return res.status(503).json({ error: 'Schedule service not initialized' });
    }

    const nextFlight = service.getNextFlight();

    if (!nextFlight) {
      return res.json({ flight: null });
    }

    res.json({
      flight: {
        ...nextFlight,
        startTime: nextFlight.startTime.toISOString(),
        endTime: nextFlight.endTime.toISOString(),
        reportTime: nextFlight.reportTime?.toISOString(),
        releaseTime: nextFlight.releaseTime?.toISOString(),
      },
    });
  } catch (error) {
    console.error('Next flight route error:', error);
    res.status(500).json({ error: 'Failed to fetch next flight' });
  }
});

/**
 * POST /api/schedule/upload
 * Upload an XLSX schedule file manually
 */
router.post('/upload', uploadLimiter, upload.single('schedule'), async (req, res) => {
  try {
    const service = getScheduleService();
    if (!service) {
      return res.status(503).json({ error: 'Schedule service not initialized' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const events = await service.loadScheduleFromBuffer(req.file.buffer);

    res.json({
      success: true,
      eventsLoaded: events.length,
      events: events.slice(0, 10).map((event) => ({
        ...event,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Upload route error:', error);
    res.status(500).json({ error: 'Failed to process schedule file' });
  }
});

/**
 * POST /api/schedule/analyze
 * Analyze an XLSX file and return column headers (for configuration)
 */
router.post('/analyze', uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const headers = await getXlsxHeaders(req.file.buffer);

    res.json({
      success: true,
      headers,
    });
  } catch (error) {
    console.error('Analyze route error:', error);
    res.status(500).json({ error: 'Failed to analyze file' });
  }
});

/**
 * GET /api/schedule/status
 * Get schedule service status
 */
router.get('/status', (_req, res) => {
  const service = getScheduleService();
  const auth = getGoogleAuth();

  res.json({
    initialized: !!service,
    googleCalendar: {
      configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      authenticated: auth?.isAuthenticated() || false,
    },
    flightSchedule: {
      eventsLoaded: service?.getFlightEvents().length || 0,
    },
  });
});

// ========== Google OAuth Routes ==========

/**
 * GET /api/auth/google
 * Start Google OAuth flow
 */
scheduleAuthRoutes.get('/auth/google', (_req, res) => {
  const auth = getGoogleAuth();
  if (!auth) {
    return res.status(503).json({
      error: 'Google OAuth not configured',
      help: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables',
    });
  }

  const authUrl = auth.getAuthUrl();
  res.redirect(authUrl);
});

/**
 * GET /api/auth/google/callback
 * OAuth callback handler
 */
scheduleAuthRoutes.get('/auth/google/callback', async (req, res) => {
  const auth = getGoogleAuth();
  if (!auth) {
    return res.status(503).send('Google OAuth not configured');
  }

  const code = req.query.code as string;
  if (!code) {
    return res.status(400).send('No authorization code provided');
  }

  const success = await auth.handleCallback(code);

  if (success) {
    res.send(`
      <html>
        <head><title>Success</title></head>
        <body style="font-family: sans-serif; padding: 2rem; text-align: center;">
          <h1>Google Calendar Connected!</h1>
          <p>You can close this window and return to SkyGlass.</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body>
      </html>
    `);
  } else {
    res.status(500).send('Failed to complete authentication');
  }
});

/**
 * GET /api/auth/google/status
 * Check Google authentication status
 */
scheduleAuthRoutes.get('/auth/google/status', (_req, res) => {
  const auth = getGoogleAuth();
  res.json({
    configured: !!auth,
    authenticated: auth?.isAuthenticated() || false,
  });
});

/**
 * POST /api/auth/google/revoke
 * Revoke Google access
 */
scheduleAuthRoutes.post('/auth/google/revoke', async (_req, res) => {
  const auth = getGoogleAuth();
  if (auth) {
    await auth.revoke();
  }
  res.json({ success: true });
});

/**
 * GET /api/calendar/list
 * Get list of available Google Calendars
 */
scheduleAuthRoutes.get('/calendar/list', async (_req, res) => {
  try {
    if (!googleCalendar.isAvailable()) {
      return res.status(401).json({ error: 'Not authenticated with Google' });
    }

    const calendars = await googleCalendar.getCalendarList();
    res.json({ calendars });
  } catch (error) {
    console.error('Calendar list error:', error);
    res.status(500).json({ error: 'Failed to fetch calendar list' });
  }
});

// Keep /api/schedule/auth/* and /api/schedule/calendar/list working
router.use(scheduleAuthRoutes);

export default router;
