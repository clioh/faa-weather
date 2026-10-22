import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Link, useSearchParams } from 'react-router-dom'
import { SEO } from '../components'
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
    <div className="min-h-screen bg-void flex flex-col">
      <SEO
        title={isProcessing ? 'Payment Processing' : 'Order Confirmed'}
        description="Thank you for your SkyGlass order"
      />

      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <Link to="/" className="flex items-center gap-3" aria-label="SkyGlass - Back to home">
            <div className="w-10 h-10 bg-instrument border border-amber/30 rounded-lg flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-amber" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="2" width="18" height="20" rx="2" />
                <circle cx="18" cy="5" r="1.5" fill="currentColor" />
              </svg>
            </div>
            <span className="font-display text-xl font-bold">
              <span className="text-light">Sky</span>
              <span className="text-amber">Glass</span>
            </span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-lg w-full text-center"
        >
          {/* Success icon */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="w-24 h-24 mx-auto mb-8 rounded-full bg-vfr/20 border border-vfr/50 flex items-center justify-center"
          >
            <svg className="w-12 h-12 text-vfr" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

          <h1 className="font-display text-3xl font-bold text-light mb-2">
            {isProcessing ? 'Payment Processing' : 'Order Confirmed'}
          </h1>
          <p className="text-lg text-muted mb-8">
            {isProcessing
              ? "Thanks for your order! Your payment is still processing. We'll email you as soon as it clears."
              : hasKit && hasSoftwareLicense
                ? "Thanks for your order! Your license key is on its way and we're getting your kit ready."
                : hasKit
                  ? "Thanks for your order! We're getting your SkyGlass ready."
                  : 'Thanks for your order! Your SkyGlass license is on its way.'}
          </p>

          {/* Order details card */}
          <div className="instrument-card p-6 mb-8 text-left">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3 bg-vfr rounded-full animate-pulse" />
              <span className="font-mono text-sm text-vfr uppercase tracking-wider">
                {isProcessing ? 'Payment Processing' : 'Order Placed'}
              </span>
            </div>

            <div className="space-y-3">
              {orderNumber && (
                <div className="flex justify-between">
                  <span className="text-muted">Order number</span>
                  <span className="font-mono text-light">{orderNumber}</span>
                </div>
              )}
              {hasKit && (
                <div className="flex justify-between">
                  <span className="text-muted">Estimated ship date</span>
                  <span className="font-mono text-light">
                    {isPreorderMode() ? 'Pre-order, emailed when it ships' : '2-3 weeks'}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-border space-y-3">
              <p className="text-sm text-muted">
                {isProcessing
                  ? "We'll send a confirmation email once your payment clears."
                  : hasKit
                  ? 'A confirmation email has been sent to your email address with tracking information and setup instructions.'
                  : 'A confirmation email has been sent to your email address with your license key and setup instructions.'}
              </p>
              {hasSoftwareLicense && (
                <p className="text-sm text-muted">
                  <span className="text-light">Software License:</span> your license key is in the
                  confirmation email. Enter it in the SkyGlass app when setting up your mirror.
                </p>
              )}
              {hasKit && (
                <p className="text-sm text-muted">
                  <span className="text-light">Kits:</span> the license comes pre-installed on the
                  SD card. Your mirror activates it on first boot, so there's no key to type.
                </p>
              )}
              <p className="text-sm text-muted">
                Moving to a new mirror later? Release your license at{' '}
                <Link to="/license" className="text-amber hover:underline">
                  skyglass.dev/license
                </Link>
                .
              </p>
            </div>
          </div>

          {/* What's next */}
          <div className="text-left mb-8">
            <h2 className="font-display text-lg font-semibold text-light mb-4">
              What happens next?
            </h2>
            <div className="space-y-4">
              {nextSteps.map((item, index) => (
                <div key={item.title} className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-amber/10 border border-amber/30 flex items-center justify-center flex-shrink-0">
                    <span className="font-mono text-sm text-amber">{index + 1}</span>
                  </div>
                  <div>
                    <p className="font-semibold text-light">{item.title}</p>
                    <p className="text-sm text-muted">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/" className="btn-primary">
              Back to Home
            </Link>
            <a
              href="mailto:support@skyglass.dev"
              className="px-6 py-3 bg-panel border border-border text-muted font-display text-sm uppercase tracking-wider hover:text-light hover:border-light/30 transition-colors"
            >
              Contact Support
            </a>
          </div>
        </motion.div>
      </main>
    </div>
  )
}

function PaymentFailed() {
  return (
    <div className="min-h-screen bg-void flex flex-col">
      <SEO title="Payment Not Completed" description="Your SkyGlass payment didn't go through" />

      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <Link to="/" className="flex items-center gap-3" aria-label="SkyGlass - Back to home">
            <div className="w-10 h-10 bg-instrument border border-amber/30 rounded-lg flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-amber" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="2" width="18" height="20" rx="2" />
                <circle cx="18" cy="5" r="1.5" fill="currentColor" />
              </svg>
            </div>
            <span className="font-display text-xl font-bold">
              <span className="text-light">Sky</span>
              <span className="text-amber">Glass</span>
            </span>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-lg w-full text-center">
          <div className="w-24 h-24 mx-auto mb-8 rounded-full bg-ifr/10 border border-ifr/30 flex items-center justify-center">
            <svg className="w-12 h-12 text-ifr" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          <h1 className="font-display text-3xl font-bold text-light mb-2">
            Payment didn't go through
          </h1>
          <p className="text-lg text-muted mb-8">
            You haven't been charged. Your cart is saved, so you can try again with the same or a
            different payment method.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/checkout" className="btn-primary">
              Return to Checkout
            </Link>
            <a
              href="mailto:support@skyglass.dev"
              className="px-6 py-3 bg-panel border border-border text-muted font-display text-sm uppercase tracking-wider hover:text-light hover:border-light/30 transition-colors"
            >
              Contact Support
            </a>
          </div>
        </div>
      </main>
    </div>
  )
}
