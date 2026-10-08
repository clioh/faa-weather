/**
 * Cloud Routes
 *
 * Handles cloud registration and relay configuration for the mirror.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { getMirrorId, getMirrorName } from '../db/index.js';
import { relayClient } from '../services/relay-client.js';
import { broadcast } from '../server.js';
import { displayManager } from '../services/display.js';
import { getUserActiveLayout } from '../db/index.js';

const router = Router();

// Validation schemas
const registerSchema = z.object({
  relayToken: z.string().min(1),
});

const updateLayoutSchema = z.object({
  userId: z.string().optional(),
  modules: z.array(z.unknown()),
});

/**
 * Get cloud registration status
 */
router.get('/status', (_req: Request, res: Response) => {
  const status = relayClient.getStatus();

  res.json({
    mirrorId: getMirrorId(),
    mirrorName: getMirrorName(),
    cloudRegistered: status.hasToken,
    cloudConnected: status.connected,
  });
});

/**
 * Register mirror with cloud (receives relay token after user links in mobile app)
 */
router.post('/register', validateBody(registerSchema), (req: Request, res: Response) => {
  const { relayToken } = req.body;

  // Store token
  relayClient.storeToken(relayToken);

  // Connect to relay
  relayClient.connect(relayToken);

  console.log('[Cloud] Mirror registered with cloud');

  res.json({
    success: true,
    mirrorId: getMirrorId(),
    cloudConnected: relayClient.isConnected(),
  });
});

/**
 * Unregister mirror from cloud
 */
router.post('/unregister', (_req: Request, res: Response) => {
  // Disconnect from relay
  relayClient.disconnect();

  // Clear stored token
  relayClient.clearToken();

  console.log('[Cloud] Mirror unregistered from cloud');

  res.json({
    success: true,
    cloudConnected: false,
  });
});

/**
 * Manually reconnect to cloud relay
 */
router.post('/reconnect', (_req: Request, res: Response) => {
  const status = relayClient.getStatus();

  if (!status.hasToken) {
    res.status(400).json({
      error: 'No relay token stored. Register with cloud first.',
    });
    return;
  }

  relayClient.connect();

  // Wait a moment for connection
  setTimeout(() => {
    res.json({
      success: true,
      cloudConnected: relayClient.isConnected(),
    });
  }, 1000);
});

/**
 * Get cloud relay URL (for debugging)
 */
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    relayUrl: process.env.CLOUD_RELAY_URL || 'wss://api.magicmirror.app/ws/relay',
    mirrorId: getMirrorId(),
  });
});

// Register command handlers for relay client
function setupRelayHandlers(): void {
  // Get current layout
  relayClient.registerHandler('getLayout', async (payload) => {
    const userId = payload?.userId as string | undefined;

    if (userId) {
      const layout = getUserActiveLayout(userId);
      if (layout) {
        return {
          id: layout.id,
          name: layout.name,
          modules: JSON.parse(layout.modules),
          userId,
        };
      }
    }

    // Return default/current layout
    return {
      modules: [],
      message: 'No active layout',
    };
  });

  // Update layout
  relayClient.registerHandler('updateLayout', async (payload) => {
    const parsed = updateLayoutSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error('Invalid layout modules');
    }

    // Broadcast layout update to local clients
    broadcast('layout', {
      action: 'update',
      userId: parsed.data.userId,
      modules: parsed.data.modules,
      source: 'cloud',
    });

    return { success: true };
  });

  // Get mirror status
  relayClient.registerHandler('getStatus', async () => {
    return {
      mirrorId: getMirrorId(),
      mirrorName: getMirrorName(),
      displayState: displayManager.getState(),
      online: true,
      timestamp: new Date().toISOString(),
    };
  });

  // Turn display on
  relayClient.registerHandler('displayOn', async () => {
    await displayManager.forceOn();
    broadcast('presence', { present: true, displayState: 'on', manual: true, source: 'cloud' });
    return { displayState: 'on' };
  });

  // Turn display off
  relayClient.registerHandler('displayOff', async () => {
    await displayManager.forceOff();
    broadcast('presence', { present: false, displayState: 'off', manual: true, source: 'cloud' });
    return { displayState: 'off' };
  });

  console.log('[Cloud] Relay command handlers registered');
}

// Setup handlers on module load
setupRelayHandlers();

export default router;
