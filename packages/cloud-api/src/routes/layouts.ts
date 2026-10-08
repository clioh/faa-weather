import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/index.js';
import { protectedRoute } from '../middleware/clerk.js';
import {
  createLayoutSchema,
  updateLayoutSchema,
  syncPushSchema,
} from '../validation/schemas.js';
import { getLayoutChangesSince, pushLayoutChanges } from '../services/sync.js';

const router = Router();

// Apply authentication to all routes
router.use(protectedRoute);

// List user's layouts
router.get('/', async (req, res) => {
  try {
    const { rows } = await query<{
      id: string;
      name: string;
      modules: unknown[];
      is_active: boolean;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, modules, is_active, version, created_at, updated_at
       FROM user_layouts
       WHERE clerk_id = $1
       ORDER BY updated_at DESC`,
      [req.clerkUserId]
    );

    res.json({
      layouts: rows.map((row) => ({
        id: row.id,
        name: row.name,
        modules: row.modules,
        isActive: row.is_active,
        version: row.version,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Error listing layouts:', error);
    res.status(500).json({ error: 'Failed to list layouts' });
  }
});

// Create layout
router.post('/', async (req, res) => {
  try {
    const parsed = createLayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const { name, modules, isActive } = parsed.data;
    const id = uuidv4();

    // If this layout is active, deactivate others first
    if (isActive) {
      await query(
        'UPDATE user_layouts SET is_active = FALSE WHERE clerk_id = $1',
        [req.clerkUserId]
      );
    }

    const { rows } = await query<{
      id: string;
      name: string;
      modules: unknown[];
      is_active: boolean;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO user_layouts (id, clerk_id, name, modules, is_active, version)
       VALUES ($1, $2, $3, $4, $5, 1)
       RETURNING id, name, modules, is_active, version, created_at, updated_at`,
      [id, req.clerkUserId, name, JSON.stringify(modules), isActive || false]
    );

    res.status(201).json({
      id: rows[0].id,
      name: rows[0].name,
      modules: rows[0].modules,
      isActive: rows[0].is_active,
      version: rows[0].version,
      createdAt: rows[0].created_at.toISOString(),
      updatedAt: rows[0].updated_at.toISOString(),
    });
  } catch (error) {
    console.error('Error creating layout:', error);
    res.status(500).json({ error: 'Failed to create layout' });
  }
});

// Get single layout
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query<{
      id: string;
      name: string;
      modules: unknown[];
      is_active: boolean;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, modules, is_active, version, created_at, updated_at
       FROM user_layouts
       WHERE id = $1 AND clerk_id = $2`,
      [req.params.id, req.clerkUserId]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: 'Layout not found' });
      return;
    }

    res.json({
      id: rows[0].id,
      name: rows[0].name,
      modules: rows[0].modules,
      isActive: rows[0].is_active,
      version: rows[0].version,
      createdAt: rows[0].created_at.toISOString(),
      updatedAt: rows[0].updated_at.toISOString(),
    });
  } catch (error) {
    console.error('Error getting layout:', error);
    res.status(500).json({ error: 'Failed to get layout' });
  }
});

// Update layout
router.put('/:id', async (req, res) => {
  try {
    const parsed = updateLayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const { name, modules, isActive } = parsed.data;

    // Check if layout exists
    const { rows: existing } = await query<{ id: string }>(
      'SELECT id FROM user_layouts WHERE id = $1 AND clerk_id = $2',
      [req.params.id, req.clerkUserId]
    );

    if (existing.length === 0) {
      res.status(404).json({ error: 'Layout not found' });
      return;
    }

    // If this layout is being activated, deactivate others first
    if (isActive) {
      await query(
        'UPDATE user_layouts SET is_active = FALSE WHERE clerk_id = $1 AND id != $2',
        [req.clerkUserId, req.params.id]
      );
    }

    // Build update query dynamically
    const updates: string[] = ['version = version + 1', 'updated_at = NOW()'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      params.push(name);
    }
    if (modules !== undefined) {
      updates.push(`modules = $${paramIndex++}`);
      params.push(JSON.stringify(modules));
    }
    if (isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      params.push(isActive);
    }

    params.push(req.params.id, req.clerkUserId);

    const { rows } = await query<{
      id: string;
      name: string;
      modules: unknown[];
      is_active: boolean;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE user_layouts
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND clerk_id = $${paramIndex}
       RETURNING id, name, modules, is_active, version, created_at, updated_at`,
      params
    );

    res.json({
      id: rows[0].id,
      name: rows[0].name,
      modules: rows[0].modules,
      isActive: rows[0].is_active,
      version: rows[0].version,
      createdAt: rows[0].created_at.toISOString(),
      updatedAt: rows[0].updated_at.toISOString(),
    });
  } catch (error) {
    console.error('Error updating layout:', error);
    res.status(500).json({ error: 'Failed to update layout' });
  }
});

// Delete layout
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM user_layouts WHERE id = $1 AND clerk_id = $2',
      [req.params.id, req.clerkUserId]
    );

    if (rowCount === 0) {
      res.status(404).json({ error: 'Layout not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting layout:', error);
    res.status(500).json({ error: 'Failed to delete layout' });
  }
});

// Sync: Get changes since timestamp
router.get('/sync', async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since as string) : null;

    if (since && isNaN(since.getTime())) {
      res.status(400).json({ error: 'Invalid timestamp format' });
      return;
    }

    const layouts = await getLayoutChangesSince(req.clerkUserId!, since);

    res.json({
      layouts,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error syncing layouts:', error);
    res.status(500).json({ error: 'Failed to sync layouts' });
  }
});

// Sync: Push local changes
router.post('/sync', async (req, res) => {
  try {
    const parsed = syncPushSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const result = await pushLayoutChanges(req.clerkUserId!, parsed.data);

    res.json({
      ...result,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error pushing sync:', error);
    res.status(500).json({ error: 'Failed to push changes' });
  }
});

export default router;
