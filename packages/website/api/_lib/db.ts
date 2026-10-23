/**
 * Neon Postgres access for licensing (schema: db/schema.sql).
 *
 * Uses the HTTP driver: one round trip per query, no connection to manage in
 * a serverless function. Lives under api/_lib/ so Vercel does not deploy it.
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import {
  RELEASE_LIMIT,
  RELEASE_WINDOW_DAYS,
  generateLicenseKey,
  hashLicenseKey,
  keyLast4,
  type PlannedLicense,
} from './license.js'

export type Sql = NeonQueryFunction<false, false>

let cached: { url: string; sql: Sql } | null = null

/** The query function, or null when DATABASE_URL is not configured. */
export function getDb(): Sql | null {
  const url = process.env.DATABASE_URL
  if (!url) return null
  if (!cached || cached.url !== url) cached = { url, sql: neon(url) }
  return cached.sql
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type LicenseStatus = 'pending' | 'active' | 'revoked'

export interface LicenseRow {
  id: string
  key_hash: string | null
  key_last4: string | null
  email: string
  order_id: string
  order_seq: number
  product_id: string
  status: LicenseStatus
  device_fingerprint: string | null
  fingerprint_type: string | null
  mirror_id: string | null
  app_version: string | null
  activated_at: string | null
  last_seen_at: string | null
  created_at: string
  /** When the order confirmation (or a reissue email) carrying this license was sent. */
  emailed_at: string | null
  /** Lease held by a webhook delivery while it sends the confirmation. */
  email_claimed_at: string | null
}

export function iso(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null
  return new Date(value).toISOString()
}

// ---------------------------------------------------------------------------
// Rate limiting (best-effort, fixed hourly windows)
// ---------------------------------------------------------------------------

/**
 * Count a hit against `bucket` and report whether it is within `limit` per
 * hour. Never throws: if the limiter itself fails, the request is allowed.
 */
export async function rateLimit(sql: Sql, bucket: string, limit: number): Promise<boolean> {
  try {
    const rows = (await sql`
      INSERT INTO rate_limits (bucket, window_start, count)
      VALUES (${bucket}, date_trunc('hour', now()), 1)
      ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limits.count + 1
      RETURNING count
    `) as { count: number }[]
    // Opportunistic cleanup of old windows.
    if (Math.random() < 0.02) {
      await sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`
    }
    return Number(rows[0]?.count ?? 0) <= limit
  } catch (err) {
    console.error('[License] Rate limiter error (allowing request):', (err as Error).message)
    return true
  }
}

/**
 * Whether `bucket` is already over `limit` in the current hour, without
 * counting a hit. Never throws: if the check fails, reports false.
 */
export async function rateLimitExceeded(sql: Sql, bucket: string, limit: number): Promise<boolean> {
  try {
    const rows = (await sql`
      SELECT count FROM rate_limits WHERE bucket = ${bucket} AND window_start = date_trunc('hour', now())
    `) as { count: number }[]
    return Number(rows[0]?.count ?? 0) >= limit
  } catch (err) {
    console.error('[License] Rate limiter error (allowing request):', (err as Error).message)
    return false
  }
}

// ---------------------------------------------------------------------------
// License queries
// ---------------------------------------------------------------------------

export async function findByKeyHash(sql: Sql, keyHash: string): Promise<LicenseRow | null> {
  const rows = (await sql`SELECT * FROM licenses WHERE key_hash = ${keyHash}`) as LicenseRow[]
  return rows[0] ?? null
}

export async function findById(sql: Sql, id: string): Promise<LicenseRow | null> {
  if (!isUuid(id)) return null
  const rows = (await sql`SELECT * FROM licenses WHERE id = ${id}`) as LicenseRow[]
  return rows[0] ?? null
}

export async function findByEmail(sql: Sql, email: string): Promise<LicenseRow[]> {
  return (await sql`
    SELECT * FROM licenses WHERE lower(email) = lower(${email}) ORDER BY created_at, order_seq
  `) as LicenseRow[]
}

export async function findByOrder(sql: Sql, orderId: string): Promise<LicenseRow[]> {
  return (await sql`SELECT * FROM licenses WHERE order_id = ${orderId} ORDER BY order_seq`) as LicenseRow[]
}

/** Customer releases for each license inside the rolling window. */
export async function customerReleaseCounts(
  sql: Sql,
  licenseIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (licenseIds.length === 0) return counts
  const rows = (await sql`
    SELECT license_id, count(*)::int AS n
    FROM license_releases
    WHERE license_id = ANY(${licenseIds}::uuid[])
      AND actor = 'customer'
      AND released_at > now() - make_interval(days => ${RELEASE_WINDOW_DAYS})
    GROUP BY license_id
  `) as { license_id: string; n: number }[]
  for (const r of rows) counts.set(r.license_id, Number(r.n))
  return counts
}

export function releasesRemaining(used: number): number {
  return Math.max(0, RELEASE_LIMIT - used)
}

/**
 * Unbind a license (status → pending) and record the release. Returns false
 * when the license was not bound. For actor 'admin' a revoked license is also
 * reset to pending.
 */
export async function releaseLicense(
  sql: Sql,
  id: string,
  actor: 'customer' | 'admin'
): Promise<boolean> {
  const allowed = actor === 'admin' ? ['active', 'revoked'] : ['active']
  const rows = (await sql`
    WITH old AS (
      SELECT id, device_fingerprint FROM licenses
      WHERE id = ${id} AND status = ANY(${allowed}::text[])
      FOR UPDATE
    ),
    upd AS (
      UPDATE licenses l
      SET status = 'pending', device_fingerprint = NULL, fingerprint_type = NULL,
          mirror_id = NULL, activated_at = NULL
      FROM old WHERE l.id = old.id
      RETURNING l.id
    ),
    rel AS (
      INSERT INTO license_releases (license_id, device_fingerprint, actor)
      SELECT old.id, old.device_fingerprint, ${actor} FROM old
      WHERE old.device_fingerprint IS NOT NULL
      RETURNING license_id
    )
    SELECT id FROM upd
  `) as { id: string }[]
  return rows.length > 0
}

/**
 * Give a license a fresh key, killing any previous one. `onlyIf` restricts
 * which licenses qualify: 'unkeyed' for kit provisioning, 'pending-keyed'
 * for customer reissue. Returns the plaintext key once, or null.
 */
export async function assignNewKey(
  sql: Sql,
  id: string,
  onlyIf: 'unkeyed' | 'pending-keyed'
): Promise<string | null> {
  const key = generateLicenseKey()
  const hash = hashLicenseKey(key)
  const last4 = keyLast4(key)
  const rows = (
    onlyIf === 'unkeyed'
      ? await sql`
        UPDATE licenses SET key_hash = ${hash}, key_last4 = ${last4}
        WHERE id = ${id} AND key_hash IS NULL AND status <> 'revoked'
        RETURNING id`
      : await sql`
        UPDATE licenses SET key_hash = ${hash}, key_last4 = ${last4}
        WHERE id = ${id} AND key_hash IS NOT NULL AND status = 'pending'
        RETURNING id`
  ) as { id: string }[]
  return rows.length > 0 ? key : null
}

export interface CreatedLicense {
  id: string
  orderSeq: number
  productId: string
  /** Plaintext key, only for rows keyed at purchase. */
  key: string | null
}

/**
 * Insert one row per planned license. Idempotent on (order_id, order_seq):
 * returns only the rows actually inserted by this call.
 */
export async function createOrderLicenses(
  sql: Sql,
  orderId: string,
  email: string,
  planned: (PlannedLicense & { keyed: boolean })[]
): Promise<CreatedLicense[]> {
  if (planned.length === 0) return []
  const keys = new Map<number, string>()
  const values: string[] = []
  const params: unknown[] = []
  for (const p of planned) {
    const key = p.keyed ? generateLicenseKey() : null
    if (key) keys.set(p.orderSeq, key)
    const base = params.length
    params.push(
      key ? hashLicenseKey(key) : null,
      key ? keyLast4(key) : null,
      email,
      orderId,
      p.orderSeq,
      p.productId
    )
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, 'pending')`
    )
  }
  const rows = (await sql.query(
    `INSERT INTO licenses (key_hash, key_last4, email, order_id, order_seq, product_id, status)
     VALUES ${values.join(', ')}
     ON CONFLICT (order_id, order_seq) DO NOTHING
     RETURNING id, order_seq, product_id`,
    params
  )) as { id: string; order_seq: number; product_id: string }[]
  return rows
    .map((r) => ({
      id: r.id,
      orderSeq: Number(r.order_seq),
      productId: r.product_id,
      key: keys.get(Number(r.order_seq)) ?? null,
    }))
    .sort((a, b) => a.orderSeq - b.orderSeq)
}

/** Revoke every license on an order. Returns how many changed. */
export async function revokeOrderLicenses(sql: Sql, orderId: string): Promise<number> {
  const rows = (await sql`
    UPDATE licenses SET status = 'revoked' WHERE order_id = ${orderId} AND status <> 'revoked' RETURNING id
  `) as { id: string }[]
  return rows.length
}

/** Revoke specific licenses, only if they belong to `orderId`. Returns the ids that changed. */
export async function revokeLicensesOnOrder(
  sql: Sql,
  orderId: string,
  ids: string[]
): Promise<string[]> {
  const valid = ids.filter(isUuid)
  if (valid.length === 0) return []
  const rows = (await sql`
    UPDATE licenses SET status = 'revoked'
    WHERE order_id = ${orderId} AND id = ANY(${valid}::uuid[]) AND status <> 'revoked'
    RETURNING id
  `) as { id: string }[]
  return rows.map((r) => r.id)
}

// ---------------------------------------------------------------------------
// Order confirmation email bookkeeping
// ---------------------------------------------------------------------------

/** How long a webhook delivery may hold the email lease before another may take over. */
const EMAIL_CLAIM_SECONDS = 120

/**
 * Claim the order's licenses that still need a confirmation email (not yet
 * emailed, not revoked, no live claim by a concurrent delivery). All matching
 * rows are claimed in one statement, so two deliveries never both send.
 */
export async function claimUnemailedLicenses(sql: Sql, orderId: string): Promise<LicenseRow[]> {
  return (await sql`
    UPDATE licenses SET email_claimed_at = now()
    WHERE order_id = ${orderId} AND emailed_at IS NULL AND status <> 'revoked'
      AND (email_claimed_at IS NULL OR email_claimed_at < now() - make_interval(secs => ${EMAIL_CLAIM_SECONDS}))
    RETURNING *
  `) as LicenseRow[]
}

/** Record a successful send and drop the lease. */
export async function markLicensesEmailed(sql: Sql, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await sql`
    UPDATE licenses SET emailed_at = COALESCE(emailed_at, now()), email_claimed_at = NULL
    WHERE id = ANY(${ids}::uuid[])
  `
}

/** Drop the lease after a failed send so the next delivery retries at once. */
export async function releaseEmailClaim(sql: Sql, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await sql`UPDATE licenses SET email_claimed_at = NULL WHERE id = ANY(${ids}::uuid[]) AND emailed_at IS NULL`
}

// ---------------------------------------------------------------------------
// Promotion code redemptions
// ---------------------------------------------------------------------------

/**
 * PaymentIntents don't redeem Stripe promotion codes, so Stripe's
 * times_redeemed never moves for our orders. The webhook records each paid
 * order that used a code here, and checkout counts these rows against the
 * code's (and coupon's) max_redemptions.
 */
export async function recordPromoRedemption(
  sql: Sql,
  orderId: string,
  promotionCodeId: string,
  couponId: string | null
): Promise<void> {
  await sql`
    INSERT INTO promo_redemptions (order_id, promotion_code_id, coupon_id)
    VALUES (${orderId}, ${promotionCodeId}, ${couponId})
    ON CONFLICT (order_id) DO NOTHING
  `
}

export async function countPromoRedemptions(
  sql: Sql,
  promotionCodeId: string,
  couponId: string | null
): Promise<{ promotionCode: number; coupon: number }> {
  const rows = (await sql`
    SELECT
      count(*) FILTER (WHERE promotion_code_id = ${promotionCodeId})::int AS promotion_code,
      count(*) FILTER (WHERE coupon_id IS NOT NULL AND coupon_id = ${couponId})::int AS coupon
    FROM promo_redemptions
    WHERE promotion_code_id = ${promotionCodeId} OR coupon_id = ${couponId}
  `) as { promotion_code: number; coupon: number }[]
  return {
    promotionCode: Number(rows[0]?.promotion_code ?? 0),
    coupon: Number(rows[0]?.coupon ?? 0),
  }
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
}
