import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { KeyObject } from 'node:crypto'
import {
  assignNewKey,
  customerReleaseCounts,
  findByEmail,
  findById,
  findByKeyHash,
  getDb,
  iso,
  rateLimit,
  releaseLicense,
  releasesRemaining,
  type LicenseRow,
  type Sql,
} from '../_lib/db.js'
import { LICENSE_FROM, MANAGE_URL, manageSignInEmailHtml, reissuedKeyEmailHtml, sendEmail } from '../_lib/email.js'
import { readJsonObject, sleep } from '../_lib/http.js'
import {
  FINGERPRINT_TYPES,
  buildTokenPayload,
  clientIp,
  createManageToken,
  hashLicenseKey,
  normalizeEmail,
  normalizeLicenseKey,
  parseSigningKey,
  signToken,
  verifyManageToken,
  type FingerprintType,
} from '../_lib/license.js'

/**
 * SkyGlass license API: POST /api/license/:action (docs/LICENSING.md).
 * One function for every action (Vercel Hobby caps the number of functions).
 */

const ACTIVATION_LIMIT_PER_HOUR = 30
const MANAGE_REQUEST_LIMIT_PER_HOUR = 5
/**
 * manage-request always takes at least this long, so its timing doesn't
 * reveal whether the address has licenses (a sign-in email is sent only
 * then). Comfortably above a typical Resend send.
 */
const MANAGE_REQUEST_MIN_MS = 1500

class ApiError extends Error {
  constructor(
    public httpStatus: number,
    public status: string,
    message: string,
  ) {
    super(message)
  }
}

type Body = Record<string, unknown>

interface Ctx {
  sql: Sql
  body: Body
  ip: string
}

let signingKey: { raw: string; key: KeyObject } | null = null

function getSigningKey(): KeyObject {
  const raw = process.env.LICENSE_SIGNING_KEY!
  if (!signingKey || signingKey.raw !== raw) signingKey = { raw, key: parseSigningKey(raw) }
  return signingKey.key
}

function manageSecret(): string {
  const secret = process.env.LICENSE_MANAGE_SECRET
  if (!secret) throw new ApiError(503, 'not_configured', 'License management is not configured.')
  return secret
}

const now = () => Math.floor(Date.now() / 1000)

