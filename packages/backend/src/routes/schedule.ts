/**
 * Schedule API Routes (/api/schedule)
 *
 * GET /            merged calendar-account events + XLSX flight duties
 * GET /flights     XLSX flight duties only (same ScheduleEvent shape)
 * GET /next-flight next XLSX flight duty
 * POST /upload     upload an XLSX schedule (replaces the current one); POST /analyze reads its headers
 * DELETE /         remove the XLSX flight schedule
 * GET /status      service status
 *
 * Calendar accounts are managed under /api/calendar (routes/calendar.ts).
 */

import { Router, type Request, type RequestHandler } from 'express';
import multer from 'multer';
import {
  getScheduleService,
  flightToScheduleEvent,
  mergeScheduleEvents,
  scheduleWindow,
} from '../services/schedule.js';
import { getXlsxHeaders, ScheduleParseError } from '../services/schedule-parser.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { calendarService } from '../calendar/instance.js';
import type { TimeWindow } from '../calendar/types.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

/** multer's single-file parser, answering 413 for a file over 10 MB instead of a 500. */
function singleFile(field: string): RequestHandler {
  const parse = upload.single(field);
  return (req, res, next) => {
    parse(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        const tooLarge = err.code === 'LIMIT_FILE_SIZE';
        res
          .status(tooLarge ? 413 : 400)
          .json({ error: tooLarge ? 'File must be 10 MB or smaller' : err.message });
        return;
      }
      next(err);
    });
  };
}

function windowFor(req: Request): TimeWindow {
  return scheduleWindow(req.query.days, calendarService.syncSettings().timezone);
}

router.get('/', async (req, res) => {
  try {
    const window = windowFor(req);
    const service = getScheduleService();
    const [calendar, flights] = await Promise.all([
      calendarService.getEvents(window),
      Promise.resolve(service ? service.getFlightsInWindow(window) : []),
    ]);
    const events = mergeScheduleEvents(calendar.events, flights);
    res.json({
      count: events.length,
      events,
      accounts: calendar.accounts,
      updatedAt: calendar.updatedAt,
    });
  } catch (error) {
    console.error('Schedule route error:', error);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

router.get('/flights', (req, res) => {
  try {
    const service = getScheduleService();
    const flights = service ? service.getFlightsInWindow(windowFor(req)) : [];
    res.json({ count: flights.length, flights });
  } catch (error) {
    console.error('Flights route error:', error);
    res.status(500).json({ error: 'Failed to fetch flights' });
  }
});

router.get('/next-flight', (_req, res) => {
  try {
    const next = getScheduleService()?.getNextFlight();
    res.json({ flight: next ? flightToScheduleEvent(next) : null });
  } catch (error) {
    console.error('Next flight route error:', error);
    res.status(500).json({ error: 'Failed to fetch next flight' });
  }
});

router.post('/upload', uploadLimiter, singleFile('schedule'), async (req, res) => {
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
      events: events.slice(0, 10).map(flightToScheduleEvent),
    });
  } catch (error) {
    if (error instanceof ScheduleParseError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Upload route error:', error);
    res.status(500).json({ error: 'Failed to process schedule file' });
  }
});

router.post('/analyze', uploadLimiter, singleFile('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const headers = await getXlsxHeaders(req.file.buffer);
    res.json({ success: true, headers });
  } catch (error) {
    console.error('Analyze route error:', error);
    res.status(500).json({ error: 'Failed to analyze file' });
  }
});

router.delete('/', (_req, res) => {
  const service = getScheduleService();
  if (!service) {
    return res.status(503).json({ error: 'Schedule service not initialized' });
  }
  service.clear();
  res.json({ success: true });
});

router.get('/status', (_req, res) => {
  const service = getScheduleService();
  res.json({
    initialized: !!service,
    calendarAccounts: calendarService.listAccounts().map((a) => ({
      id: a.id,
      provider: a.provider,
      label: a.label,
      status: a.status,
      lastSyncAt: a.lastSyncAt,
    })),
    flightSchedule: {
      eventsLoaded: service?.getFlightEvents().length || 0,
    },
  });
});

export default router;
