/**
 * User Management API Routes
 *
 * Handles user registration, profile management, and layout operations.
 */

import express from 'express';
import {
  getMirrorId,
  getMirrorName,
  upsertUser,
  getUser,
  getAllUsers,
  deleteUser,
  updateUserLastSeen,
  getUserActiveLayout,
  getUserLayouts,
  updateLayoutModules,
  setActiveLayout,
  createLayout,
  deleteLayout,
} from '../db/index.js';
import { broadcast } from '../server.js';
import { validateBody } from '../middleware/validate.js';
import {
  createUserSchema,
  userLayoutModulesSchema,
  createUserLayoutSchema,
} from '../validation/schemas.js';

const router = express.Router();

/**
 * POST /api/users
 * Register or update a user from mobile app
 */
router.post('/', validateBody(createUserSchema), (req, res) => {
  const { id, name, preferences } = req.body;

  try {
    const user = upsertUser(id, name, preferences || {});

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
    const users = getAllUsers().map((user) => ({
      id: user.id,
      name: user.name,
      preferences: JSON.parse(user.preferences),
      createdAt: user.created_at,
      lastSeen: user.last_seen,
    }));

    res.json(users);
  } catch (error) {
    console.error('[Users] Failed to list users:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * GET /api/users/:id
 * Get user details including layouts
 */
router.get('/:id', (req, res) => {
  const { id } = req.params;

  try {
    const user = getUser(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const layouts = getUserLayouts(id).map((layout) => ({
      id: layout.id,
      name: layout.name,
      isActive: layout.is_active === 1,
      updatedAt: layout.updated_at,
    }));

    res.json({
      id: user.id,
      name: user.name,
      preferences: JSON.parse(user.preferences),
      createdAt: user.created_at,
      lastSeen: user.last_seen,
      layouts,
    });
  } catch (error) {
    console.error('[Users] Failed to get user:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/**
 * DELETE /api/users/:id
 * Remove user from mirror (also removes face data via presence service)
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
      // Notify frontend about user removal
      broadcast('user-removed', { userId: id, userName: user.name });

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
router.put('/:id/layout', validateBody(userLayoutModulesSchema), (req, res) => {
  const id = req.params.id as string;
  const { modules } = req.body;

  try {
    const layout = getUserActiveLayout(id);
    if (!layout) {
      return res.status(404).json({ error: 'No active layout found' });
    }

    updateLayoutModules(layout.id, modules);

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
router.post('/:id/layouts', validateBody(createUserLayoutSchema), (req, res) => {
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
router.post('/:id/layouts/:layoutId/activate', (req, res) => {
  const { id, layoutId } = req.params;

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
router.delete('/:id/layouts/:layoutId', (req, res) => {
  const { id, layoutId } = req.params;

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

/**
 * POST /api/users/:id/seen
 * Update user's last seen timestamp (called when user is recognized)
 */
router.post('/:id/seen', (req, res) => {
  const { id } = req.params;

  try {
    updateUserLastSeen(id);
    res.json({ success: true });
  } catch (error) {
    console.error('[Users] Failed to update last seen:', error);
    res.status(500).json({ error: 'Failed to update last seen' });
  }
});

export default router;
