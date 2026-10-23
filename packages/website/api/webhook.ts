import type { VercelRequest, VercelResponse } from '@vercel/node'
import type Stripe from 'stripe'
import {
  assignNewKey,
  claimUnemailedLicenses,
  createOrderLicenses,
  getDb,
  markLicensesEmailed,
  recordPromoRedemption,
  releaseEmailClaim,
  revokeLicensesOnOrder,
  revokeOrderLicenses,
  type Sql,
} from './_lib/db.js'
import {
  EMAIL,
  ORDERS_FROM,
  emailHeading,
  emailLayout,
  emailPanel,
  emailParagraph,
  escapeHtml,
  licenseKeysHtml,
  preinstalledLicenseHtml,
  sectionLabel,
  sendEmail,
} from './_lib/email.js'
import { readRawBody } from './_lib/http.js'
import { KEYED_AT_PURCHASE, expandOrderLicenses } from './_lib/license.js'
import { stripe } from './_lib/stripe.js'
import {
  BOM_PDF_URL,
  BUILD_GUIDE_URL,
  KIT_SHIP_LEAD_TIME,
  fullProductName,
  isProductId,
} from '../shared/catalog.js'

/**
 * Stripe webhook (docs/LICENSING.md, "Purchase → license" and "Refunds").
 *
 * Events: payment_intent.succeeded, payment_intent.payment_failed (logged only),
 * charge.refunded, refund.updated / charge.refund.updated, charge.dispute.created.
 *
 * Every handler is idempotent; any failure returns 500 so Stripe retries.
 *
 * No `export const config = { api: { bodyParser: false } }` here: that is a
 * Next.js option and @vercel/node ignores it. The raw body for signature
 * verification is read with readRawBody (see api/_lib/http.ts).
 */

interface OrderLineItem {
  productId: string
  quantity: number
  unitPrice: number
}

interface OrderDetails {
  paymentIntentId: string
  email: string
  amount: number
  subtotal: number
  shipping: number
  tax: number
  items: OrderLineItem[]
  shippingAddress: {
    name: string
    line1: string
    line2?: string
    city: string
    state: string
    postal_code: string
    country: string
  } | null
  createdAt: string
}

