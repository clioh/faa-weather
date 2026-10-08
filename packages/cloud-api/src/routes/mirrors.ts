import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../db/index.js';
import { protectedRoute } from '../middleware/clerk.js';
import { registerMirrorSchema } from '../validation/schemas.js';

const router = Router();

// Apply authentication to all routes
router.use(protectedRoute);

// Generate a secure relay token
function generateRelayToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// List user's mirrors
router.get('/', async (req, res) => {
  try {
    const { rows } = await query<{
      id: string;
      name: string;
      online: boolean;
      last_seen: Date | null;
      created_at: Date;
    }>(
      `SELECT id, name, online, last_seen, created_at
       FROM mirrors
       WHERE owner_clerk_id = $1
       ORDER BY created_at DESC`,
      [req.clerkUserId]
    );

    res.json({
      mirrors: rows.map((row) => ({
        id: row.id,
        name: row.name,
        online: row.online,
        lastSeen: row.last_seen?.toISOString() || null,
        createdAt: row.created_at.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Error listing mirrors:', error);
    res.status(500).json({ error: 'Failed to list mirrors' });
  }
});

// Register a new mirror
router.post('/', async (req, res) => {
  try {
    const parsed = registerMirrorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const { id, name } = parsed.data;
    const relayToken = generateRelayToken();

    // Check if mirror already exists
    const { rows: existing } = await query<{ id: string; owner_clerk_id: string }>(
      'SELECT id, owner_clerk_id FROM mirrors WHERE id = $1',
      [id]
    );

    if (existing.length > 0) {
      if (existing[0].owner_clerk_id !== req.clerkUserId) {
        res.status(403).json({ error: 'Mirror is registered to another user' });
        return;
      }

      // Mirror already registered to this user - return existing token
      const { rows } = await query<{
        id: string;
        name: string;
        relay_token: string;
        online: boolean;
        last_seen: Date | null;
        created_at: Date;
      }>(
        `SELECT id, name, relay_token, online, last_seen, created_at
         FROM mirrors WHERE id = $1`,
        [id]
      );

      res.json({
        id: rows[0].id,
        name: rows[0].name,
        relayToken: rows[0].relay_token,
        online: rows[0].online,
        lastSeen: rows[0].last_seen?.toISOString() || null,
        createdAt: rows[0].created_at.toISOString(),
      });
      return;
    }

    // Register new mirror
    const { rows } = await query<{
      id: string;
      name: string;
      relay_token: string;
      online: boolean;
      last_seen: Date | null;
      created_at: Date;
    }>(
      `INSERT INTO mirrors (id, owner_clerk_id, name, relay_token, online)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id, name, relay_token, online, last_seen, created_at`,
      [id, req.clerkUserId, name, relayToken]
    );

    res.status(201).json({
      id: rows[0].id,
      name: rows[0].name,
      relayToken: rows[0].relay_token,
      online: rows[0].online,
      lastSeen: rows[0].last_seen?.toISOString() || null,
      createdAt: rows[0].created_at.toISOString(),
    });
  } catch (error) {
    console.error('Error registering mirror:', error);
    res.status(500).json({ error: 'Failed to register mirror' });
  }
});

// Get single mirror details
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query<{
      id: string;
      name: string;
      relay_token: string;
      online: boolean;
      last_seen: Date | null;
      created_at: Date;
    }>(
      `SELECT id, name, relay_token, online, last_seen, created_at
       FROM mirrors
       WHERE id = $1 AND owner_clerk_id = $2`,
      [req.params.id, req.clerkUserId]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: 'Mirror not found' });
      return;
    }

    res.json({
      id: rows[0].id,
      name: rows[0].name,
      relayToken: rows[0].relay_token,
      online: rows[0].online,
      lastSeen: rows[0].last_seen?.toISOString() || null,
      createdAt: rows[0].created_at.toISOString(),
    });
  } catch (error) {
    console.error('Error getting mirror:', error);
    res.status(500).json({ error: 'Failed to get mirror' });
  }
});

// Unregister mirror
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM mirrors WHERE id = $1 AND owner_clerk_id = $2',
      [req.params.id, req.clerkUserId]
    );

    if (rowCount === 0) {
      res.status(404).json({ error: 'Mirror not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error unregistering mirror:', error);
    res.status(500).json({ error: 'Failed to unregister mirror' });
  }
});

// Regenerate relay token
router.post('/:id/regenerate-token', async (req, res) => {
  try {
    const newToken = generateRelayToken();

    const { rows, rowCount } = await query<{
      id: string;
      name: string;
      relay_token: string;
      online: boolean;
      last_seen: Date | null;
      created_at: Date;
    }>(
      `UPDATE mirrors
       SET relay_token = $3
       WHERE id = $1 AND owner_clerk_id = $2
       RETURNING id, name, relay_token, online, last_seen, created_at`,
      [req.params.id, req.clerkUserId, newToken]
    );

    if (rowCount === 0) {
      res.status(404).json({ error: 'Mirror not found' });
      return;
    }

    res.json({
      id: rows[0].id,
      name: rows[0].name,
      relayToken: rows[0].relay_token,
      online: rows[0].online,
      lastSeen: rows[0].last_seen?.toISOString() || null,
      createdAt: rows[0].created_at.toISOString(),
    });
  } catch (error) {
    console.error('Error regenerating token:', error);
    res.status(500).json({ error: 'Failed to regenerate token' });
  }
});

export default router;
