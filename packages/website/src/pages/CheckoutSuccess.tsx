import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Link, useSearchParams } from 'react-router-dom'
import { SEO, PageHeader, SiteFooter } from '../components'
import { useCart, cartRequiresShipping } from '../store/cart'
import { isPreorderMode } from '../config/features'

const LICENSE_STEPS = [
  { title: 'Check your email', detail: 'Your license key is in the confirmation email' },
  { title: 'Build & flash', detail: 'Follow the DIY build guide and flash the SkyGlass OS image' },
  { title: 'Activate in the app', detail: 'Enter your key in the SkyGlass app during setup' },
]

const KIT_STEPS = [
  { title: "We'll prepare your kit", detail: 'Testing, assembly, and quality check' },
  { title: 'Shipping notification', detail: "You'll get tracking info via email" },
  { title: 'Setup & enjoy', detail: 'Mount, configure, and start your mornings right' },
]

// Stripe's redirect_status values that mean no money moved
const FAILED_STATUSES = new Set(['requires_payment_method', 'failed', 'canceled'])

export function CheckoutSuccess() {
  const [searchParams] = useSearchParams()
  const clearCart = useCart((state) => state.clearCart)

  // Same format as the confirmation email (api/webhook.ts): last 8 chars of the PaymentIntent id
  const paymentIntentId = searchParams.get('payment_intent')
  const orderNumber = paymentIntentId ? `#${paymentIntentId.slice(-8).toUpperCase()}` : null

  // Stripe redirects here with the cart still populated. Snapshot what was bought, then clear it.
  const [purchased] = useState(() => useCart.getState().items)
  const redirectStatus = searchParams.get('redirect_status')
  const paymentFailed = redirectStatus !== null && FAILED_STATUSES.has(redirectStatus)
  const isProcessing = redirectStatus === 'processing'
  useEffect(() => {
    // A failed payment keeps the cart so the buyer can retry
    if (redirectStatus === 'succeeded' || redirectStatus === 'processing') {
      clearCart()
    }
  }, [redirectStatus, clearCart])

  // Unknown contents (e.g. page reloaded after the cart was cleared): show both delivery paths.
  const known = purchased.length > 0
  const hasSoftwareLicense = !known || purchased.some((item) => !item.product.physical)
  const hasKit = !known || cartRequiresShipping(purchased)

  const nextSteps = [...(hasSoftwareLicense ? LICENSE_STEPS : []), ...(hasKit ? KIT_STEPS : [])]

  if (paymentFailed) {
    return <PaymentFailed />
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <SEO
        title={isProcessing ? 'Payment Processing' : 'Order Confirmed'}
        description="Thank you for your SkyGlass order"
      />

      <PageHeader />

      {/* Content */}
      <main className="page-container flex-1 pt-6 pb-20 sm:pt-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-lg mx-auto w-full text-center"
        >
          {/* Success icon: accent tick (success uses the accent) */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="w-20 h-20 mx-auto mb-8 rounded-full bg-accent-muted border border-accent/50 flex items-center justify-center"
          >
            <svg className="w-10 h-10 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <motion.path
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ delay: 0.4, duration: 0.5 }}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </motion.div>

          <h1 className="display-3 text-fg mb-3">
            {isProcessing ? 'Payment processing' : 'Order confirmed'}
          </h1>
          <p className="text-[17px] leading-relaxed text-fg-2 mb-10">
            {isProcessing
              ? "Thanks for your order! Your payment is still processing. We'll email you as soon as it clears."
              : hasKit && hasSoftwareLicense
                ? "Thanks for your order! Your license key is on its way and we're getting your kit ready."
                : hasKit
                  ? "Thanks for your order! We're getting your SkyGlass ready."
                  : 'Thanks for your order! Your SkyGlass license is on its way.'}
          </p>

          {/* Order details */}
          <div className="panel p-5 sm:p-6 mb-10 text-left">
            <div className="flex items-center gap-3 mb-2">
              <span
                className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-warning animate-pulse' : 'bg-accent'}`}
                aria-hidden="true"
              />
              <span
                className={`font-mono text-xs uppercase tracking-[0.14em] ${isProcessing ? 'text-warning' : 'text-accent'}`}
              >
                {isProcessing ? 'Payment Processing' : 'Order Placed'}
              </span>
            </div>

            <dl className="text-sm">
              {orderNumber && (
                <div className="flex justify-between gap-4 py-3 border-b border-line">
                  <dt className="text-fg-2">Order number</dt>
                  <dd className="font-mono text-fg">{orderNumber}</dd>
                </div>
              )}
              {hasKit && (
                <div className="flex justify-between gap-4 py-3 border-b border-line">
                  <dt className="text-fg-2">Estimated ship date</dt>
                  <dd className="font-mono text-fg text-right">
                    {isPreorderMode() ? 'Pre-order, emailed when it ships' : '2-3 weeks'}
                  </dd>
                </div>
              )}
            </dl>

            <div className="pt-4 space-y-3">
              <p className="text-sm text-fg-2">
                {isProcessing
                  ? "We'll send a confirmation email once your payment clears."
                  : hasKit
                  ? 'A confirmation email has been sent to your email address with tracking information and setup instructions.'
                  : 'A confirmation email has been sent to your email address with your license key and setup instructions.'}
              </p>
              {hasSoftwareLicense && (
                <p className="text-sm text-fg-2">
                  <span className="text-fg font-medium">Software License:</span> your license key is in the
                  confirmation email. Enter it in the SkyGlass app when setting up your mirror.
                </p>
              )}
              {hasKit && (
                <p className="text-sm text-fg-2">
                  <span className="text-fg font-medium">Kits:</span> the license comes pre-installed on the
                  SD card. Your mirror activates it on first boot, so there's no key to type.
                </p>
              )}
              <p className="text-sm text-fg-2">
                Moving to a new mirror later? Release your license at{' '}
                <Link to="/license" className="link">
                  skyglass.dev/license
                </Link>
                .
              </p>
            </div>
          </div>

          {/* What's next */}
          <div className="text-left mb-10">
            <h2 className="section-label mb-2">What happens next?</h2>
            <ol>
              {nextSteps.map((item, index) => (
                <li key={item.title} className="flex gap-4 py-4 border-t border-line last:border-b">
                  <div className="w-8 h-8 rounded-full border border-line-strong flex items-center justify-center flex-shrink-0">
                    <span className="font-mono text-sm text-fg-2">{index + 1}</span>
                  </div>
                  <div>
                    <p className="font-medium text-fg">{item.title}</p>
                    <p className="text-sm text-fg-2">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/" className="btn btn-primary">
              Back to home
            </Link>
            <a href="mailto:support@skyglass.dev" className="btn btn-secondary">
              Contact support
            </a>
          </div>
        </motion.div>
      </main>

      <SiteFooter />
    </div>
  )
}

function PaymentFailed() {
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <SEO title="Payment Not Completed" description="Your SkyGlass payment didn't go through" />

      <PageHeader />

      <main className="page-container flex-1 flex items-center justify-center py-16">
        <div className="max-w-lg w-full text-center">
          <div className="w-20 h-20 mx-auto mb-8 rounded-full bg-danger/[0.08] border border-danger/40 flex items-center justify-center">
            <svg className="w-10 h-10 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          <h1 className="display-3 text-fg mb-3">
            Payment didn't go through
          </h1>
          <p className="text-[17px] leading-relaxed text-fg-2 mb-10">
            You haven't been charged. Your cart is saved, so you can try again with the same or a
            different payment method.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/checkout" className="btn btn-primary">
              Return to checkout
            </Link>
            <a href="mailto:support@skyglass.dev" className="btn btn-secondary">
              Contact support
            </a>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