/** Licenses carried by one confirmation email. */
interface OrderLicenses {
  keys: string[]
  kitCount: number
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!endpointSecret) {
    console.error('[Webhook] STRIPE_WEBHOOK_SECRET is not set')
    return res.status(500).json({ error: 'Webhook not configured' })
  }

  const sig = req.headers['stripe-signature']
  if (typeof sig !== 'string' || !sig) {
    return res.status(400).json({ error: 'Missing Stripe-Signature header' })
  }

  let event: Stripe.Event
  try {
    const rawBody = await readRawBody(req)
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret)
  } catch (err) {
    const error = err as Error
    console.error(`[Webhook] Signature verification failed: ${error.message}`)
    return res.status(400).json({ error: `Webhook Error: ${error.message}` })
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object)
        break

      case 'payment_intent.payment_failed':
        // Stripe Elements already shows the decline in the checkout page, so
        // no email (it would also let card testers mail arbitrary addresses).
        console.log(
          `[Webhook] Payment failed: ${event.data.object.id} (${event.data.object.last_payment_error?.code ?? 'unknown'})`
        )
        break

      case 'charge.refunded':
        await handleChargeRefunded(event.data.object)
        break

      case 'refund.updated':
      case 'charge.refund.updated':
        await handleRefundUpdated(event.data.object)
        break

      case 'charge.dispute.created':
        await handleDisputeCreated(event.data.object)
        break

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`)
    }
  } catch (err) {
    console.error(`[Webhook] Failed to handle ${event.type}:`, err)
    return res.status(500).json({ error: 'Webhook handler failed' })
  }

  return res.status(200).json({ received: true })
}

function requireDb(): Sql {
  const sql = getDb()
  // Fail so Stripe retries once DATABASE_URL is configured.
  if (!sql) throw new Error('DATABASE_URL not configured')
  return sql
}

function parseOrderItems(raw: string | undefined): OrderLineItem[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? (parsed as OrderLineItem[]) : []
  } catch {
    console.error('[Webhook] Could not parse order_items metadata')
    return []
  }
}

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null
  return typeof ref === 'string' ? ref : ref.id
}

function cents(value: string | undefined): number {
  const n = parseInt(value || '0', 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// ---------------------------------------------------------------------------
// payment_intent.succeeded
// ---------------------------------------------------------------------------

async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  console.log(`[Webhook] Payment succeeded: ${paymentIntent.id}`)
  const sql = requireDb()

  const metadata = paymentIntent.metadata
  const items = parseOrderItems(metadata.order_items)

  const order: OrderDetails = {
    paymentIntentId: paymentIntent.id,
    email: (paymentIntent.receipt_email || '').trim().toLowerCase(),
    amount: paymentIntent.amount,
    subtotal: cents(metadata.subtotal),
    shipping: cents(metadata.shipping),
    tax: cents(metadata.tax),
    items,
    shippingAddress: paymentIntent.shipping?.address
      ? {
          name: paymentIntent.shipping.name || '',
          line1: paymentIntent.shipping.address.line1 || '',
          line2: paymentIntent.shipping.address.line2 || undefined,
          city: paymentIntent.shipping.address.city || '',
          state: paymentIntent.shipping.address.state || '',
          postal_code: paymentIntent.shipping.address.postal_code || '',
          country: paymentIntent.shipping.address.country || '',
        }
      : null,
    createdAt: new Date().toISOString(),
  }

  // Record the tax transaction for the server's own Stripe Tax calculation
  // (create-payment-intent). Fails harmlessly when Stripe retries this event.
  const taxCalculationId = metadata.tax_calculation_id
  if (taxCalculationId && metadata.tax_source === 'stripe_tax') {
    try {
      const taxTransaction = await stripe.tax.transactions.createFromCalculation({
        calculation: taxCalculationId,
        reference: paymentIntent.id,
      })
      console.log(`[Webhook] Tax transaction created: ${taxTransaction.id}`)
    } catch (taxError) {
      console.error('[Webhook] Failed to create tax transaction:', taxError)
    }
  }

  // Count the promo code against its max_redemptions (PaymentIntents don't redeem codes).
  if (metadata.promotion_code_id) {
    await recordPromoRedemption(
      sql,
      paymentIntent.id,
      metadata.promotion_code_id,
      metadata.coupon_id || null
    )
  }

  // One license row per licensed unit. Idempotent on (order_id, order_seq):
  // only rows inserted by this call come back, with their plaintext key.
  const planned = expandOrderLicenses(items)
  const created = await createOrderLicenses(
    sql,
    paymentIntent.id,
    order.email,
    planned.map((p) => ({ ...p, keyed: KEYED_AT_PURCHASE.includes(p.productId) }))
  )
  if (created.length > 0)
    console.log(`[Webhook] Created ${created.length} license(s) for ${paymentIntent.id}`)
  const plaintext = new Map(created.flatMap((c) => (c.key ? [[c.id, c.key] as const] : [])))

  // A refund or dispute may have been processed before this delivery
  // succeeded (its handler found no rows then). Apply it now; the rows exist,
  // so whichever handler runs last sees both.
  const chargeId = idOf(paymentIntent.latest_charge)
  if (chargeId) {
    const charge = await stripe.charges.retrieve(chargeId)
    if (charge.disputed || charge.amount_refunded > 0) {
      await applyChargeState(sql, charge, paymentIntent.id, metadata)
    }
  }

  await sendConfirmation(sql, order, plaintext)
}

/**
 * Email the confirmation for every license on the order that hasn't been
 * emailed yet (and isn't revoked). Throws when the send fails, so Stripe
 * retries the event. The plaintext of a key made by an earlier, failed
 * delivery is gone, so such keys are rotated before sending.
 */
async function sendConfirmation(sql: Sql, order: OrderDetails, plaintext: Map<string, string>) {
  if (!order.email) {
    console.error(`[Webhook] No receipt email on ${order.paymentIntentId}; confirmation not sent`)
    return
  }

  const claimed = await claimUnemailedLicenses(sql, order.paymentIntentId)
  if (claimed.length === 0) {
    console.log(
      `[Webhook] Nothing to email for ${order.paymentIntentId} (already sent, revoked, or being sent)`
    )
    return
  }

  const ids = claimed.map((r) => r.id)
  try {
    const licenses: OrderLicenses = { keys: [], kitCount: 0 }
    for (const row of claimed) {
      if (!KEYED_AT_PURCHASE.includes(row.product_id)) {
        licenses.kitCount++ // keyed at fulfilment, written to the SD card
        continue
      }
      let key = plaintext.get(row.id) ?? null
      if (!key) {
        key = await assignNewKey(sql, row.id, row.key_hash ? 'pending-keyed' : 'unkeyed')
        if (key) console.log(`[Webhook] Rotated un-emailed key for ${row.id}`)
        else
          console.warn(
            `[Webhook] Could not rotate key for ${row.id} (status ${row.status}); emailing without it`
          )
      }
      if (key) licenses.keys.push(key)
    }

    const sent = await sendEmail({
      from: ORDERS_FROM,
      to: order.email,
      subject: `SkyGlass order confirmed #${order.paymentIntentId.slice(-8).toUpperCase()}`,
      html: getOrderConfirmationEmailHtml(order, licenses),
    })
    if (!sent) throw new Error(`Confirmation email for ${order.paymentIntentId} failed to send`)
  } catch (err) {
    await releaseEmailClaim(sql, ids)
    throw err
  }

  await markLicensesEmailed(sql, ids)
  console.log(
    `[Webhook] Confirmation email sent for ${order.paymentIntentId} (${ids.length} license(s))`
  )
}

