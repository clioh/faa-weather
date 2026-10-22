/**
 * Update API Routes
 * Endpoints for checking and applying software updates
 */

import express from 'express';
import { updateService } from '../services/updater.js';
import { criticalLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { updateConfigSchema } from '../validation/schemas.js';

const router = express.Router();

/**
 * GET /api/update/status
 * Get current update status
 */
router.get('/status', (_req, res) => {
  const status = updateService.getStatus();
  res.json(status);
});

/**
 * POST /api/update/check
 * Check for updates
 */
router.post('/check', async (_req, res) => {
  try {
    const status = await updateService.checkForUpdates();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to check for updates',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/update/download
 * Download update without installing
 */
router.post('/download', async (_req, res) => {
  try {
    const result = await updateService.downloadUpdate();
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/update/apply
 * Apply available updates
 */
router.post('/apply', criticalLimiter, async (_req, res) => {
  try {
    const result = await updateService.applyUpdates();
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/update/config
 * Get update configuration
 */
router.get('/config', (_req, res) => {
  const config = updateService.getConfig();
  res.json(config);
});

/**
 * POST /api/update/config
 * Update configuration
 */
router.post('/config', validateBody(updateConfigSchema), (req, res) => {
  const { autoUpdate, autoDownload, checkInterval, notifyOnly, githubRepo } = req.body;

  updateService.setConfig({ autoUpdate, autoDownload, checkInterval, notifyOnly, githubRepo });
  res.json(updateService.getConfig());
});

export default router;
