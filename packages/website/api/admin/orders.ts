import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { getCatalogProduct } from '../../shared/catalog.js'
import { requireAdmin } from '../_lib/admin.js'
import { stripe } from '../_lib/stripe.js'

interface OrderLineItem {
  productId: string
  quantity: number
  unitPrice: number
}

interface Order {
  id: string
  email: string
  amount: number
  status: string
  items: Array<{
    name: string
    quantity: number
    price: number
  }>
  shipping: {
    name: string
    address: string
  } | null
  createdAt: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Authorization: Bearer $ADMIN_PASSWORD (503 when unset, constant-time compare, failures rate-limited)
  if (!(await requireAdmin(req, res))) return

  try {
    const { limit = '25', starting_after, status } = req.query

    // Build query params
    const params: Stripe.PaymentIntentListParams = {
      limit: Math.min(parseInt(limit as string) || 25, 100),
      expand: ['data.customer'],
    }

    if (starting_after) {
      params.starting_after = starting_after as string
    }

    // Fetch payment intents from Stripe
    const paymentIntents = await stripe.paymentIntents.list(params)

    // Filter by status if specified
    let filteredIntents = paymentIntents.data
    if (status && status !== 'all') {
      filteredIntents = filteredIntents.filter((pi) => pi.status === status)
    }

    // Transform to order format
    const orders: Order[] = filteredIntents.map((pi) => {
      const metadata = pi.metadata
      let items: OrderLineItem[] = []
      try {
        const parsed: unknown = JSON.parse(metadata.order_items || '[]')
        if (Array.isArray(parsed)) items = parsed as OrderLineItem[]
      } catch {
        // not one of our PaymentIntents
      }

      const shipping = pi.shipping
        ? {
            name: pi.shipping.name || '',
            address: [
              pi.shipping.address?.line1,
              pi.shipping.address?.line2,
              `${pi.shipping.address?.city}, ${pi.shipping.address?.state} ${pi.shipping.address?.postal_code}`,
              pi.shipping.address?.country,
            ]
              .filter(Boolean)
              .join('\n'),
          }
        : null

      return {
        id: pi.id,
        email: pi.receipt_email || (pi.customer as Stripe.Customer)?.email || 'N/A',
        amount: pi.amount,
        status: pi.status,
        items: items.map((item) => ({
          name: getCatalogProduct(item.productId)?.name ?? item.productId,
          quantity: item.quantity,
          price: item.unitPrice,
        })),
        shipping,
        createdAt: new Date(pi.created * 1000).toISOString(),
      }
    })

    // Get summary stats
    const allSucceeded = await stripe.paymentIntents.list({
      limit: 100,
    })

    const stats = {
      totalOrders: allSucceeded.data.filter((pi) => pi.status === 'succeeded').length,
      totalRevenue: allSucceeded.data
        .filter((pi) => pi.status === 'succeeded')
        .reduce((sum, pi) => sum + pi.amount, 0),
      pendingOrders: allSucceeded.data.filter(
        (pi) => pi.status === 'requires_payment_method' || pi.status === 'requires_confirmation'
      ).length,
    }

    return res.status(200).json({
      orders,
      stats,
      hasMore: paymentIntents.has_more,
      nextCursor: paymentIntents.data[paymentIntents.data.length - 1]?.id,
    })
  } catch (error) {
    console.error('[Admin] Error fetching orders:', error)

    if (error instanceof Stripe.errors.StripeError) {
      return res.status(400).json({ error: error.message })
    }

    return res.status(500).json({ error: 'Internal server error' })
  }
}