// ---------------------------------------------------------------------------
// Refunds and disputes
// ---------------------------------------------------------------------------

/** License ids (or 'all') named in `revoke_licenses` metadata on the charge's refunds. */
function revokeTargets(refunds: Stripe.Refund[]): { all: boolean; ids: string[] } {
  let all = false
  const ids = new Set<string>()
  for (const refund of refunds) {
    if (refund.status === 'failed' || refund.status === 'canceled') continue
    const value = refund.metadata?.revoke_licenses?.trim()
    if (!value) continue
    if (value.toLowerCase() === 'all') all = true
    else for (const id of value.split(',')) if (id.trim()) ids.add(id.trim().toLowerCase())
  }
  return { all, ids: [...ids] }
}

/**
 * Revoke licenses for a refunded or disputed charge:
 * - any dispute: revoke every license on the order;
 * - a refund with metadata revoke_licenses = 'all' or "<id>,<id>": revoke those;
 * - otherwise, if everything except shipping (and tax on shipping) was
 *   refunded, revoke every license on the order;
 * - otherwise revoke nothing and log a warning for support.
 * Idempotent: revoking only ever moves rows to 'revoked'.
 */
async function applyChargeState(
  sql: Sql,
  charge: Stripe.Charge,
  orderId: string,
  metadata: Stripe.Metadata
) {
  if (charge.disputed) {
    const count = await revokeOrderLicenses(sql, orderId)
    console.log(`[Webhook] Dispute on ${charge.id}: revoked ${count} license(s) on ${orderId}`)
    return
  }
  if (charge.amount_refunded <= 0) return

  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 })
  const targets = revokeTargets(refunds.data)

  if (targets.all) {
    const count = await revokeOrderLicenses(sql, orderId)
    console.log(
      `[Webhook] Refund on ${charge.id} (revoke_licenses=all): revoked ${count} license(s) on ${orderId}`
    )
    return
  }
  if (targets.ids.length > 0) {
    const revoked = await revokeLicensesOnOrder(sql, orderId, targets.ids)
    console.log(
      `[Webhook] Refund on ${charge.id} (revoke_licenses=${targets.ids.join(',')}): revoked ${revoked.length} license(s) on ${orderId}` +
        (revoked.length < targets.ids.length
          ? ' (others already revoked or not on this order)'
          : '')
    )
    return
  }

  // Returns refund the product price + tax but not shipping, so a refund of
  // everything except shipping (and any tax on it) counts as a full return.
  const keptShipping = cents(metadata.shipping) + cents(metadata.shipping_tax)
  const threshold = Math.max(1, charge.amount - keptShipping)
  if (charge.amount_refunded >= threshold) {
    const count = await revokeOrderLicenses(sql, orderId)
    console.log(
      `[Webhook] Refund on ${charge.id} (${charge.amount_refunded}/${charge.amount}, shipping ${keptShipping} kept): revoked ${count} license(s) on ${orderId}`
    )
    return
  }

  console.warn(
    `[Webhook] Partial refund on order ${orderId} (charge ${charge.id}: ${charge.amount_refunded}/${charge.amount}): ` +
      'no licenses revoked. If a unit was returned, revoke its license with the admin API or set ' +
      'revoke_licenses=<licenseId> on the refund (docs/LICENSING.md, "Refunds").'
  )
}

