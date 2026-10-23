/**
 * News API Routes
 * GET /api/news?source=world|us|business|technology|sports|aviation|custom&url=&limit=
 */

import { Router } from 'express';
import { validateQuery } from '../middleware/validate.js';
import { newsQuerySchema } from '../validation/schemas.js';
import { getNews, type NewsSource } from '../services/news.js';
import { UnsafeUrlError } from '../services/ssrf.js';
import { upstreamErrorResponse } from '../services/upstream.js';

const router = Router();

router.get('/', validateQuery(newsQuerySchema), async (req, res) => {
  const { source, url, limit } = req.query as unknown as {
    source: NewsSource;
    url?: string;
    limit: number;
  };
  try {
    const result = await getNews(source, source === 'custom' ? url : undefined, limit);
    res.json({ source: result.source, items: result.items, fetchedAt: result.fetchedAt });
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('News route error:', error instanceof Error ? error.message : error);
    const { status, body } = upstreamErrorResponse(error, 'Failed to fetch news');
    res.status(status).json(body);
  }
});

export default router;
