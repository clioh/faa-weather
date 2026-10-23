import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { evaluatePromotion, findPromotionCode } from './_lib/checkout.js'
import { getDb, rateLimit } from './_lib/db.js'
import { readJsonObject } from './_lib/http.js'
import { clientIp, normalizeEmail } from './_lib/license.js'
import { stripe } from './_lib/stripe.js'

/**
 * Check a promo code for the checkout UI.
 *
 *   POST { code, subtotal (cents, before discount), email? }
 *
 * Display only: create-payment-intent re-runs the same checks against its own
 * subtotal. `email` is optional; without it a code restricted to one customer
 * is accepted here and checked against the order email at payment.
 *
 * Rate-limited per IP (PROMO_CHECKS_PER_HOUR, Postgres) so codes can't be
 * guessed by brute force and each guess doesn't cost a Stripe call. Without
 * DATABASE_URL only the Vercel WAF rule (firewall/rate-limits.json) applies.
 */

/** Promo checks per IP per hour. A buyer tries a code or two; this leaves room for typos. */
const PROMO_CHECKS_PER_HOUR = 20

interface PromoResult {
  valid: boolean
  promotionCodeId?: string
  couponId?: string
  code?: string
  discountType?: 'percent' | 'amount'
  percentOff?: number
  amountOff?: number
  discountAmount?: number // calculated discount in cents
  name?: string
  error?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const sql = getDb()
  if (sql && !(await rateLimit(sql, `promo:${clientIp(req.headers)}`, PROMO_CHECKS_PER_HOUR))) {
    return res.status(429).json({
      valid: false,
      error: 'Too many promo code attempts. Please try again in an hour.',
    } as PromoResult)
  }

  const body = readJsonObject(req)
  if (!body) {
    return res
      .status(400)
      .json({ valid: false, error: 'Body must be a JSON object' } as PromoResult)
  }

  const { code, subtotal } = body
  if (!code || typeof code !== 'string' || code.length > 64) {
    return res.status(400).json({ valid: false, error: 'Promo code is required' } as PromoResult)
  }
  if (typeof subtotal !== 'number' || !Number.isInteger(subtotal) || subtotal < 0) {
    return res.status(400).json({ valid: false, error: 'Invalid subtotal' } as PromoResult)
  }
  const email = body.email === undefined ? undefined : (normalizeEmail(body.email) ?? undefined)

  try {
    const normalizedCode = code.trim().toUpperCase()
    const result = await evaluatePromotion(await findPromotionCode(stripe, normalizedCode), {
      subtotal,
      email,
      sql,
    })

    if (!result.ok) {
      return res.status(200).json({ valid: false, error: result.error } as PromoResult)
    }

    const promo = result.value
    console.log(
      `[Promo] Valid code "${promo.code}": ${promo.discountType === 'percent' ? `${promo.percentOff}% off` : `$${(promo.amountOff ?? 0) / 100} off`}`
    )

    return res.status(200).json({ valid: true, ...promo } as PromoResult)
  } catch (error) {
    console.error('[Promo] Error:', error)

    if (error instanceof Stripe.errors.StripeError) {
      return res
        .status(400)
        .json({ valid: false, error: 'Could not check that promo code' } as PromoResult)
    }

    return res
      .status(500)
      .json({ valid: false, error: 'Failed to validate promo code' } as PromoResult)
  }
}
