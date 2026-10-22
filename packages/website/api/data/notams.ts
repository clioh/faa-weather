import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleNotamsRequest, sendDataResult, toDataRequestInput } from '../_lib/data.js'

// GET /api/data/notams?icao=KSAN: FAA NOTAMs (server-held FAA credentials), CDN-cached.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  sendDataResult(res, await handleNotamsRequest(toDataRequestInput(req)))
}