function str(body: Body, field: string, max: number, required: true): string
function str(body: Body, field: string, max: number, required?: false): string | null
function str(body: Body, field: string, max: number, required = false): string | null {
  const v = body[field]
  if (v === undefined || v === null || v === '') {
    if (required) throw new ApiError(400, 'invalid_request', `${field} is required.`)
    return null
  }
  if (typeof v !== 'string' || v.length > max) {
    throw new ApiError(400, 'invalid_request', `${field} must be a string of at most ${max} characters.`)
  }
  return v.trim()
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

function activeResponse(license: LicenseRow, fingerprint: string) {
  return {
    status: 'active',
    token: signToken(buildTokenPayload(license.id, fingerprint, now()), getSigningKey()),
    licenseId: license.id,
    keyLast4: license.key_last4,
    activatedAt: iso(license.activated_at),
  }
}

const notFound = () => new ApiError(404, 'not_found', 'That license key was not found. Check it and try again.')
const revoked = () => new ApiError(403, 'revoked', 'This license has been revoked. Contact support@skyglass.dev.')

/** The license for the request's key, plus the key hash the row was found by. */
async function findLicenseForKey(ctx: Ctx): Promise<{ license: LicenseRow; keyHash: string }> {
  const key = normalizeLicenseKey(ctx.body.licenseKey)
  // A malformed key cannot exist, so it is reported the same as an unknown one.
  if (!key) throw notFound()
  const keyHash = hashLicenseKey(key)
  const license = await findByKeyHash(ctx.sql, keyHash)
  if (!license) throw notFound()
  if (license.status === 'revoked') throw revoked()
  return { license, keyHash }
}

async function checkActivationRate(ctx: Ctx) {
  if (!(await rateLimit(ctx.sql, `activate:${ctx.ip}`, ACTIVATION_LIMIT_PER_HOUR))) {
    throw new ApiError(429, 'rate_limited', 'Too many attempts. Try again in an hour.')
  }
}

async function activate(ctx: Ctx) {
  await checkActivationRate(ctx)
  const fingerprint = str(ctx.body, 'deviceFingerprint', 256, true)
  const fingerprintType = str(ctx.body, 'fingerprintType', 32, true)
  if (!(FINGERPRINT_TYPES as readonly string[]).includes(fingerprintType)) {
    throw new ApiError(400, 'invalid_request', `fingerprintType must be one of ${FINGERPRINT_TYPES.join(', ')}.`)
  }
  const mirrorId = str(ctx.body, 'mirrorId', 128)
  const appVersion = str(ctx.body, 'appVersion', 64)
  const { license, keyHash } = await findLicenseForKey(ctx)

  // Every write below is guarded by key_hash: a key rotated (reissued) or a
  // license released/revoked between the lookup and the write matches no row.
  if (license.status === 'active') {
    if (license.device_fingerprint !== fingerprint) {
      throw new ApiError(
        409,
        'bound_to_another_device',
        'This license is in use on another mirror. Release it at skyglass.dev/license first.',
      )
    }
    const [row] = (await ctx.sql`
      UPDATE licenses
      SET last_seen_at = now(), mirror_id = COALESCE(${mirrorId}, mirror_id), app_version = COALESCE(${appVersion}, app_version)
      WHERE id = ${license.id} AND key_hash = ${keyHash} AND status = 'active' AND device_fingerprint = ${fingerprint}
      RETURNING *
    `) as LicenseRow[]
    if (row) return activeResponse(row, fingerprint)
    return raceOutcome(ctx, license.id, keyHash, fingerprint)
  }

  // pending → bind. The status and key guards make a concurrent change lose cleanly.
  const rows = (await ctx.sql`
    UPDATE licenses
    SET status = 'active', device_fingerprint = ${fingerprint}, fingerprint_type = ${fingerprintType as FingerprintType},
        mirror_id = ${mirrorId}, app_version = ${appVersion}, activated_at = now(), last_seen_at = now()
    WHERE id = ${license.id} AND key_hash = ${keyHash} AND status = 'pending'
    RETURNING *
  `) as LicenseRow[]
  if (rows.length === 0) return raceOutcome(ctx, license.id, keyHash, fingerprint)
  console.log(`[License] Activated ${license.id} (${fingerprintType})`)
  return activeResponse(rows[0], fingerprint)
}

/** The answer for an activate whose guarded write matched no row (something changed concurrently). */
async function raceOutcome(ctx: Ctx, id: string, keyHash: string, fingerprint: string) {
  const current = await findById(ctx.sql, id)
  if (!current || current.key_hash !== keyHash) throw notFound()
  if (current.status === 'revoked') throw revoked()
  if (current.status === 'active' && current.device_fingerprint === fingerprint) {
    return activeResponse(current, fingerprint)
  }
  throw new ApiError(409, 'bound_to_another_device', 'This license is in use on another mirror.')
}

async function refresh(ctx: Ctx) {
  await checkActivationRate(ctx)
  const fingerprint = str(ctx.body, 'deviceFingerprint', 256, true)
  const appVersion = str(ctx.body, 'appVersion', 64)
  const { license, keyHash } = await findLicenseForKey(ctx)
  const released = () => new ApiError(409, 'released', 'This license is no longer assigned to this mirror.')
  if (license.status !== 'active' || license.device_fingerprint !== fingerprint) throw released()
  const [row] = (await ctx.sql`
    UPDATE licenses SET last_seen_at = now(), app_version = COALESCE(${appVersion}, app_version)
    WHERE id = ${license.id} AND key_hash = ${keyHash} AND status = 'active' AND device_fingerprint = ${fingerprint}
    RETURNING *
  `) as LicenseRow[]
  if (row) return activeResponse(row, fingerprint)
  // Changed since the lookup: report what it is now.
  const current = await findById(ctx.sql, license.id)
  if (!current || current.key_hash !== keyHash) throw notFound()
  if (current.status === 'revoked') throw revoked()
  throw released()
}

// ---------------------------------------------------------------------------
// Customer self-service
// ---------------------------------------------------------------------------

async function manageRequest(ctx: Ctx) {
  const secret = manageSecret()
  if (!(await rateLimit(ctx.sql, `manage-request:${ctx.ip}`, MANAGE_REQUEST_LIMIT_PER_HOUR))) {
    throw new ApiError(429, 'rate_limited', 'Too many requests. Try again in an hour.')
  }
  const email = normalizeEmail(ctx.body.email)
  if (!email) throw new ApiError(400, 'invalid_request', 'Enter a valid email address.')

  // Always the same answer in the same time, so the endpoint doesn't reveal
  // who has a license. The per-address cap (so it can't flood an inbox) is
  // counted for every address, so it costs the same either way.
  const started = Date.now()
  try {
    const withinCap = await rateLimit(ctx.sql, `manage-email:${email}`, MANAGE_REQUEST_LIMIT_PER_HOUR)
    const licenses = await findByEmail(ctx.sql, email)
    if (licenses.length > 0 && withinCap) {
      const link = `${MANAGE_URL}?token=${encodeURIComponent(createManageToken(email, secret, now()))}`
      await sendEmail({ from: LICENSE_FROM, to: email, subject: 'Manage your SkyGlass licenses', html: manageSignInEmailHtml(link) })
    }
  } finally {
    await sleep(MANAGE_REQUEST_MIN_MS - (Date.now() - started))
  }
  return { ok: true }
}

function requireManageEmail(ctx: Ctx): string {
  const email = verifyManageToken(ctx.body.token, manageSecret(), now())
  if (!email) throw new ApiError(401, 'invalid_token', 'This sign-in link is invalid or has expired. Request a new one.')
  return email
}

async function ownedLicense(ctx: Ctx, email: string): Promise<LicenseRow> {
  const license = await findById(ctx.sql, String(ctx.body.licenseId ?? ''))
  if (!license || license.email.toLowerCase() !== email) {
    throw new ApiError(404, 'not_found', 'License not found.')
  }
  return license
}

async function manageList(ctx: Ctx) {
  const email = requireManageEmail(ctx)
  const licenses = await findByEmail(ctx.sql, email)
  const used = await customerReleaseCounts(ctx.sql, licenses.map((l) => l.id))
  const remaining = licenses.map((l) => releasesRemaining(used.get(l.id) ?? 0))
  return {
    email,
    licenses: licenses.map((l, i) => ({
      id: l.id,
      keyLast4: l.key_last4,
      productId: l.product_id,
      status: l.status,
      mirrorId: l.mirror_id,
      activatedAt: iso(l.activated_at),
      lastSeenAt: iso(l.last_seen_at),
      releasesRemaining: remaining[i],
    })),
    // The limit is per license; the top-level value is the most restrictive.
    releasesRemaining: remaining.length > 0 ? Math.min(...remaining) : releasesRemaining(0),
  }
}

async function manageRelease(ctx: Ctx) {
  const email = requireManageEmail(ctx)
  const license = await ownedLicense(ctx, email)
  if (license.status === 'revoked') {
    throw new ApiError(403, 'revoked', 'This license has been revoked. Contact support@skyglass.dev.')
  }
  if (license.status === 'pending') return { ok: true } // already released
  const used = (await customerReleaseCounts(ctx.sql, [license.id])).get(license.id) ?? 0
  if (releasesRemaining(used) <= 0) {
    throw new ApiError(
      429,
      'transfer_limit',
      'This license has been moved 3 times in the past year. Contact support@skyglass.dev to move it again.',
    )
  }
  await releaseLicense(ctx.sql, license.id, 'customer')
  console.log(`[License] Released ${license.id} by customer`)
  return { ok: true }
}

async function manageReissue(ctx: Ctx) {
  const email = requireManageEmail(ctx)
  const license = await ownedLicense(ctx, email)
  if (license.status === 'revoked') {
    throw new ApiError(403, 'revoked', 'This license has been revoked. Contact support@skyglass.dev.')
  }
  if (license.status === 'active') {
    throw new ApiError(409, 'bound', 'Release this license from its mirror before getting a new key.')
  }
  if (!license.key_hash) {
    throw new ApiError(409, 'not_provisioned', 'This license comes pre-installed on your kit and has no key yet.')
  }
  const key = await assignNewKey(ctx.sql, license.id, 'pending-keyed')
  if (!key) throw new ApiError(409, 'bound', 'This license changed while you were working. Reload and try again.')
  const sent = await sendEmail({ from: LICENSE_FROM, to: license.email, subject: 'Your new SkyGlass license key', html: reissuedKeyEmailHtml(key) })
  if (sent) {
    // This email carries the license's live key, so an order confirmation
    // still pending for it must not rotate the key again.
    await ctx.sql`UPDATE licenses SET emailed_at = COALESCE(emailed_at, now()) WHERE id = ${license.id}`
  } else {
    console.error(`[License] Reissued key for ${license.id} but the email failed`)
  }
  console.log(`[License] Reissued key for ${license.id}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const ACTIONS: Record<string, (ctx: Ctx) => Promise<unknown>> = {
  activate,
  refresh,
  'manage-request': manageRequest,
  'manage-list': manageList,
  'manage-release': manageRelease,
  'manage-reissue': manageReissue,
}

function parseBody(req: VercelRequest): Body {
  // Malformed JSON makes @vercel/node's req.body getter throw; readJsonObject maps that to null.
  const body = readJsonObject(req)
  if (!body) throw new ApiError(400, 'invalid_request', 'Body must be a JSON object.')
  return body
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  const action = String(req.query.action ?? '')
  const run = ACTIONS[action]
  if (!run) {
    return res.status(404).json({ status: 'unknown_action', message: 'Unknown license action.' })
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return res.status(405).json({ status: 'method_not_allowed', message: 'Use POST.' })
  }

  const sql = getDb()
  if (!sql || !process.env.LICENSE_SIGNING_KEY) {
    console.error('[License] Not configured: DATABASE_URL and LICENSE_SIGNING_KEY are required')
    return res.status(503).json({ status: 'not_configured', message: 'The license service is not configured.' })
  }

  try {
    const result = await run({ sql, body: parseBody(req), ip: clientIp(req.headers) })
    return res.status(200).json(result)
  } catch (err) {
    if (err instanceof ApiError) {
      return res.status(err.httpStatus).json({ status: err.status, message: err.message })
    }
    console.error(`[License] ${action} failed:`, err)
    return res.status(500).json({ status: 'server_error', message: 'Something went wrong. Try again later.' })
  }
}
