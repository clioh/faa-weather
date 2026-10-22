import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { evaluatePromotion, findPromotionCode } from './_lib/checkout.js'
import { getDb } from './_lib/db.js'
import { readJsonObject } from './_lib/http.js'
import { normalizeEmail } from './_lib/license.js'
import { stripe } from './_lib/stripe.js'

/**
 * Check a promo code for the checkout UI.
 *
 *   POST { code, subtotal (cents, before discount), email? }
 *
 * Display only: create-payment-intent re-runs the same checks against its own
 * subtotal. `email` is optional; without it a code restricted to one customer
 * is accepted here and checked against the order email at payment.
 */

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
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = readJsonObject(req)
  if (!body) {
    return res.status(400).json({ valid: false, error: 'Body must be a JSON object' } as PromoResult)
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
      sql: getDb(),
    })

    if (!result.ok) {
      return res.status(200).json({ valid: false, error: result.error } as PromoResult)
    }

    const promo = result.value
    console.log(
      `[Promo] Valid code "${promo.code}": ${promo.discountType === 'percent' ? `${promo.percentOff}% off` : `$${(promo.amountOff ?? 0) / 100} off`}`,
    )

    return res.status(200).json({ valid: true, ...promo } as PromoResult)
  } catch (error) {
    console.error('[Promo] Error:', error)

    if (error instanceof Stripe.errors.StripeError) {
      return res.status(400).json({ valid: false, error: 'Could not check that promo code' } as PromoResult)
    }

    return res.status(500).json({ valid: false, error: 'Failed to validate promo code' } as PromoResult)
  }
}
