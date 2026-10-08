import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover',
})

interface ValidatePromoBody {
  code: string
  subtotal: number // in cents
}

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

  try {
    const { code, subtotal } = req.body as ValidatePromoBody

    if (!code || typeof code !== 'string') {
      return res.status(400).json({
        valid: false,
        error: 'Promo code is required',
      } as PromoResult)
    }

    const normalizedCode = code.trim().toUpperCase()

    // Search for promotion codes matching the input
    const promotionCodes = await stripe.promotionCodes.list({
      code: normalizedCode,
      active: true,
      limit: 1,
    })

    if (promotionCodes.data.length === 0) {
      return res.status(200).json({
        valid: false,
        error: 'Invalid promo code',
      } as PromoResult)
    }

    const promotionCode = promotionCodes.data[0]
    const coupon = promotionCode.coupon

    // Check if coupon is still valid
    if (!coupon.valid) {
      return res.status(200).json({
        valid: false,
        error: 'This promo code has expired',
      } as PromoResult)
    }

    // Check redemption limits
    if (promotionCode.max_redemptions && promotionCode.times_redeemed >= promotionCode.max_redemptions) {
      return res.status(200).json({
        valid: false,
        error: 'This promo code has reached its usage limit',
      } as PromoResult)
    }

    // Check expiration
    if (promotionCode.expires_at && promotionCode.expires_at < Math.floor(Date.now() / 1000)) {
      return res.status(200).json({
        valid: false,
        error: 'This promo code has expired',
      } as PromoResult)
    }

    // Check minimum amount requirement
    if (coupon.minimum_amount && subtotal < coupon.minimum_amount) {
      const minAmount = (coupon.minimum_amount / 100).toFixed(2)
      return res.status(200).json({
        valid: false,
        error: `Minimum order of $${minAmount} required for this code`,
      } as PromoResult)
    }

    // Calculate discount amount
    let discountAmount = 0
    let discountType: 'percent' | 'amount' = 'percent'

    if (coupon.percent_off) {
      discountAmount = Math.round(subtotal * (coupon.percent_off / 100))
      discountType = 'percent'
    } else if (coupon.amount_off) {
      discountAmount = Math.min(coupon.amount_off, subtotal) // Don't discount more than subtotal
      discountType = 'amount'
    }

    console.log(`[Promo] Valid code "${normalizedCode}": ${discountType === 'percent' ? `${coupon.percent_off}% off` : `$${(coupon.amount_off || 0) / 100} off`}`)

    return res.status(200).json({
      valid: true,
      promotionCodeId: promotionCode.id,
      couponId: coupon.id,
      code: normalizedCode,
      discountType,
      percentOff: coupon.percent_off || undefined,
      amountOff: coupon.amount_off || undefined,
      discountAmount,
      name: coupon.name || undefined,
    } as PromoResult)
  } catch (error) {
    console.error('[Promo] Error:', error)

    if (error instanceof Stripe.errors.StripeError) {
      return res.status(400).json({
        valid: false,
        error: error.message,
      } as PromoResult)
    }

    return res.status(500).json({
      valid: false,
      error: 'Failed to validate promo code',
    } as PromoResult)
  }
}
