/**
 * Admin API authentication: Authorization: Bearer $ADMIN_PASSWORD.
 * Lives under api/_lib/ so Vercel does not deploy it as a function.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, rateLimit, rateLimitExceeded } from './db.js'
import { clientIp, secretsEqual } from './license.js'

/** Failed admin sign-ins allowed per IP per hour before every attempt gets 429. */
export const ADMIN_AUTH_FAILURES_PER_HOUR = 10

/**
 * Check the admin password. Writes the error response and returns false when
 * the request may not proceed:
 * - 503 when ADMIN_PASSWORD is not set (never "Bearer undefined"),
 * - 429 once this IP has failed too often in the current hour,
 * - 401 for a missing or wrong password (counted against the IP).
 * The comparison is constant-time. The failure counter lives in Postgres and
 * is skipped when DATABASE_URL is not configured.
 */
export async function requireAdmin(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const password = process.env.ADMIN_PASSWORD
  if (!password) {
    res.status(503).json({ status: 'not_configured', error: 'ADMIN_PASSWORD is not set' })
    return false
  }

  const sql = getDb()
  const bucket = `admin-auth-fail:${clientIp(req.headers)}`
  if (sql && (await rateLimitExceeded(sql, bucket, ADMIN_AUTH_FAILURES_PER_HOUR))) {
    res.status(429).json({ status: 'rate_limited', error: 'Too many failed attempts. Try again in an hour.' })
    return false
  }

  const header = req.headers.authorization
  const ok =
    typeof header === 'string' && header.startsWith('Bearer ') && secretsEqual(header.slice('Bearer '.length), password)
  if (!ok) {
    if (sql) await rateLimit(sql, bucket, ADMIN_AUTH_FAILURES_PER_HOUR)
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}
