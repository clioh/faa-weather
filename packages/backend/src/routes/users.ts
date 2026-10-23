/**
 * User Management API Routes
 *
 * Handles user registration, profile management, and layout operations.
 *
 * A mirror can have several people. Each phone registers its own person, and
 * can also add someone else (name + face) and invite them: the invite pairs
 * their phone with the mirror as that person (routes/invites.ts). Until they
 * accept, any paired phone may set up their layout; afterwards only their
 * own phone can (requireLayoutAccess).
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes } from 'crypto';
import {
  getMirrorId,
  getMirrorName,
  upsertUser,
  getUser,
  getAllUsers,
  deleteUser,
  getUserActiveLayout,
  getUserLayouts,
  updateLayoutModules,
  setActiveLayout,
  createLayout,
  deleteLayout,
  markUserClaimed,
  setUserInvite,
  getUserInvite,
  type DbUser,
} from '../db/index.js';
import { pairingService } from '../pairing/index.js';
import { getAuth } from '../pairing/middleware.js';
import { hashToken } from '../pairing/service.js';
import { broadcast } from '../server.js';
import { loadCurrentLayout } from './layout.js';
import { validateBody } from '../middleware/validate.js';
import {
  createUserSchema,
  userLayoutModulesSchema,
  createUserLayoutSchema,
} from '../validation/schemas.js';

const router = express.Router();

/** Invite links stay valid this long; sending a new one cancels the old. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITE_TOKEN_PREFIX = 'sgi_';

/**
 * Layouts belong to their person once they have joined (their own phone
 * registered them or accepted their invite). Until then any paired phone may
 * set them up. The mirror itself can always. A phone paired before people
 * were tied to phones is tied to the first joined person whose layout it
 * edits, as long as nobody else's phone already is.
 */
function requireLayoutAccess(req: Request, res: Response, next: NextFunction): void {
  const id = req.params.id as string;
  const { kind, deviceId } = getAuth(res);
  if (kind !== 'device' || !deviceId) return next();
  const user = getUser(id);
  if (!user || !user.claimed_at) return next();
  const owner = pairingService.deviceUserId(deviceId);
  if (owner === id) return next();
  if (owner === null && !pairingService.hasDeviceForUser(id)) {
    pairingService.bindUser(deviceId, id);
    return next();
  }
  res.status(403).json({
    error: 'not_your_layout',
    message: `${user.name} manages their own layout from their phone.`,
  });
}

/** Public summary of a person, including whether they still need to join. */
function personJson(user: DbUser) {
  const invite = user.claimed_at ? null : getUserInvite(user.id);
  const inviteLive = invite !== null && Date.parse(invite.expires_at) > Date.now();
  return {
    id: user.id,
    name: user.name,
    preferences: JSON.parse(user.preferences),
    createdAt: user.created_at,
    lastSeen: user.last_seen,
    joined: user.claimed_at !== null,
    inviteExpiresAt: inviteLive ? invite.expires_at : null,
  };
}

/**
 * POST /api/users
 * Register or update a user from mobile app
 */
