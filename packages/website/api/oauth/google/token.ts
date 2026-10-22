import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleGoogleTokenRequest, sendResult, toRequestInput } from '../../_lib/oauth.js'

// POST /api/oauth/google/token: code exchange / refresh with the server-held secret.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  sendResult(res, await handleGoogleTokenRequest(toRequestInput(req)))
}
