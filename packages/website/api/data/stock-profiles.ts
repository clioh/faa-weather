import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleStockProfilesRequest, sendDataResult, toDataRequestInput } from '../_lib/data.js'

// GET /api/data/stock-profiles?symbols=AAPL: Finnhub company names, CDN-cached.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  sendDataResult(res, await handleStockProfilesRequest(toDataRequestInput(req)))
}
