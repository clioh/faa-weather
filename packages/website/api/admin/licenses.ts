import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  assignNewKey,
  customerReleaseCounts,
  findByEmail,
  findById,
  findByOrder,
  getDb,
  iso,
  releaseLicense,
  releasesRemaining,
  type LicenseRow,
  type Sql,
} from '../_lib/db.js'
import { requireAdmin } from '../_lib/admin.js'
import { readJsonObject } from '../_lib/http.js'

/**
 * Support/fulfilment API for licenses (docs/LICENSING.md).
 *
 *   GET  ?email=… | ?orderId=… | ?licenseId=…   search
 *   POST { action: 'provision', licenseId }      key an unkeyed kit license; plaintext returned once
 *   POST { action: 'provision', licenseId, rekey: true }
 *                                                replace the key of a keyed *pending* license (e.g. the
 *                                                provision response was lost); old key dies, new plaintext once
 *   POST { action: 'revoke', licenseId }         status → revoked
 *   POST { action: 'reset', licenseId }          unbind (or un-revoke) → pending; doesn't count toward the transfer limit
 *
 * Auth: Authorization: Bearer $ADMIN_PASSWORD (api/_lib/admin.ts).
 */

async function present(sql: Sql, licenses: LicenseRow[]) {
  const used = await customerReleaseCounts(
    sql,
    licenses.map((l) => l.id)
  )
  return licenses.map((l) => ({
    id: l.id,
    keyLast4: l.key_last4,
    keyed: l.key_hash !== null,
    email: l.email,
    orderId: l.order_id,
    orderSeq: l.order_seq,
    productId: l.product_id,
    status: l.status,
    deviceFingerprint: l.device_fingerprint,
    fingerprintType: l.fingerprint_type,
    mirrorId: l.mirror_id,
    appVersion: l.app_version,
    activatedAt: iso(l.activated_at),
    lastSeenAt: iso(l.last_seen_at),
    createdAt: iso(l.created_at),
    customerReleasesLastYear: used.get(l.id) ?? 0,
    releasesRemaining: releasesRemaining(used.get(l.id) ?? 0),
  }))
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!(await requireAdmin(req, res))) return

  const sql = getDb()
  if (!sql) {
    return res.status(503).json({ status: 'not_configured', error: 'DATABASE_URL is not set' })
  }

  try {
    if (req.method === 'GET') {
      const email = first(req.query.email)
      const orderId = first(req.query.orderId)
      const licenseId = first(req.query.licenseId)
      let rows: LicenseRow[]
      if (email) rows = await findByEmail(sql, email.trim())
      else if (orderId) rows = await findByOrder(sql, orderId.trim())
      else if (licenseId) {
        const row = await findById(sql, licenseId.trim())
        rows = row ? [row] : []
      } else {
        return res.status(400).json({ error: 'Pass email, orderId or licenseId' })
      }
      return res.status(200).json({ licenses: await present(sql, rows) })
    }

    const body = readJsonObject(req)
    if (!body) {
      return res
        .status(400)
        .json({ status: 'invalid_request', error: 'Body must be a JSON object' })
    }
    const action = body.action
    const license = await findById(sql, String(body.licenseId ?? ''))
    if (!license) {
      return res.status(404).json({ status: 'not_found', error: 'License not found' })
    }

    switch (action) {
      case 'provision': {
        if (license.status === 'revoked') {
          return res.status(409).json({ status: 'revoked', error: 'License is revoked' })
        }
        const rekey = body.rekey === true
        if (license.key_hash && !rekey) {
          return res.status(409).json({
            status: 'already_keyed',
            error: `License already has a key (…${license.key_last4}). Pass rekey: true to replace it if it was never written to a card.`,
          })
        }
        if (license.key_hash && license.status !== 'pending') {
          return res.status(409).json({
            status: 'bound',
            error: 'License is active on a mirror. Reset it before rekeying.',
          })
        }
        const key = await assignNewKey(
          sql,
          license.id,
          license.key_hash ? 'pending-keyed' : 'unkeyed'
        )
        if (!key) {
          return res.status(409).json({
            status: 'conflict',
            error: 'License changed concurrently. Look it up and try again.',
          })
        }
        console.log(`[Admin] ${license.key_hash ? 'Rekeyed' : 'Provisioned key for'} ${license.id}`)
        return res
          .status(200)
          .json({ licenseId: license.id, licenseKey: key, keyLast4: key.slice(-4) })
      }

      case 'revoke': {
        await sql`UPDATE licenses SET status = 'revoked' WHERE id = ${license.id}`
        console.log(`[Admin] Revoked ${license.id}`)
        break
      }

      case 'reset': {
        await releaseLicense(sql, license.id, 'admin')
        console.log(`[Admin] Reset ${license.id}`)
        break
      }

      default:
        return res.status(400).json({ error: 'action must be provision, revoke or reset' })
    }

    const updated = await findById(sql, license.id)
    return res
      .status(200)
      .json({ ok: true, license: (await present(sql, updated ? [updated] : []))[0] ?? null })
  } catch (error) {
    console.error('[Admin] License error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
