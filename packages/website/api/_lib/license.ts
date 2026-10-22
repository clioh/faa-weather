/**
 * SkyGlass licensing: pure, framework-free logic (see docs/LICENSING.md).
 *
 * Key generation and normalization, activation token signing/verification,
 * manage sign-in tokens, and order → license row expansion. No database or
 * network access here so everything is unit-testable.
 *
 * Lives under api/_lib/ so Vercel does not deploy it as a function.
 */

import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomInt,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from 'node:crypto'
import { CATALOG, PRODUCT_IDS, type ProductId } from '../../shared/catalog.js'

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/** Every product carries one license per unit purchased. */
export const LICENSED_PRODUCTS = PRODUCT_IDS
export type LicensedProduct = ProductId

/** Digital products are keyed at purchase; physical kits are keyed at fulfilment. */
export const KEYED_AT_PURCHASE: readonly string[] = PRODUCT_IDS.filter((id) => !CATALOG[id].physical)

export function isLicensedProduct(productId: string): productId is LicensedProduct {
  return (LICENSED_PRODUCTS as readonly string[]).includes(productId)
}

// ---------------------------------------------------------------------------
// Policy constants
// ---------------------------------------------------------------------------

export const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
export const MANAGE_TOKEN_TTL_SECONDS = 30 * 60
export const RELEASE_LIMIT = 3
export const RELEASE_WINDOW_DAYS = 365
export const FINGERPRINT_TYPES = ['pi_serial', 'machine_id'] as const
export type FingerprintType = (typeof FINGERPRINT_TYPES)[number]

// ---------------------------------------------------------------------------
// License keys
// ---------------------------------------------------------------------------

export const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const KEY_RE = /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/

/** XXXX-XXXX-XXXX-XXXX from a 32-letter alphabet: 16 chars × 5 bits = 80 bits. */
export function generateLicenseKey(): string {
  let raw = ''
  for (let i = 0; i < 16; i++) raw += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]
  return raw.match(/.{4}/g)!.join('-')
}

/**
 * Strip whitespace and dashes, uppercase, re-insert a dash every 4 chars,
 * then validate. Returns null for anything that is not a well-formed key.
 */
export function normalizeLicenseKey(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 64) return null
  const stripped = input.replace(/[\s-]/g, '').toUpperCase()
  const dashed = (stripped.match(/.{1,4}/g) ?? []).join('-')
  return KEY_RE.test(dashed) ? dashed : null
}

/** sha256 hex of the normalized key. The only form of a key the server stores. */
export function hashLicenseKey(normalizedKey: string): string {
  return createHash('sha256').update(normalizedKey, 'utf8').digest('hex')
}

export function keyLast4(normalizedKey: string): string {
  return normalizedKey.slice(-4)
}

// ---------------------------------------------------------------------------
// base64url helpers
// ---------------------------------------------------------------------------

export function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url')
}

export function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url')
}

// ---------------------------------------------------------------------------
// Activation tokens (Ed25519)
// ---------------------------------------------------------------------------

export interface TokenPayload {
  v: 1
  lid: string
  fp: string
  iat: number
  exp: number
}

/**
 * Parse LICENSE_SIGNING_KEY: an Ed25519 PKCS8 PEM, base64-encoded onto one
 * line. A raw PEM (with real or "\n"-escaped newlines) is accepted too.
 */
export function parseSigningKey(value: string): KeyObject {
  const trimmed = value.trim()
  const pem = trimmed.startsWith('-----BEGIN')
    ? trimmed.replace(/\\n/g, '\n')
    : Buffer.from(trimmed, 'base64').toString('utf8')
  const key = createPrivateKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('LICENSE_SIGNING_KEY is not an Ed25519 private key')
  }
  return key
}

export function buildTokenPayload(licenseId: string, fingerprint: string, nowSeconds: number): TokenPayload {
  return { v: 1, lid: licenseId, fp: fingerprint, iat: nowSeconds, exp: nowSeconds + TOKEN_TTL_SECONDS }
}

/** base64url(payloadJson) + "." + base64url(ed25519(payloadJsonBytes)) */
export function signToken(payload: TokenPayload, privateKey: KeyObject): string {
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const sig = sign(null, json, privateKey)
  return `${b64url(json)}.${b64url(sig)}`
}

/**
 * Verify a token the way the mirror does: signature, fingerprint, expiry.
 * Used by tests and kept here as the reference implementation.
 */
export function verifyToken(
  token: string,
  publicKey: KeyObject | string,
  fingerprint: string,
  nowSeconds: number,
): TokenPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const json = fromB64url(parts[0])
  const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey
  let ok = false
  try {
    ok = verify(null, json, key, fromB64url(parts[1]))
  } catch {
    return null
  }
  if (!ok) return null
  let payload: TokenPayload
  try {
    payload = JSON.parse(json.toString('utf8'))
  } catch {
    return null
  }
  if (payload.v !== 1 || payload.fp !== fingerprint || !(nowSeconds < payload.exp)) return null
  return payload
}

// ---------------------------------------------------------------------------
// Manage sign-in tokens (HMAC-SHA256)
// ---------------------------------------------------------------------------

export interface ManageTokenPayload {
  email: string
  exp: number
}

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const email = input.trim().toLowerCase()
  if (email.length < 3 || email.length > 254) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

function manageMac(body: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(body, 'utf8').digest()
}

export function createManageToken(email: string, secret: string, nowSeconds: number): string {
  const payload: ManageTokenPayload = { email: email.toLowerCase(), exp: nowSeconds + MANAGE_TOKEN_TTL_SECONDS }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${b64url(manageMac(body, secret))}`
}

/** Returns the (lowercased) email when the token is authentic and unexpired. */
export function verifyManageToken(token: unknown, secret: string, nowSeconds: number): string | null {
  if (typeof token !== 'string' || token.length > 2048) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const expected = manageMac(parts[0], secret)
  const given = fromB64url(parts[1])
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  let payload: ManageTokenPayload
  try {
    payload = JSON.parse(fromB64url(parts[0]).toString('utf8'))
  } catch {
    return null
  }
  if (typeof payload.email !== 'string' || typeof payload.exp !== 'number') return null
  if (!(nowSeconds < payload.exp)) return null
  return payload.email.toLowerCase()
}

// ---------------------------------------------------------------------------
// Order → license rows
// ---------------------------------------------------------------------------

export interface OrderItem {
  productId: string
  quantity: number
}

export interface PlannedLicense {
  orderSeq: number
  productId: LicensedProduct
}

/**
 * One row per licensed unit, numbered 1..N in line-item order. Deterministic
 * for the same items, which is what makes (order_id, order_seq) idempotent.
 */
export function expandOrderLicenses(items: OrderItem[]): PlannedLicense[] {
  const rows: PlannedLicense[] = []
  for (const item of items) {
    if (!item || !isLicensedProduct(item.productId)) continue
    const qty = Math.max(0, Math.min(100, Math.floor(Number(item.quantity) || 0)))
    for (let i = 0; i < qty; i++) rows.push({ orderSeq: rows.length + 1, productId: item.productId })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/** Client IP: first hop of x-forwarded-for, else x-real-ip. */
export function clientIp(headers: Record<string, string | string[] | undefined>): string {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const xff = first(headers['x-forwarded-for'])
  if (xff) {
    const hop = xff.split(',')[0].trim()
    if (hop) return hop
  }
  return first(headers['x-real-ip'])?.trim() || 'unknown'
}

/** Constant-time comparison of two secrets of any length. */
export function secretsEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest()
  const db = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(da, db)
}
