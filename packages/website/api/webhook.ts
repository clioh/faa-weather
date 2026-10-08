import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { Resend } from 'resend'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover',
})

const resend = new Resend(process.env.RESEND_API_KEY)

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!

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

// Product display names
const PRODUCT_NAMES: Record<string, string> = {
  'hardware-kit': 'SkyGlass Hardware Kit',
  'complete-kit': 'SkyGlass Complete Kit',
}

// License server configuration
const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL || 'https://license.skyglass.dev'
const LICENSE_API_KEY = process.env.LICENSE_API_KEY

interface LicenseResponse {
  success: boolean
  license?: {
    id: string
    licenseKey: string
    email: string
    status: string
    createdAt: string
  }
  error?: string
}

// Stripe signature verification needs the exact raw bytes, so disable the
// Vercel Node runtime's automatic body parsing for this function.
export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const sig = req.headers['stripe-signature'] as string

  let event: Stripe.Event

  try {
    // Get raw body for signature verification
    const rawBody = await getRawBody(req)
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret)
  } catch (err) {
    const error = err as Error
    console.error(`[Webhook] Signature verification failed: ${error.message}`)
    return res.status(400).json({ error: `Webhook Error: ${error.message}` })
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentSuccess(event.data.object as Stripe.PaymentIntent)
      break

    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.PaymentIntent)
      break

    default:
      console.log(`[Webhook] Unhandled event type: ${event.type}`)
  }

  return res.status(200).json({ received: true })
}

/**
 * Create a license for the customer via the license server
 */
