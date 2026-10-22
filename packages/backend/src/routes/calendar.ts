/**
 * Calendar accounts API (/api/calendar). See docs/CALENDAR.md.
 * Every response uses the public account shape; secrets never leave the store.
 * Errors are `{ error }` with a message the phone app shows verbatim.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ZodType } from 'zod';
import { calendarService } from '../calendar/instance.js';
import { CalendarAuthError, CalendarError } from '../calendar/types.js';
import { calendarConnectLimiter } from '../middleware/rateLimiter.js';
import {
  caldavAccountSchema,
  calendarPatchSchema,
  googleCompleteSchema,
  googleStartSchema,
  icsAccountSchema,
} from '../validation/schemas.js';
import { isSafeId } from '../validation/safe-id.js';

const router = Router();

/** zod body validation that reports the first issue as a readable `{ error }`. */
function body<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      res.status(400).json({ error: result.error.issues[0]?.message ?? 'Invalid request' });
      return;
    }
    req.body = result.data;
    next();
  };
}

function sendError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof CalendarError) {
    res.status(error.status).json({ error: error.message });
  } else if (error instanceof CalendarAuthError) {
    res.status(400).json({ error: error.message });
  } else {
    console.error(`[calendar] ${fallback}:`, error);
    res.status(500).json({ error: fallback });
  }
}

function accountId(req: Request, res: Response): string | null {
  const id = req.params.id;
  if (!isSafeId(id)) {
    res.status(404).json({ error: 'Calendar account not found' });
    return null;
  }
  return id;
}

router.get('/providers', async (_req, res) => {
  try {
    res.json({ providers: await calendarService.providers() });
  } catch (error) {
    sendError(res, error, 'Failed to list calendar providers');
  }
});

router.get('/accounts', (_req, res) => {
  res.json({ accounts: calendarService.listAccounts() });
});

router.patch('/accounts/:id', body(calendarPatchSchema), (req, res) => {
  const id = accountId(req, res);
  if (!id) return;
  try {
    res.json({ account: calendarService.patchAccount(id, req.body) });
  } catch (error) {
    sendError(res, error, 'Failed to update calendar account');
  }
});

router.delete('/accounts/:id', async (req, res) => {
  const id = accountId(req, res);
  if (!id) return;
  try {
    await calendarService.deleteAccount(id);
    res.status(204).end();
  } catch (error) {
    sendError(res, error, 'Failed to remove calendar account');
  }
});

router.post('/accounts/:id/sync', async (req, res) => {
  const id = accountId(req, res);
  if (!id) return;
  try {
    res.json({ account: await calendarService.syncNow(id) });
  } catch (error) {
    sendError(res, error, 'Failed to sync calendar account');
  }
});

// ---- Google (auth code + PKCE via the skyglass.dev bounce page; tokens via the sign-in service)

router.post('/google/start', calendarConnectLimiter, body(googleStartSchema), async (req, res) => {
  try {
    res.json(await calendarService.googleStart(req.body.returnUrl));
  } catch (error) {
    sendError(res, error, 'Failed to start Google sign-in');
  }
});

router.post('/google/complete', calendarConnectLimiter, body(googleCompleteSchema), async (req, res) => {
  try {
    const { account, created } = await calendarService.googleComplete(req.body.code, req.body.state);
    res.status(created ? 201 : 200).json({ account });
  } catch (error) {
    sendError(res, error, 'Google sign-in failed');
  }
});

// ---- Microsoft (device code; the backend polls in the background)

router.post('/microsoft/start', calendarConnectLimiter, async (_req, res) => {
  try {
    res.json(await calendarService.microsoftStart());
  } catch (error) {
    sendError(res, error, 'Failed to start Microsoft sign-in');
  }
});

router.get('/microsoft/status/:sessionId', (req, res) => {
  try {
    res.json(calendarService.microsoftStatus(String(req.params.sessionId)));
  } catch (error) {
    sendError(res, error, 'Failed to read sign-in status');
  }
});

// ---- CalDAV (iCloud + generic) and ICS links

router.post('/caldav', calendarConnectLimiter, body(caldavAccountSchema), async (req, res) => {
  try {
    const { account, created } = await calendarService.addCalDav(req.body);
    res.status(created ? 201 : 200).json({ account });
  } catch (error) {
    sendError(res, error, 'Failed to connect calendar');
  }
});

router.post('/ics', calendarConnectLimiter, body(icsAccountSchema), async (req, res) => {
  try {
    res.status(201).json({ account: await calendarService.addIcs(req.body) });
  } catch (error) {
    sendError(res, error, 'Failed to add calendar link');
  }
});

export default router;
