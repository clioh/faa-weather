import { motion } from 'motion/react'
import { useInView } from 'motion/react'
import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { products, useCart, formatPrice } from '../store/cart'
import { canPurchase, isPreorderMode } from '../config/features'
import { FREE_SHIPPING_THRESHOLD_CENTS, centsToDollars } from '../../shared/catalog'

interface PricingProps {
  onWaitlistClick: () => void
}

export function Pricing({ onWaitlistClick }: PricingProps) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  const { addItem } = useCart()
  const ecommerceEnabled = canPurchase()

  const handleProductAction = (product: typeof products[0]) => {
    if (!ecommerceEnabled) {
      onWaitlistClick()
      return
    }

    // Add to cart
    addItem(product)
  }

  const buttonText = ecommerceEnabled ? 'Add to Cart' : 'Join Waitlist'

  return (
    <section id="pricing" className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-void" />
      <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-10" />

      <div ref={ref} className="relative z-10 max-w-6xl mx-auto px-6">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <h2 className="font-display text-4xl md:text-5xl font-bold text-light mb-6">
            Pick your <span className="text-gradient-amber">build.</span>
          </h2>
          <p className="text-lg text-muted max-w-xl mx-auto">
            A software license for tinkerers, or a complete kit ready to mount.
            Lifetime updates included.
          </p>
        </motion.div>

        {/* Pricing cards */}
        <div className="grid md:grid-cols-3 gap-8">
          {products.map((product, index) => {
            const isPopular = product.popular
            return (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 30 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className={`relative instrument-card p-8 flex flex-col ${
                  isPopular ? 'border-amber/50 md:scale-105' : ''
                }`}
              >
                {/* Popular badge */}
                {isPopular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-amber text-void font-display text-xs uppercase tracking-wider font-bold">
                    Most Popular
                  </div>
                )}

                {/* Secondary badge */}
                {product.badge && !isPopular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-vfr text-void font-display text-xs uppercase tracking-wider font-bold">
                    {product.badge}
                  </div>
                )}

                {/* Header */}
                <div className="mb-6">
                  <h3 className="font-display text-xl font-bold text-light mb-2">
                    {product.name}
                  </h3>
                  <p className="text-sm text-muted">
                    {product.description}
                  </p>
                </div>

                {/* Price */}
                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="font-display text-4xl font-bold text-light">
                      {formatPrice(product.price)}
                    </span>
                    <span className="text-muted">USD</span>
                  </div>
                  <div className="text-sm text-muted mt-1">
                    {product.physical
                      ? isPreorderMode()
                        ? 'Pre-order, refundable until it ships'
                        : 'Ships in 2–3 weeks'
                      : 'Key delivered by email'}
                  </div>
                </div>

                {/* Features */}
                <ul className="space-y-3 mb-8 flex-1">
                  {product.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <svg
                        className="w-5 h-5 text-vfr flex-shrink-0 mt-0.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span className="text-sm text-muted">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <button
                  onClick={() => handleProductAction(product)}
                  className={`w-full py-4 font-display text-sm uppercase tracking-wider font-semibold transition-all ${
                    isPopular
                      ? 'bg-amber text-void hover:shadow-[0_0_30px_rgba(255,179,0,0.3)]'
                      : 'bg-transparent border-2 border-amber/50 text-amber hover:bg-amber/10 hover:border-amber'
                  }`}
                >
                  {buttonText}
                </button>
              </motion.div>
            )
          })}
        </div>

        {/* Bottom note */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="text-center mt-12"
        >
          <p className="text-sm text-muted">
            {ecommerceEnabled ? (
              <>
                Free shipping on orders over {formatPrice(centsToDollars(FREE_SHIPPING_THRESHOLD_CENTS))}. One license per mirror,
                transferable from{' '}
                <Link to="/license" className="text-amber hover:underline">
                  your license page
                </Link>
                .{' '}
                <a href="mailto:hello@skyglass.dev" className="text-amber hover:underline">
                  Questions?
                </a>
              </>
            ) : (
              <>
                Questions?{' '}
                <a href="mailto:hello@skyglass.dev" className="text-amber hover:underline">
                  hello@skyglass.dev
                </a>
              </>
            )}
          </p>
        </motion.div>
      </div>
    </section>
  )
}
