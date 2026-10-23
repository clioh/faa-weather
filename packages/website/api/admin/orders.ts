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

/** Most PaymentIntents the summary stats page through (10 Stripe list calls). */
const STATS_MAX_INTENTS = 1000

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

    // Summary stats over every PaymentIntent (auto-paginated), up to STATS_MAX_INTENTS.
    // `statsComplete` is false when there were more than that, so the page can say so.
    let succeeded = 0
    let revenue = 0
    let unpaid = 0
    let counted = 0
    let statsComplete = true
    for await (const pi of stripe.paymentIntents.list({ limit: 100 })) {
      if (counted >= STATS_MAX_INTENTS) {
        statsComplete = false
        break
      }
      counted++
      if (pi.status === 'succeeded') {
        succeeded++
        revenue += pi.amount
      } else if (pi.status === 'requires_payment_method' || pi.status === 'requires_confirmation') {
        unpaid++
      }
    }

    const stats = {
      /** Paid orders (succeeded PaymentIntents). */
      totalOrders: succeeded,
      /** Gross amount of paid orders, before refunds, in cents. */
      totalRevenue: revenue,
      /** Checkouts started but never paid. */
      pendingOrders: unpaid,
      /** PaymentIntents counted, and whether that was all of them. */
      counted,
      statsComplete,
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