async function createLicense(email: string, paymentIntentId: string): Promise<LicenseResponse | null> {
  if (!LICENSE_API_KEY) {
    console.error('[Webhook] LICENSE_API_KEY not configured, skipping license creation')
    return null
  }

  try {
    const response = await fetch(`${LICENSE_SERVER_URL}/api/v1/licenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LICENSE_API_KEY}`,
      },
      body: JSON.stringify({
        email,
        stripePaymentId: paymentIntentId,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Webhook] License creation failed: ${response.status} - ${errorText}`)
      return null
    }

    const data = await response.json() as LicenseResponse
    console.log(`[Webhook] License created: ${data.license?.licenseKey?.slice(0, 9)}...`)
    return data
  } catch (error) {
    console.error('[Webhook] License creation error:', error)
    return null
  }
}

async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  console.log(`[Webhook] Payment succeeded: ${paymentIntent.id}`)

  // Extract order details from metadata
  const metadata = paymentIntent.metadata
  const items: OrderLineItem[] = JSON.parse(metadata.order_items || '[]')

  const order: OrderDetails = {
    paymentIntentId: paymentIntent.id,
    email: paymentIntent.receipt_email || '',
    amount: paymentIntent.amount,
    subtotal: parseInt(metadata.subtotal || '0'),
    shipping: parseInt(metadata.shipping || '0'),
    tax: parseInt(metadata.tax || '0'),
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

  // Create Tax Transaction if Stripe Tax was used
  // This records the tax for proper reporting
  const taxCalculationId = metadata.tax_calculation_id
  if (taxCalculationId && metadata.tax_source === 'stripe_tax') {
    try {
      const taxTransaction = await stripe.tax.transactions.createFromCalculation({
        calculation: taxCalculationId,
        reference: paymentIntent.id,
      })
      console.log(`[Webhook] Tax transaction created: ${taxTransaction.id}`)
    } catch (taxError) {
      // Log but don't fail - tax transaction can be created manually if needed
      console.error('[Webhook] Failed to create tax transaction:', taxError)
    }
  }

  // Log order for now (in production, save to database)
  console.log(`[Webhook] Order created:`, JSON.stringify(order, null, 2))

  // Create a license for the customer
  let licenseKey: string | null = null
  if (order.email) {
    const licenseResult = await createLicense(order.email, paymentIntent.id)
    if (licenseResult?.license?.licenseKey) {
      licenseKey = licenseResult.license.licenseKey
      console.log(`[Webhook] License assigned to order: ${licenseKey.slice(0, 9)}...`)
    }
  }

  // Send order confirmation email
  if (order.email) {
    try {
      const { error } = await resend.emails.send({
        from: 'SkyGlass <orders@skyglass.dev>',
        to: order.email,
        subject: `Order Confirmed - ${paymentIntent.id.slice(-8).toUpperCase()}`,
        html: getOrderConfirmationEmailHtml(order, licenseKey),
      })

      if (error) {
        console.error('[Webhook] Failed to send confirmation email:', error)
      } else {
        console.log(`[Webhook] Confirmation email sent to ${order.email}`)
      }
    } catch (emailError) {
      console.error('[Webhook] Email error:', emailError)
    }
  }
}

async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  console.log(`[Webhook] Payment failed: ${paymentIntent.id}`)
  console.log(`[Webhook] Failure reason: ${paymentIntent.last_payment_error?.message}`)

  // Optionally send failure notification email
  const email = paymentIntent.receipt_email
  if (email) {
    try {
      await resend.emails.send({
        from: 'SkyGlass <orders@skyglass.dev>',
        to: email,
        subject: 'Payment Issue - SkyGlass Order',
        html: getPaymentFailedEmailHtml(paymentIntent),
      })
    } catch (error) {
      console.error('[Webhook] Failed to send payment failed email:', error)
    }
  }
}

/**
 * Read the raw request body for Stripe signature verification.
 * Body parsing is disabled via `config` below, so normally this reads the
 * stream. If a runtime has already buffered the body as a Buffer/string, use
 * that directly instead of waiting on a stream that will never emit.
 */
async function getRawBody(req: VercelRequest): Promise<Buffer> {
  const existing: unknown = (req as { body?: unknown }).body
  if (Buffer.isBuffer(existing)) return existing
  if (typeof existing === 'string') return Buffer.from(existing, 'utf8')
  if (existing !== undefined && existing !== null) {
    throw new Error('Request body was already parsed; raw body unavailable for signature verification')
  }

  if (req.readableEnded) {
    throw new Error('Request stream already consumed; raw body unavailable for signature verification')
  }

  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer))
  }
  return Buffer.concat(chunks)
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

function getOrderConfirmationEmailHtml(order: OrderDetails, licenseKey?: string | null): string {
  const currentYear = new Date().getFullYear()
  const orderNumber = order.paymentIntentId.slice(-8).toUpperCase()

  const itemsHtml = order.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #2a2a3a;">
        <div style="color: #e8e8ec; font-size: 14px; font-weight: 500;">
          ${PRODUCT_NAMES[item.productId] || item.productId}
        </div>
        <div style="color: #8a8a9a; font-size: 12px; margin-top: 4px;">
          Qty: ${item.quantity}
        </div>
      </td>
      <td style="padding: 12px 0; border-bottom: 1px solid #2a2a3a; text-align: right; color: #e8e8ec; font-family: monospace;">
        ${formatCurrency(item.unitPrice * item.quantity)}
      </td>
    </tr>
  `
    )
    .join('')

  const shippingHtml = order.shippingAddress
    ? `
    <div style="margin-top: 24px;">
      <div style="color: #f5a623; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">
        Shipping To
      </div>
      <div style="color: #e8e8ec; font-size: 14px; line-height: 1.6;">
        ${order.shippingAddress.name}<br>
        ${order.shippingAddress.line1}<br>
        ${order.shippingAddress.line2 ? `${order.shippingAddress.line2}<br>` : ''}
        ${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postal_code}<br>
        ${order.shippingAddress.country}
      </div>
    </div>
  `
    : ''

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Confirmation - SkyGlass</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #12121a; border: 1px solid #2a2a3a; border-radius: 12px;">

          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #2a2a3a;">
              <div style="font-size: 24px; font-weight: bold; letter-spacing: 1px;">
                <span style="color: #e8e8ec;">Sky</span><span style="color: #f5a623;">Glass</span>
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <!-- Success Icon -->
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; width: 64px; height: 64px; background-color: rgba(74, 222, 128, 0.1); border: 2px solid #4ade80; border-radius: 50%; line-height: 60px; font-size: 28px;">
                  ✓
                </div>
              </div>

              <h1 style="margin: 0 0 8px; color: #e8e8ec; font-size: 28px; font-weight: bold; text-align: center;">
                Order Confirmed
              </h1>
              <p style="margin: 0 0 24px; color: #8a8a9a; font-size: 16px; text-align: center;">
                Thank you for your purchase. Your order is being processed.
              </p>

              <!-- Order Number Card -->
              <table role="presentation" style="width: 100%; background-color: #1a1a24; border: 1px solid #2a2a3a; border-radius: 8px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 20px;">
                    <table role="presentation" style="width: 100%;">
                      <tr>
                        <td>
                          <span style="color: #8a8a9a; font-size: 12px;">Order Number</span>
                          <div style="color: #f5a623; font-family: monospace; font-size: 18px; font-weight: bold; margin-top: 4px;">
                            #${orderNumber}
                          </div>
                        </td>
                        <td style="text-align: right;">
                          <span style="color: #8a8a9a; font-size: 12px;">Status</span>
                          <div style="margin-top: 4px;">
                            <span style="display: inline-block; padding: 4px 12px; background-color: rgba(74, 222, 128, 0.1); border: 1px solid rgba(74, 222, 128, 0.3); border-radius: 4px; color: #4ade80; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">
                              Processing
                            </span>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Order Items -->
              <div style="margin-bottom: 24px;">
                <div style="color: #f5a623; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">
                  Order Summary
                </div>
                <table role="presentation" style="width: 100%;">
                  ${itemsHtml}
                  <tr>
                    <td style="padding: 8px 0; color: #8a8a9a; font-size: 14px;">Subtotal</td>
                    <td style="padding: 8px 0; text-align: right; color: #8a8a9a; font-family: monospace; font-size: 14px;">
                      ${formatCurrency(order.subtotal)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #8a8a9a; font-size: 14px;">Shipping</td>
                    <td style="padding: 8px 0; text-align: right; color: #8a8a9a; font-family: monospace; font-size: 14px;">
                      ${order.shipping === 0 ? 'FREE' : formatCurrency(order.shipping)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #8a8a9a; font-size: 14px;">Tax</td>
                    <td style="padding: 8px 0; text-align: right; color: #8a8a9a; font-family: monospace; font-size: 14px;">
                      ${formatCurrency(order.tax)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0 0; color: #e8e8ec; font-size: 16px; font-weight: bold; border-top: 1px solid #2a2a3a;">
                      Total
                    </td>
                    <td style="padding: 12px 0 0; text-align: right; color: #f5a623; font-family: monospace; font-size: 18px; font-weight: bold; border-top: 1px solid #2a2a3a;">
                      ${formatCurrency(order.amount)}
                    </td>
                  </tr>
                </table>
              </div>

              ${shippingHtml}

              ${licenseKey ? `
              <!-- License Key -->
              <div style="margin-top: 24px;">
                <div style="color: #f5a623; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">
                  Your License Key
                </div>
                <table role="presentation" style="width: 100%; background-color: #1a1a24; border: 1px solid #2a2a3a; border-radius: 8px;">
                  <tr>
                    <td style="padding: 20px; text-align: center;">
                      <div style="color: #f5a623; font-family: monospace; font-size: 20px; font-weight: bold; letter-spacing: 2px;">
                        ${licenseKey}
                      </div>
                      <div style="color: #8a8a9a; font-size: 12px; margin-top: 8px;">
                        This key will be pre-installed on your SkyGlass device
                      </div>
                    </td>
                  </tr>
                </table>
                <div style="color: #5a5a6a; font-size: 11px; margin-top: 8px; text-align: center;">
                  Keep this key safe - it binds your SkyGlass license to one device
                </div>
              </div>
              ` : ''}

              <!-- What's Next -->
              <div style="margin-top: 32px; padding: 20px; background-color: #1a1a24; border: 1px solid #2a2a3a; border-radius: 8px;">
                <div style="color: #f5a623; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">
                  What's Next
                </div>
                <ul style="margin: 0; padding-left: 20px; color: #8a8a9a; font-size: 14px; line-height: 1.8;">
                  <li>We'll send tracking info when your order ships</li>
                  <li>Estimated delivery: 5-7 business days</li>
                  <li>Assembly guide included in your kit</li>
                </ul>
              </div>

              <!-- Support -->
              <div style="margin-top: 24px; text-align: center;">
                <p style="color: #8a8a9a; font-size: 14px; margin: 0 0 12px;">
                  Questions about your order?
                </p>
                <a href="mailto:support@skyglass.dev" style="color: #f5a623; text-decoration: none; font-size: 14px;">
                  support@skyglass.dev
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #2a2a3a; text-align: center;">
              <p style="margin: 0 0 8px; color: #5a5a6a; font-size: 12px;">
                Built by a pilot, for pilots.
              </p>
              <p style="margin: 0; color: #5a5a6a; font-size: 12px;">
                &copy; ${currentYear} SkyGlass. All rights reserved.
              </p>
              <p style="margin: 16px 0 0; color: #5a5a6a; font-size: 11px;">
                <a href="https://skyglass.dev/privacy" style="color: #5a5a6a; text-decoration: underline;">Privacy Policy</a>
                &nbsp;&middot;&nbsp;
                <a href="https://skyglass.dev/terms" style="color: #5a5a6a; text-decoration: underline;">Terms</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`
}

function getPaymentFailedEmailHtml(paymentIntent: Stripe.PaymentIntent): string {
  const currentYear = new Date().getFullYear()
  const errorMessage =
    paymentIntent.last_payment_error?.message || 'Your payment could not be processed.'

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Issue - SkyGlass</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #12121a; border: 1px solid #2a2a3a; border-radius: 12px;">

          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #2a2a3a;">
              <div style="font-size: 24px; font-weight: bold; letter-spacing: 1px;">
                <span style="color: #e8e8ec;">Sky</span><span style="color: #f5a623;">Glass</span>
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <!-- Warning Icon -->
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; width: 64px; height: 64px; background-color: rgba(239, 68, 68, 0.1); border: 2px solid #ef4444; border-radius: 50%; line-height: 60px; font-size: 28px;">
                  !
                </div>
              </div>

              <h1 style="margin: 0 0 8px; color: #e8e8ec; font-size: 28px; font-weight: bold; text-align: center;">
                Payment Issue
              </h1>
              <p style="margin: 0 0 24px; color: #8a8a9a; font-size: 16px; text-align: center;">
                We couldn't process your payment for SkyGlass.
              </p>

              <!-- Error Card -->
              <table role="presentation" style="width: 100%; background-color: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 20px;">
                    <div style="color: #ef4444; font-size: 14px;">
                      ${errorMessage}
                    </div>
                  </td>
                </tr>
              </table>

              <!-- What To Do -->
              <div style="margin-bottom: 24px;">
                <div style="color: #f5a623; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">
                  What You Can Do
                </div>
                <ul style="margin: 0; padding-left: 20px; color: #8a8a9a; font-size: 14px; line-height: 1.8;">
                  <li>Check that your card details are correct</li>
                  <li>Ensure you have sufficient funds</li>
                  <li>Try a different payment method</li>
                  <li>Contact your bank if the issue persists</li>
                </ul>
              </div>

              <!-- CTA -->
              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="https://skyglass.dev/checkout" style="display: inline-block; padding: 14px 28px; background-color: rgba(245, 166, 35, 0.1); border: 1px solid rgba(245, 166, 35, 0.5); color: #f5a623; text-decoration: none; font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">
                      Try Again
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Support -->
              <div style="margin-top: 24px; text-align: center;">
                <p style="color: #8a8a9a; font-size: 14px; margin: 0 0 12px;">
                  Need help?
                </p>
                <a href="mailto:support@skyglass.dev" style="color: #f5a623; text-decoration: none; font-size: 14px;">
                  support@skyglass.dev
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #2a2a3a; text-align: center;">
              <p style="margin: 0 0 8px; color: #5a5a6a; font-size: 12px;">
                Built by a pilot, for pilots.
              </p>
              <p style="margin: 0; color: #5a5a6a; font-size: 12px;">
                &copy; ${currentYear} SkyGlass. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`
}
