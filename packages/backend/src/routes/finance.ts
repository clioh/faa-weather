/**
 * Finance API Routes
 * GET /api/finance/stocks?symbols=AAPL,MSFT
 * GET /api/finance/crypto?coins=BTC,ETH&currency=USD
 */

import { Router } from 'express';
import { validateQuery } from '../middleware/validate.js';
import { cryptoQuerySchema, stocksQuerySchema } from '../validation/schemas.js';
import {
  getCryptoQuotes,
  getStockQuotes,
  setSkyglassServiceUrl,
  type CryptoCurrency,
} from '../services/finance.js';
import { skyglassServiceUrl } from '../services/skyglass-service.js';
import { loadConfig, configEvents } from '../config/index.js';
import { upstreamErrorResponse } from '../services/upstream.js';

const router = Router();

// Stock quotes come from the SkyGlass service (skyglass_service); reloaded with the config.
function applyFinanceConfig(): void {
  try {
    const base = skyglassServiceUrl(loadConfig());
    if (!base)
      console.warn(
        '[finance] skyglass_service is not a valid https:// URL; using Yahoo for stock quotes'
      );
    setSkyglassServiceUrl(base);
  } catch (error) {
    console.error(
      '[finance] Failed to read config:',
      error instanceof Error ? error.message : error
    );
  }
}
applyFinanceConfig();
configEvents.on('changed', applyFinanceConfig);

router.get('/stocks', validateQuery(stocksQuerySchema), async (req, res) => {
  const { symbols } = req.query as unknown as { symbols: string[] };
  try {
    res.json(await getStockQuotes(symbols));
  } catch (error) {
    console.error('Stocks route error:', error instanceof Error ? error.message : error);
    const { status, body } = upstreamErrorResponse(error, 'Failed to fetch stock quotes');
    res.status(status).json(body);
  }
});

router.get('/crypto', validateQuery(cryptoQuerySchema), async (req, res) => {
  const { coins, currency } = req.query as unknown as { coins: string[]; currency: CryptoCurrency };
  try {
    res.json(await getCryptoQuotes(coins, currency));
  } catch (error) {
    console.error('Crypto route error:', error instanceof Error ? error.message : error);
    const { status, body } = upstreamErrorResponse(error, 'Failed to fetch crypto prices');
    res.status(status).json(body);
  }
});

export default router;
