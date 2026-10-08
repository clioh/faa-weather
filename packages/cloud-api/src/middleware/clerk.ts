import { clerkMiddleware, requireAuth, getAuth } from '@clerk/express';
import type { Request, Response, NextFunction } from 'express';
import { query } from '../db/index.js';

// Clerk is only wired in when both keys are present. Without them,
// clerkMiddleware() throws on every request (including unauthenticated
// ones such as the frontend dev proxy probing the wrong port), so in that
// case we skip it and make protected routes answer 503 instead.
export const clerkConfigured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY
);

const passThrough = (_req: Request, _res: Response, next: NextFunction): void => {
  next();
};

const authNotConfigured = (_req: Request, res: Response): void => {
  res.status(503).json({
    error: 'Authentication is not configured (set CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY)',
  });
};

// Initialize Clerk middleware
export const clerkAuth = clerkConfigured ? clerkMiddleware() : passThrough;

// Require authentication for routes
export const requireAuthentication = clerkConfigured ? requireAuth() : authNotConfigured;

// Extend Express Request to include clerk auth
declare global {
  namespace Express {
    interface Request {
      clerkUserId?: string;
    }
  }
}

// Middleware to extract and validate clerk user, ensuring profile exists
export async function ensureUserProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    req.clerkUserId = auth.userId;

    // Ensure user profile exists (upsert)
    await query(
      `INSERT INTO user_profiles (clerk_id, updated_at)
       VALUES ($1, NOW())
       ON CONFLICT (clerk_id) DO UPDATE SET updated_at = NOW()`,
      [auth.userId]
    );

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
}

// Combined middleware for protected routes
export const protectedRoute = [requireAuthentication, ensureUserProfile];

// Middleware for mirror relay authentication (uses relay_token)
export async function authenticateMirrorRelay(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing relay token' });
      return;
    }

    const relayToken = authHeader.split(' ')[1];

    const { rows } = await query<{ id: string; owner_clerk_id: string }>(
      'SELECT id, owner_clerk_id FROM mirrors WHERE relay_token = $1',
      [relayToken]
    );

    if (rows.length === 0) {
      res.status(401).json({ error: 'Invalid relay token' });
      return;
    }

    // Attach mirror info to request
    (req as Request & { mirrorId: string; mirrorOwner: string }).mirrorId = rows[0].id;
    (req as Request & { mirrorId: string; mirrorOwner: string }).mirrorOwner = rows[0].owner_clerk_id;

    next();
  } catch (error) {
    console.error('Mirror auth error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
}
