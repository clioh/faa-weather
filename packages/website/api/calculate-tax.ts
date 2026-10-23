import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import {
  calculateCartTax,
  isTaxLocationError,
  priceCart,
  resolveTaxAddress,
} from './_lib/checkout.js'
import { getDb, rateLimit } from './_lib/db.js'
import { readJsonObject } from './_lib/http.js'
import { clientIp } from './_lib/license.js'
import { stripe } from './_lib/stripe.js'

/**
 * Sales tax estimate for the checkout UI, before any promo discount.
 *
 *   POST { items: [{ productId, quantity }], shipping?: {line1, line2?, city, state, postal_code, country},
 *          billingAddress?: { postal_code, country: 'US' } }
 *
 * Display only: create-payment-intent recomputes tax itself with the same
 * helper (after the discount) and ignores any calculationId the client sends.
 *
 * Rate-limited per IP (TAX_ESTIMATES_PER_HOUR, Postgres) because every call is
 * a Stripe Tax calculation. Over the limit it answers 429 with `fallback: true`,
 * so checkout shows the fallback-rate estimate and carries on (the real tax is
 * computed at payment). Without DATABASE_URL only the Vercel WAF rule applies.
 */

/** Tax estimates per IP per hour: one per address change at checkout. */
const TAX_ESTIMATES_PER_HOUR = 60
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const sql = getDb()
  if (sql && !(await rateLimit(sql, `tax:${clientIp(req.headers)}`, TAX_ESTIMATES_PER_HOUR))) {
    return res.status(429).json({ error: 'Too many tax estimates', fallback: true })
  }

  const body = readJsonObject(req)
  if (!body) {
    return res.status(400).json({ error: 'Body must be a JSON object' })
  }

  const priced = priceCart(body.items)
  if (!priced.ok) {
    return res.status(400).json({ error: priced.error })
  }
  const cart = priced.value

  const taxAddress = resolveTaxAddress(cart.ships, body.shipping, body.billingAddress)
  if (!taxAddress.ok) {
    return res.status(400).json({
      error: cart.ships
        ? 'Shipping address required for tax calculation'
        : 'A valid US ZIP code is required for tax calculation',
    })
  }

  try {
    const { calculation, tax } = await calculateCartTax(stripe, cart, 0, taxAddress.value)
    const total = cart.subtotal + cart.shippingCost + tax

    // Get tax breakdown by jurisdiction
    const taxBreakdown =
      calculation.tax_breakdown?.map((tb) => ({
        amount: tb.amount,
        jurisdiction: [tb.tax_rate_details?.state, tb.tax_rate_details?.country]
          .filter(Boolean)
          .join(', '),
        taxType: tb.tax_rate_details?.tax_type || 'sales_tax',
        rate: tb.tax_rate_details?.percentage_decimal
          ? parseFloat(tb.tax_rate_details.percentage_decimal)
          : 0,
      })) || []

    const a = taxAddress.value.address
    console.log(
      `[Tax] Estimated for ${[a.city, a.state, a.postal_code].filter(Boolean).join(' ')}: $${(tax / 100).toFixed(2)} tax`
    )

    return res.status(200).json({
      calculationId: calculation.id,
      subtotal: cart.subtotal,
      shipping: cart.shippingCost,
      taxAmount: tax,
      total,
      taxBreakdown,
      // Include expires_at so frontend knows when to recalculate
      expiresAt: calculation.expires_at,
    })
  } catch (error) {
    console.error('[Tax] Error:', error)

    // The buyer's address/ZIP could not be located: let them correct it.
    if (isTaxLocationError(error)) {
      return res
        .status(400)
        .json({ error: 'We could not verify that address for sales tax. Please check it.' })
    }
    if (error instanceof Stripe.errors.StripeError) {
      // Any other Stripe Tax failure (e.g. tax_not_active): the frontend and
      // create-payment-intent use the fallback rate.
      return res.status(502).json({ error: 'Tax calculation not available', fallback: true })
    }

    return res.status(500).json({ error: 'Internal server error', fallback: true })
  }
}
