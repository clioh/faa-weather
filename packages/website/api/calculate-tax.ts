import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover',
})

interface CartItem {
  productId: string
  quantity: number
}

interface ShippingAddress {
  line1: string
  line2?: string
  city: string
  state: string
  postal_code: string
  country: string
}

interface CalculateTaxBody {
  items: CartItem[]
  shipping: ShippingAddress
}

// Product prices (in cents) - must match create-payment-intent.ts
const PRODUCT_PRICES: Record<string, number> = {
  'hardware-kit': 34900, // $349.00
  'complete-kit': 54900, // $549.00
}

// Stripe Tax codes for physical goods
// See: https://stripe.com/docs/tax/tax-codes
const TAX_CODE = 'txcd_99999999' // General - Tangible Goods

const SHIPPING_THRESHOLD = 50000 // Free shipping over $500
const SHIPPING_COST = 2500 // $25 shipping

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
    const { items, shipping } = req.body as CalculateTaxBody

    // Validate items
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' })
    }

    // Validate shipping address
    if (!shipping || !shipping.line1 || !shipping.city || !shipping.postal_code || !shipping.country) {
      return res.status(400).json({ error: 'Shipping address required for tax calculation' })
    }

    // Build line items for tax calculation
    let subtotal = 0
    const lineItems: Stripe.Tax.CalculationCreateParams.LineItem[] = []

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
        amount: unitPrice * item.quantity,
        quantity: 1, // Amount already includes quantity
        reference: item.productId,
        tax_code: TAX_CODE,
      })
    }

    // Calculate shipping cost
    const shippingCost = subtotal >= SHIPPING_THRESHOLD ? 0 : SHIPPING_COST

    // Add shipping as a line item if applicable
    if (shippingCost > 0) {
      lineItems.push({
        amount: shippingCost,
        quantity: 1,
        reference: 'shipping',
        tax_code: 'txcd_92010001', // Shipping - Tangible goods
      })
    }

    // Create tax calculation
    const taxCalculation = await stripe.tax.calculations.create({
      currency: 'usd',
      line_items: lineItems,
      customer_details: {
        address: {
          line1: shipping.line1,
          line2: shipping.line2 || undefined,
          city: shipping.city,
          state: shipping.state,
          postal_code: shipping.postal_code,
          country: shipping.country,
        },
        address_source: 'shipping',
      },
      // Enable tax for both shipping origin and destination
      // You'll need to set your business address in Stripe Dashboard > Tax settings
    })

    // Extract tax amounts
    const taxAmount = taxCalculation.tax_amount_exclusive
    const total = subtotal + shippingCost + taxAmount

    // Get tax breakdown by jurisdiction
    const taxBreakdown = taxCalculation.tax_breakdown?.map((tb) => ({
      amount: tb.amount,
      jurisdiction: tb.jurisdiction.display_name,
      taxType: tb.tax_rate_details?.tax_type || 'sales_tax',
      rate: tb.tax_rate_details?.percentage_decimal
        ? parseFloat(tb.tax_rate_details.percentage_decimal)
        : 0,
    })) || []

    console.log(`[Tax] Calculated for ${shipping.city}, ${shipping.state}: $${(taxAmount / 100).toFixed(2)} tax`)

    return res.status(200).json({
      calculationId: taxCalculation.id,
      subtotal,
      shipping: shippingCost,
      taxAmount,
      total,
      taxBreakdown,
      // Include expires_at so frontend knows when to recalculate
      expiresAt: taxCalculation.expires_at,
    })
  } catch (error) {
    console.error('[Tax] Error:', error)

    if (error instanceof Stripe.errors.StripeError) {
      // Handle specific Stripe Tax errors
      if (error.code === 'tax_not_active') {
        return res.status(400).json({
          error: 'Tax calculation not available',
          fallback: true, // Signal frontend to use fallback calculation
        })
      }
      return res.status(400).json({ error: error.message })
    }

    return res.status(500).json({ error: 'Internal server error' })
  }
}
