import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { SEO } from '../components'

export function CheckoutSuccess() {
  const orderNumber = `SG-${Date.now().toString(36).toUpperCase()}`

  return (
    <div className="min-h-screen bg-void flex flex-col">
      <SEO title="Order Confirmed" description="Thank you for your SkyGlass order" />

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
            Order Confirmed
          </h1>
          <p className="text-lg text-muted mb-8">
            Thanks for your order! We're getting your SkyGlass ready.
          </p>

          {/* Order details card */}
          <div className="instrument-card p-6 mb-8 text-left">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3 bg-vfr rounded-full animate-pulse" />
              <span className="font-mono text-sm text-vfr uppercase tracking-wider">
                Order Placed
              </span>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted">Order number</span>
                <span className="font-mono text-light">{orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Estimated ship date</span>
                <span className="font-mono text-light">2-3 weeks</span>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-border">
              <p className="text-sm text-muted">
                A confirmation email has been sent to your email address with
                tracking information and setup instructions.
              </p>
            </div>
          </div>

          {/* What's next */}
          <div className="text-left mb-8">
            <h2 className="font-display text-lg font-semibold text-light mb-4">
              What happens next?
            </h2>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-amber/10 border border-amber/30 flex items-center justify-center flex-shrink-0">
                  <span className="font-mono text-sm text-amber">1</span>
                </div>
                <div>
                  <p className="font-semibold text-light">We'll prepare your kit</p>
                  <p className="text-sm text-muted">Testing, assembly, and quality check</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-amber/10 border border-amber/30 flex items-center justify-center flex-shrink-0">
                  <span className="font-mono text-sm text-amber">2</span>
                </div>
                <div>
                  <p className="font-semibold text-light">Shipping notification</p>
                  <p className="text-sm text-muted">You'll get tracking info via email</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-amber/10 border border-amber/30 flex items-center justify-center flex-shrink-0">
                  <span className="font-mono text-sm text-amber">3</span>
                </div>
                <div>
                  <p className="font-semibold text-light">Setup & enjoy</p>
                  <p className="text-sm text-muted">Mount, configure, and start your mornings right</p>
                </div>
              </div>
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
