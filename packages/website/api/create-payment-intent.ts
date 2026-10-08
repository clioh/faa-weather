import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover',
})

interface CartItem {
  productId: string
  name: string
  price: number
  quantity: number
}

interface CreatePaymentIntentBody {
  items: CartItem[]
  email: string
  shipping: {
    name: string
    address: {
      line1: string
      line2?: string
      city: string
      state: string
      postal_code: string
      country: string
    }
  }
  // Tax calculation ID from Stripe Tax
  taxCalculationId?: string
  // Promotion code ID for discounts
  promotionCodeId?: string
}

// Product prices (in cents) - should match your Stripe products
const PRODUCT_PRICES: Record<string, number> = {
  'hardware-kit': 34900, // $349.00
  'complete-kit': 54900, // $549.00
}

const SHIPPING_THRESHOLD = 50000 // Free shipping over $500
const SHIPPING_COST = 2500 // $25 shipping
const FALLBACK_TAX_RATE = 0.0875 // 8.75% fallback if Stripe Tax unavailable

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
    const { items, email, shipping, taxCalculationId, promotionCodeId } = req.body as CreatePaymentIntentBody

    // Validate items
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' })
    }

    // Calculate order total on the server (never trust client-side calculations)
    let subtotal = 0
    const lineItems: { productId: string; quantity: number; unitPrice: number }[] = []

    for (const item of items) {
      const unitPrice = PRODUCT_PRICES[item.productId]
      if (!unitPrice) {
        return res.status(400).json({ error: `Invalid product: ${item.productId}` })
      }
      if (item.quantity < 1 || item.quantity > 10) {
        return res.status(400).json({ error: 'Invalid quantity' })
      }
      subtotal += unitPrice * item.quantity
      lineItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
      })
    }

    // Apply promotion code discount if provided
    let discount = 0
    let promoCode = ''
    let couponId = ''

    if (promotionCodeId) {
      try {
        const promotionCode = await stripe.promotionCodes.retrieve(promotionCodeId)
        const coupon = promotionCode.coupon

        if (promotionCode.active && coupon.valid) {
          promoCode = promotionCode.code
          couponId = coupon.id

          if (coupon.percent_off) {
            discount = Math.round(subtotal * (coupon.percent_off / 100))
          } else if (coupon.amount_off) {
            discount = Math.min(coupon.amount_off, subtotal)
          }

          console.log(`[Stripe] Applying promo "${promoCode}": -$${(discount / 100).toFixed(2)}`)
        }
      } catch (promoError) {
        console.error('[Stripe] Failed to apply promotion code:', promoError)
        // Continue without discount if promo fails
      }
    }

    // Calculate shipping (based on subtotal BEFORE discount for threshold)
    const shippingCost = subtotal >= SHIPPING_THRESHOLD ? 0 : SHIPPING_COST

    // Subtotal after discount (for tax calculation)
    const discountedSubtotal = subtotal - discount

    // Get tax from Stripe Tax calculation or use fallback
    // Note: Tax is calculated on discounted subtotal
    let tax: number
    let taxCalculation: Stripe.Tax.Calculation | null = null

    if (taxCalculationId) {
      try {
        // Retrieve the tax calculation to verify and get tax amount
        taxCalculation = await stripe.tax.calculations.retrieve(taxCalculationId)
        // If there's a discount, recalculate tax proportionally
        if (discount > 0) {
          const discountRatio = discountedSubtotal / subtotal
          tax = Math.round(taxCalculation.tax_amount_exclusive * discountRatio)
        } else {
          tax = taxCalculation.tax_amount_exclusive
        }

        // Verify the calculation hasn't expired
        if (taxCalculation.expires_at && taxCalculation.expires_at < Math.floor(Date.now() / 1000)) {
          console.log('[Stripe] Tax calculation expired, using fallback')
          tax = Math.round(discountedSubtotal * FALLBACK_TAX_RATE)
          taxCalculation = null
        }
      } catch (taxError) {
        console.error('[Stripe] Failed to retrieve tax calculation:', taxError)
        tax = Math.round(discountedSubtotal * FALLBACK_TAX_RATE)
      }
    } else {
      // Fallback tax calculation on discounted amount
      tax = Math.round(discountedSubtotal * FALLBACK_TAX_RATE)
    }

    const total = discountedSubtotal + shippingCost + tax

    // Create or retrieve customer
    let customer: Stripe.Customer | undefined
    if (email) {
      const existingCustomers = await stripe.customers.list({
        email,
        limit: 1,
      })

      if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0]
      } else {
        customer = await stripe.customers.create({
          email,
          name: shipping?.name,
          address: shipping?.address,
        })
      }
    }

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: total,
      currency: 'usd',
      customer: customer?.id,
      receipt_email: email,
      metadata: {
        order_items: JSON.stringify(lineItems),
        subtotal: subtotal.toString(),
        discount: discount.toString(),
        shipping: shippingCost.toString(),
        tax: tax.toString(),
        // Store promo code info
        promo_code: promoCode,
        coupon_id: couponId,
        // Store tax calculation ID for creating tax transaction on success
        tax_calculation_id: taxCalculationId || '',
        tax_source: taxCalculationId ? 'stripe_tax' : 'fallback',
      },
      shipping: shipping ? {
        name: shipping.name,
        address: {
          line1: shipping.address.line1,
          line2: shipping.address.line2 || undefined,
          city: shipping.address.city,
          state: shipping.address.state,
          postal_code: shipping.address.postal_code,
          country: shipping.address.country,
        },
      } : undefined,
      automatic_payment_methods: {
        enabled: true,
      },
    })

    console.log(`[Stripe] PaymentIntent created: ${paymentIntent.id} for ${total / 100} USD`)

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      amount: total,
      breakdown: {
        subtotal,
        discount,
        shipping: shippingCost,
        tax,
        total,
      },
      taxSource: taxCalculationId ? 'stripe_tax' : 'fallback',
      promoCode: promoCode || undefined,
    })
  } catch (error) {
    console.error('[Stripe] Error:', error)

    if (error instanceof Stripe.errors.StripeError) {
      return res.status(400).json({ error: error.message })
    }

    return res.status(500).json({ error: 'Internal server error' })
  }
}
