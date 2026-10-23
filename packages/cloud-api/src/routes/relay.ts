import { Router, type Request, type Response } from 'express';
import { query } from '../db/index.js';
import { protectedRoute } from '../middleware/clerk.js';
import { relayCommandSchema } from '../validation/schemas.js';
import { relayService } from '../services/relay.js';

const router = Router();

// Send command to mirror via relay
router.post(
  '/:mirrorId/command',
  protectedRoute,
  async (req: Request<{ mirrorId: string }>, res: Response) => {
    try {
      const { mirrorId } = req.params;

      // Verify user owns this mirror
      const { rows } = await query<{ id: string }>(
        'SELECT id FROM mirrors WHERE id = $1 AND owner_clerk_id = $2',
        [mirrorId, req.clerkUserId]
      );

      if (rows.length === 0) {
        res.status(404).json({ error: 'Mirror not found' });
        return;
      }

      // Validate command
      const parsed = relayCommandSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid command', details: parsed.error.issues });
        return;
      }

      const { command, payload } = parsed.data;

      // Check if mirror is connected
      if (!relayService.isMirrorConnected(mirrorId)) {
        res.status(503).json({ error: 'Mirror is not connected' });
        return;
      }

      // Send command and wait for response
      const response = await relayService.sendCommand(mirrorId, command, payload);

      res.json({
        success: true,
        data: response,
      });
    } catch (error) {
      console.error('Error sending command:', error);
      if (error instanceof Error) {
        if (error.message === 'Command timed out') {
          res.status(504).json({ error: 'Command timed out' });
          return;
        }
        if (
          error.message === 'Mirror not connected' ||
          error.message === 'Mirror connection not ready'
        ) {
          res.status(503).json({ error: error.message });
          return;
        }
      }
      res.status(500).json({ error: 'Failed to send command' });
    }
  }
);

// Get mirror connection status
router.get(
  '/:mirrorId/status',
  protectedRoute,
  async (req: Request<{ mirrorId: string }>, res: Response) => {
    try {
      const { mirrorId } = req.params;

      // Verify user owns this mirror
      const { rows } = await query<{
        id: string;
        online: boolean;
        last_seen: Date | null;
      }>('SELECT id, online, last_seen FROM mirrors WHERE id = $1 AND owner_clerk_id = $2', [
        mirrorId,
        req.clerkUserId,
      ]);

      if (rows.length === 0) {
        res.status(404).json({ error: 'Mirror not found' });
        return;
      }

      const isConnected = relayService.isMirrorConnected(mirrorId);

      res.json({
        mirrorId,
        connected: isConnected,
        online: rows[0].online,
        lastSeen: rows[0].last_seen?.toISOString() || null,
      });
    } catch (error) {
      console.error('Error getting relay status:', error);
      res.status(500).json({ error: 'Failed to get relay status' });
    }
  }
);

export default router;
