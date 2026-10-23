/**
 * Winds Aloft API Route
 * GET /api/aviation/winds-aloft?lat=&lon=&maxAltitude=12000
 */

import { Router } from 'express';
import { validateQuery } from '../middleware/validate.js';
import { windsAloftQuerySchema } from '../validation/schemas.js';
import { getWindsAloft } from '../services/winds-aloft.js';
import { upstreamErrorResponse } from '../services/upstream.js';

const router = Router();

router.get('/', validateQuery(windsAloftQuerySchema), async (req, res) => {
  const { lat, lon, maxAltitude } = req.query as unknown as {
    lat: number;
    lon: number;
    maxAltitude: number;
  };
  try {
    res.json(await getWindsAloft(lat, lon, maxAltitude));
  } catch (error) {
    console.error('Winds aloft route error:', error instanceof Error ? error.message : error);
    const { status, body } = upstreamErrorResponse(error, 'Failed to fetch winds aloft');
    res.status(status).json(body);
  }
});

export default router;
