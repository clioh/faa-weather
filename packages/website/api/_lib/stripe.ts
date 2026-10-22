/**
 * Shared Stripe client. Lives under api/_lib/ so Vercel does not deploy it.
 */

import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover',
})
