import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleConfigRequest, sendResult, toRequestInput } from '../_lib/oauth.js'

// GET /api/oauth/config: public client IDs, redirect URI, scopes (no secrets).
export default function handler(req: VercelRequest, res: VercelResponse) {
  sendResult(res, handleConfigRequest(toRequestInput(req)))
}
