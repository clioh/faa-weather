import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, rateLimit } from './_lib/db.js'
import { getResend } from './_lib/email.js'
import { readJsonObject } from './_lib/http.js'
import { clientIp, normalizeEmail } from './_lib/license.js'

/**
 * Join the pre-order waitlist.
 *
 *   POST { email } → 200 { success: true }
 *
 * The address is stored as a contact in the Resend audience RESEND_AUDIENCE_ID
 * and nothing is sent now: the page promises one email when pre-orders open
 * (a Resend broadcast to that audience, which carries its own unsubscribe
 * link). Sending nothing here also means the endpoint can't be used to mail
 * arbitrary inboxes. Re-joining is harmless: an existing contact is left as it
 * is (so someone who unsubscribed stays unsubscribed).
 *
 * Limits (Postgres, best-effort, per hour): WAITLIST_PER_IP per client IP and
 * WAITLIST_PER_EMAIL per address. Without DATABASE_URL they are skipped and the
 * Vercel WAF rule for /api/waitlist (firewall/rate-limits.json) is the only cap.
 */

const WAITLIST_PER_IP = 10
const WAITLIST_PER_EMAIL = 3

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const resend = getResend()
  const audienceId = process.env.RESEND_AUDIENCE_ID
  if (!resend || !audienceId) {
    console.error('[Waitlist] Not configured: RESEND_API_KEY and RESEND_AUDIENCE_ID are required')
    return res
      .status(503)
      .json({ error: "The waitlist isn't available right now. Please try again later." })
  }

  const body = readJsonObject(req)
  if (!body) {
    return res.status(400).json({ error: 'Body must be a JSON object' })
  }
  const email = normalizeEmail(body.email)
  if (!email) {
    return res.status(400).json({ error: 'Enter a valid email address' })
  }

  const sql = getDb()
  if (sql) {
    const ipOk = await rateLimit(sql, `waitlist:${clientIp(req.headers)}`, WAITLIST_PER_IP)
    const emailOk = ipOk && (await rateLimit(sql, `waitlist-email:${email}`, WAITLIST_PER_EMAIL))
    if (!ipOk || !emailOk) {
      return res.status(429).json({ error: 'Too many attempts. Please try again in an hour.' })
    }
  }

  try {
    if (await storeContact(resend, audienceId, email)) {
      console.log('[Waitlist] Address stored')
      return res.status(200).json({ success: true })
    }
  } catch (err) {
    console.error('[Waitlist] Contact error:', err)
  }
  return res
    .status(502)
    .json({ error: "We couldn't add you to the list just now. Please try again in a minute." })
}

/** Add the contact, or confirm it is already in the audience. */
async function storeContact(
  resend: NonNullable<ReturnType<typeof getResend>>,
  audienceId: string,
  email: string
): Promise<boolean> {
  const created = await resend.contacts.create({ audienceId, email, unsubscribed: false })
  if (!created.error) return true
  // Most likely the address is already on the list; anything else is a real failure.
  const existing = await resend.contacts.get({ audienceId, email })
  if (!existing.error && existing.data) return true
  console.error('[Waitlist] Could not store contact:', created.error.message)
  return false
}