router.post('/', validateBody(createUserSchema), (req, res) => {
  const { id, name, preferences, invited } = req.body;

  try {
    const user = upsertUser(id, name, preferences || {}, loadCurrentLayout().modules, invited === true);
    // A phone registering its own profile: that person has joined, and this
    // phone is theirs.
    if (invited !== true) {
      markUserClaimed(id);
      const { kind, deviceId } = getAuth(res);
      if (kind === 'device' && deviceId) pairingService.bindUser(deviceId, id);
    }

    res.json({
      success: true,
      mirrorId: getMirrorId(),
      mirrorName: getMirrorName(),
      user: {
        id: user.id,
        name: user.name,
        preferences: JSON.parse(user.preferences),
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error('[Users] Failed to upsert user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

/**
 * GET /api/users
 * List all registered users
 */
router.get('/', (_req, res) => {
  try {
    const users = getAllUsers().map(personJson);

    res.json(users);
  } catch (error) {
    console.error('[Users] Failed to list users:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * DELETE /api/users/:id
 * Remove the user and their layouts from this mirror's database. Face data
 * lives on the presence server; the phone app deletes it there separately
 * (DELETE :5000/api/users/<id>/face, or /api/presence/faces/:id here).
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const user = getUser(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user from database (layouts cascade deleted)
    const deleted = deleteUser(id);

    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to delete user' });
    }
  } catch (error) {
    console.error('[Users] Failed to delete user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * POST /api/users/:id/invite
 * Invite someone another phone added: a single-use token their phone redeems
 * at POST /api/invites/claim. Replaces any earlier invite for them.
 */
router.post('/:id/invite', (req, res) => {
  const id = req.params.id as string;
  try {
    const user = getUser(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.claimed_at) {
      return res
        .status(409)
        .json({ error: 'already_joined', message: `${user.name} already uses SkyGlass on their phone.` });
    }
    const token = INVITE_TOKEN_PREFIX + randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    setUserInvite(id, hashToken(token), expiresAt);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ token, expiresAt, mirrorId: getMirrorId(), mirrorName: getMirrorName(), user: personJson(user) });
  } catch (error) {
    console.error('[Users] Failed to create invite:', error);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

/**
 * GET /api/users/:id/layout
 * Get user's active layout
 */
router.get('/:id/layout', (req, res) => {
  const { id } = req.params;

  try {
    const user = getUser(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const layout = getUserActiveLayout(id);
    if (!layout) {
      return res.status(404).json({ error: 'No active layout found' });
    }

    res.json({
      id: layout.id,
      name: layout.name,
      modules: JSON.parse(layout.modules),
      shelf: JSON.parse(layout.shelf || '[]'),
      updatedAt: layout.updated_at,
    });
  } catch (error) {
    console.error('[Users] Failed to get layout:', error);
    res.status(500).json({ error: 'Failed to get layout' });
  }
});

/**
 * PUT /api/users/:id/layout
 * Update user's active layout modules
 */
router.put('/:id/layout', requireLayoutAccess, validateBody(userLayoutModulesSchema), (req, res) => {
  const id = req.params.id as string;
  const { modules, shelf } = req.body;

  try {
    const layout = getUserActiveLayout(id);
    if (!layout) {
      return res.status(404).json({ error: 'No active layout found' });
    }

    updateLayoutModules(layout.id, modules, shelf);

    // Broadcast layout update to frontend
    broadcast('user-layout-update', { userId: id, modules });

    res.json({ success: true });
  } catch (error) {
    console.error('[Users] Failed to update layout:', error);
    res.status(500).json({ error: 'Failed to update layout' });
  }
});

/**
 * GET /api/users/:id/layouts
 * Get all layouts for a user
 */
router.get('/:id/layouts', (req, res) => {
  const id = req.params.id as string;

  try {
    const user = getUser(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const layouts = getUserLayouts(id).map((layout) => ({
      id: layout.id,
      name: layout.name,
      modules: JSON.parse(layout.modules),
      isActive: layout.is_active === 1,
      createdAt: layout.created_at,
      updatedAt: layout.updated_at,
    }));

    res.json(layouts);
  } catch (error) {
    console.error('[Users] Failed to get layouts:', error);
    res.status(500).json({ error: 'Failed to get layouts' });
  }
});

/**
 * POST /api/users/:id/layouts
 * Create a new layout for a user
 */
router.post('/:id/layouts', requireLayoutAccess, validateBody(createUserLayoutSchema), (req, res) => {
  const id = req.params.id as string;
  const { name, modules } = req.body;

  try {
    const user = getUser(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const layout = createLayout(id, name, modules || []);

    res.json({
      id: layout.id,
      name: layout.name,
      modules: JSON.parse(layout.modules),
      isActive: layout.is_active === 1,
      createdAt: layout.created_at,
      updatedAt: layout.updated_at,
    });
  } catch (error) {
    console.error('[Users] Failed to create layout:', error);
    res.status(500).json({ error: 'Failed to create layout' });
  }
});

/**
 * POST /api/users/:id/layouts/:layoutId/activate
 * Set a layout as active for a user
 */
router.post('/:id/layouts/:layoutId/activate', requireLayoutAccess, (req, res) => {
  const { id, layoutId } = req.params as { id: string; layoutId: string };

  try {
    const user = getUser(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const success = setActiveLayout(id, layoutId);
    if (!success) {
      return res.status(404).json({ error: 'Layout not found' });
    }

    // Broadcast layout change
    const layout = getUserActiveLayout(id);
    if (layout) {
      broadcast('user-layout-update', {
        userId: id,
        modules: JSON.parse(layout.modules),
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Users] Failed to activate layout:', error);
    res.status(500).json({ error: 'Failed to activate layout' });
  }
});

/**
 * DELETE /api/users/:id/layouts/:layoutId
 * Delete a layout
 */
router.delete('/:id/layouts/:layoutId', requireLayoutAccess, (req, res) => {
  const { id, layoutId } = req.params as { id: string; layoutId: string };

  try {
    const user = getUser(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Don't allow deleting the last layout
    const layouts = getUserLayouts(id);
    if (layouts.length <= 1) {
      return res.status(400).json({ error: 'Cannot delete the only layout' });
    }

    const layout = layouts.find((l) => l.id === layoutId);
    if (!layout) {
      return res.status(404).json({ error: 'Layout not found' });
    }

    // If deleting active layout, activate another one first
    if (layout.is_active === 1) {
      const otherLayout = layouts.find((l) => l.id !== layoutId);
      if (otherLayout) {
        setActiveLayout(id, otherLayout.id);
      }
    }

    deleteLayout(layoutId);
    res.json({ success: true });
  } catch (error) {
    console.error('[Users] Failed to delete layout:', error);
    res.status(500).json({ error: 'Failed to delete layout' });
  }
});

export default router;
