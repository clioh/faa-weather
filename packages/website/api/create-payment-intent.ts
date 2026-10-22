import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { FALLBACK_TAX_RATE, parseBillingAddress } from '../shared/catalog.js'
import {
  MIN_CHARGE_CENTS,
  calculateCartTax,
  evaluatePromotion,
  isTaxLocationError,
  parsePostalAddress,
  priceCart,
  resolveTaxAddress,
  retrievePromotionCode,
  type PromoDiscount,
} from './_lib/checkout.js'
import { getDb, rateLimit } from './_lib/db.js'
import { readJsonObject } from './_lib/http.js'
import { clientIp, normalizeEmail } from './_lib/license.js'
import { stripe } from './_lib/stripe.js'

/**
 * Create the PaymentIntent for a checkout.
 *
 *   POST { items: [{ productId, quantity }], email,
 *          shipping?: { name, address: {line1, line2?, city, state, postal_code, country} },  // kit carts
 *          billingAddress?: { postal_code, country: 'US' },                                   // license-only carts
 *          promotionCodeId? }
 *
 * Everything that sets the amount is computed here: prices from the catalog,
 * the promo discount (every restriction re-checked), shipping, and sales tax
 * from Stripe Tax on the address being charged. A `taxCalculationId` from the
 * client is ignored.
 */

/** PaymentIntents per IP per hour (card-testing brake). */
const PAYMENT_INTENTS_PER_HOUR = 20

const formatUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`

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

  const sql = getDb()
  if (sql && !(await rateLimit(sql, `payment-intent:${clientIp(req.headers)}`, PAYMENT_INTENTS_PER_HOUR))) {
    return res.status(429).json({ error: 'Too many checkout attempts. Please try again in an hour.' })
  }

  const body = readJsonObject(req)
  if (!body) {
    return res.status(400).json({ error: 'Body must be a JSON object' })
  }

  try {
    const priced = priceCart(body.items)
    if (!priced.ok) {
      return res.status(400).json({ error: priced.error })
    }
    const cart = priced.value

    // Licenses are emailed, so an email is required for every order
    const email = normalizeEmail(body.email)
    if (!email) {
      return res.status(400).json({ error: 'Email required' })
    }

    // Tax is charged on the shipping address when anything ships, else on the billing ZIP.
    const shippingBody = (body.shipping && typeof body.shipping === 'object' ? body.shipping : {}) as {
      name?: unknown
      address?: unknown
    }
    const shippingName = typeof shippingBody.name === 'string' ? shippingBody.name.trim().slice(0, 200) : ''
    const taxAddress = resolveTaxAddress(cart.ships, shippingBody.address, body.billingAddress)
    if (!taxAddress.ok) {
      return res.status(400).json({ error: taxAddress.error })
    }
    if (cart.ships && !shippingName) {
      return res.status(400).json({ error: 'Shipping name required' })
    }
    const shippingAddress = cart.ships ? parsePostalAddress(shippingBody.address) : null
    const billing = cart.ships ? null : parseBillingAddress(body.billingAddress)

    // Promotion code: every restriction re-checked against the server subtotal.
    let promo: PromoDiscount | null = null
    if (body.promotionCodeId !== undefined && body.promotionCodeId !== null && body.promotionCodeId !== '') {
      if (typeof body.promotionCodeId !== 'string') {
        return res.status(400).json({ error: 'Invalid promo code' })
      }
      const result = await evaluatePromotion(await retrievePromotionCode(stripe, body.promotionCodeId), {
        subtotal: cart.subtotal,
        email,
        sql,
      })
      if (!result.ok) {
        return res.status(400).json({ error: `${result.error}. Remove the code to continue.`, promoError: true })
      }
      promo = result.value
      console.log(`[Stripe] Applying promo "${promo.code}": -${formatUsd(promo.discountAmount)}`)
    }

    const discount = promo?.discountAmount ?? 0
    const discountedSubtotal = cart.subtotal - discount

    if (discountedSubtotal + cart.shippingCost < MIN_CHARGE_CENTS) {
      return res.status(400).json({
        error: `The order total must be at least ${formatUsd(MIN_CHARGE_CENTS)}. Contact support@skyglass.dev for a free order.`,
      })
    }

    // Sales tax from Stripe Tax on the discounted lines + shipping. The
    // fallback rate is used only when Stripe Tax itself fails.
    let tax: number
    let shippingTax = 0
    let taxCalculationId = ''
    let taxSource: 'stripe_tax' | 'fallback'
    try {
      const quote = await calculateCartTax(stripe, cart, discount, taxAddress.value)
      tax = quote.tax
      shippingTax = quote.shippingTax
      taxCalculationId = quote.calculation.id ?? ''
      taxSource = 'stripe_tax'
    } catch (taxError) {
      if (isTaxLocationError(taxError)) {
        return res.status(400).json({ error: 'We could not verify that address for sales tax. Please check it.' })
      }
      console.error('[Stripe] Tax calculation failed, using fallback rate:', taxError)
      tax = Math.round(discountedSubtotal * FALLBACK_TAX_RATE)
      taxSource = 'fallback'
    }

    const total = discountedSubtotal + cart.shippingCost + tax
    if (total < MIN_CHARGE_CENTS) {
      return res.status(400).json({ error: `The order total must be at least ${formatUsd(MIN_CHARGE_CENTS)}.` })
    }

    // Create or retrieve customer
    const existingCustomers = await stripe.customers.list({ email, limit: 1 })
    const customer =
      existingCustomers.data[0] ??
      (await stripe.customers.create({
        email,
        name: cart.ships ? shippingName : undefined,
        address: shippingAddress ?? billing ?? undefined,
      }))

    const paymentIntent = await stripe.paymentIntents.create({
      amount: total,
      currency: 'usd',
      customer: customer.id,
      receipt_email: email,
      metadata: {
        order_items: JSON.stringify(cart.lines),
        subtotal: cart.subtotal.toString(),
        discount: discount.toString(),
        shipping: cart.shippingCost.toString(),
        // Tax on shipping, so a refund of "everything but shipping" can be recognized
        shipping_tax: shippingTax.toString(),
        tax: tax.toString(),
        promo_code: promo?.code ?? '',
        promotion_code_id: promo?.promotionCodeId ?? '',
        coupon_id: promo?.couponId ?? '',
        // The server's own calculation; the webhook records it as a tax transaction
        tax_calculation_id: taxCalculationId,
        tax_source: taxSource,
        // Tax address for license-only carts (kit carts use the PaymentIntent shipping address)
        billing_postal_code: billing?.postal_code ?? '',
        billing_country: billing?.country ?? '',
      },
      shipping: shippingAddress
        ? {
            name: shippingName,
            address: shippingAddress,
          }
        : undefined,
      automatic_payment_methods: {
        enabled: true,
      },
    })

    console.log(`[Stripe] PaymentIntent created: ${paymentIntent.id} for ${formatUsd(total)} (tax: ${taxSource})`)

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      amount: total,
      breakdown: {
        subtotal: cart.subtotal,
        discount,
        shipping: cart.shippingCost,
        tax,
        total,
      },
      taxSource,
      promoCode: promo?.code || undefined,
    })
  } catch (error) {
    console.error('[Stripe] Error:', error)

    if (error instanceof Stripe.errors.StripeError) {
      return res.status(400).json({ error: error.message })
    }

    return res.status(500).json({ error: 'Internal server error' })
  }
}