async function applyChargeStateFor(charge: Stripe.Charge, reason: string) {
  const paymentIntentId = idOf(charge.payment_intent)
  if (!paymentIntentId) {
    console.error(
      `[Webhook] ${reason}: no payment intent on charge ${charge.id}, cannot revoke licenses`
    )
    return
  }
  const sql = requireDb()
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
  await applyChargeState(sql, charge, paymentIntentId, paymentIntent.metadata)
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  await applyChargeStateFor(charge, 'Refund')
}

/** Picks up revoke_licenses metadata added to a refund after it was created (e.g. in the Dashboard). */
async function handleRefundUpdated(refund: Stripe.Refund) {
  if (!refund.metadata?.revoke_licenses?.trim()) return
  const chargeId = idOf(refund.charge)
  if (!chargeId) {
    console.error(`[Webhook] Refund ${refund.id} has no charge; cannot apply revoke_licenses`)
    return
  }
  await applyChargeStateFor(await stripe.charges.retrieve(chargeId), 'Refund update')
}

async function handleDisputeCreated(dispute: Stripe.Dispute) {
  let paymentIntentId = idOf(dispute.payment_intent)
  if (!paymentIntentId) {
    const chargeId = idOf(dispute.charge)
    if (chargeId) {
      const charge = await stripe.charges.retrieve(chargeId)
      paymentIntentId = idOf(charge.payment_intent)
    }
  }
  if (!paymentIntentId) {
    console.error(`[Webhook] Dispute ${dispute.id}: no payment intent, cannot revoke licenses`)
    return
  }
  const count = await revokeOrderLicenses(requireDb(), paymentIntentId)
  console.log(`[Webhook] Dispute ${dispute.id}: revoked ${count} license(s) on ${paymentIntentId}`)
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

/** Pre-order mode, read from the same flags the site is built with (src/config/features.ts). */
const isPreorderMode = () =>
  process.env.VITE_FEATURE_ECOMMERCE === 'true' && process.env.VITE_FEATURE_PREORDERS === 'true'

function getOrderConfirmationEmailHtml(order: OrderDetails, licenses: OrderLicenses): string {
  const orderNumber = order.paymentIntentId.slice(-8).toUpperCase()
  const cell = `font-family: ${EMAIL.sans}; font-size: 14px; color: ${EMAIL.fg2}; padding: 8px 0;`
  const amountCell = `font-family: ${EMAIL.mono}; font-size: 14px; color: ${EMAIL.fg2}; padding: 8px 0; text-align: right;`

  const itemsHtml = order.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid ${EMAIL.line}; font-family: ${EMAIL.sans};">
        <div style="color: ${EMAIL.fg}; font-size: 14px; font-weight: 500;">
          ${escapeHtml(isProductId(item.productId) ? fullProductName(item.productId) : String(item.productId))}
        </div>
        <div style="color: ${EMAIL.fg3}; font-size: 12px; margin-top: 4px;">Qty ${item.quantity}</div>
      </td>
      <td style="padding: 12px 0; border-bottom: 1px solid ${EMAIL.line}; text-align: right; color: ${EMAIL.fg}; font-family: ${EMAIL.mono}; font-size: 14px;">
        ${formatCurrency(item.unitPrice * item.quantity)}
      </td>
    </tr>`
    )
    .join('')

  const address = order.shippingAddress
  const shippingHtml = address
    ? `
    <div style="margin-top: 24px;">
      ${sectionLabel('Shipping to')}
      <div style="color: ${EMAIL.fg}; font-family: ${EMAIL.sans}; font-size: 14px; line-height: 1.6;">
        ${escapeHtml(address.name)}<br>
        ${escapeHtml(address.line1)}<br>
        ${address.line2 ? `${escapeHtml(address.line2)}<br>` : ''}
        ${escapeHtml(address.city)}, ${escapeHtml(address.state)} ${escapeHtml(address.postal_code)}<br>
        ${escapeHtml(address.country)}
      </div>
    </div>`
    : ''

  const hasKit = address !== null
  const hasLicense = order.items.some((item) => item.productId === 'software-license')
  const link = (href: string, text: string) =>
    `<a href="${href}" style="color: ${EMAIL.accent}; text-decoration: none;">${text}</a>`
  const nextSteps = [
    ...(hasKit
      ? [
          isPreorderMode()
            ? 'Your kit is a pre-order. It is refundable in full until it ships.'
            : `Your kit ships within ${KIT_SHIP_LEAD_TIME}.`,
          "When it ships, we'll send a separate email with the tracking number.",
          'Assembly instructions come in the box.',
        ]
      : []),
    ...(hasLicense
      ? [
          `Build your mirror with the ${link(BUILD_GUIDE_URL, 'build guide')} and ${link(BOM_PDF_URL, 'parts list')}: flash Raspberry Pi OS with Raspberry Pi Imager, then run the SkyGlass setup script.`,
          'Open the SkyGlass app and follow setup on your mirror.',
          'Enter your license key when the app asks for it.',
        ]
      : []),
  ]

  return emailLayout(
    'Order confirmed',
    `
    ${emailHeading('Order confirmed')}
    ${emailParagraph('Thank you for your purchase.')}

    ${emailPanel(`
            <div style="color: ${EMAIL.fg3}; font-family: ${EMAIL.sans}; font-size: 12px;">Order number</div>
            <div style="color: ${EMAIL.fg}; font-family: ${EMAIL.mono}; font-size: 18px; margin-top: 4px;">#${orderNumber}</div>`)}

    <div style="margin-top: 24px;">
      ${sectionLabel('Order summary')}
      <table role="presentation" width="100%" style="width: 100%; border-collapse: collapse;">
        ${itemsHtml}
        <tr><td style="${cell}">Subtotal</td><td style="${amountCell}">${formatCurrency(order.subtotal)}</td></tr>
        <tr><td style="${cell}">Shipping</td><td style="${amountCell}">${order.shipping === 0 ? 'Free' : formatCurrency(order.shipping)}</td></tr>
        <tr><td style="${cell}">Tax</td><td style="${amountCell}">${formatCurrency(order.tax)}</td></tr>
        <tr>
          <td style="padding: 12px 0 0; border-top: 1px solid ${EMAIL.line}; color: ${EMAIL.fg}; font-family: ${EMAIL.sans}; font-size: 16px; font-weight: 500;">Total</td>
          <td style="padding: 12px 0 0; border-top: 1px solid ${EMAIL.line}; text-align: right; color: ${EMAIL.fg}; font-family: ${EMAIL.mono}; font-size: 18px;">${formatCurrency(order.amount)}</td>
        </tr>
      </table>
    </div>

    ${shippingHtml}

    ${licenses.keys.length > 0 ? licenseKeysHtml(licenses.keys) : ''}
    ${licenses.kitCount > 0 ? preinstalledLicenseHtml(licenses.kitCount) : ''}

    <div style="margin-top: 32px;">
      ${sectionLabel("What's next")}
      <ul style="margin: 0; padding-left: 20px; color: ${EMAIL.fg2}; font-family: ${EMAIL.sans}; font-size: 14px; line-height: 1.8;">
        ${nextSteps.map((step) => `<li>${step}</li>`).join('\n        ')}
      </ul>
    </div>`
  )
}
