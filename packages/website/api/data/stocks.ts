import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleStocksRequest, sendDataResult, toDataRequestInput } from '../_lib/data.js'

// GET /api/data/stocks?symbols=AAPL,MSFT: Finnhub quotes (server-held key), CDN-cached.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  sendDataResult(res, await handleStocksRequest(toDataRequestInput(req)))
}
