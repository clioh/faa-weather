import { motion, AnimatePresence } from 'motion/react'
import { Link } from 'react-router-dom'
import { useCart, formatPrice } from '../store/cart'

export function CartDrawer() {
  const { items, isOpen, closeCart, removeItem, updateQuantity, total, itemCount } = useCart()

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeCart}
            className="fixed inset-0 bg-void/80 backdrop-blur-sm z-50"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-panel border-l border-border z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-xl font-bold text-light">Your Cart</h2>
                {itemCount() > 0 && (
                  <span className="px-2 py-0.5 bg-amber/10 border border-amber/30 rounded text-amber font-mono text-xs">
                    {itemCount()} {itemCount() === 1 ? 'item' : 'items'}
                  </span>
                )}
              </div>
              <button
                onClick={closeCart}
                className="w-10 h-10 flex items-center justify-center text-muted hover:text-light transition-colors"
                aria-label="Close cart"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Cart Items */}
            <div className="flex-1 overflow-y-auto p-6">
              {items.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-panel border border-border flex items-center justify-center">
                    <svg className="w-8 h-8 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                  </div>
                  <p className="text-muted mb-4">Your cart is empty</p>
                  <button
                    onClick={closeCart}
                    className="text-amber hover:underline text-sm"
                  >
                    Continue browsing
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {items.map((item) => (
                    <div
                      key={item.product.id}
                      className="instrument-card p-4"
                    >
                      <div className="flex gap-4">
                        {/* Product icon */}
                        <div className="w-16 h-16 bg-instrument border border-border rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-8 h-8 text-amber/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <rect x="3" y="2" width="18" height="20" rx="2" strokeWidth={1.5} />
                            <circle cx="18" cy="5" r="1.5" fill="currentColor" />
                          </svg>
                        </div>

                        {/* Product info */}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-display font-semibold text-light truncate">
                            {item.product.name}
                          </h3>
                          <p className="text-amber font-mono text-sm">
                            {formatPrice(item.product.price)}
                          </p>

                          {/* Quantity controls */}
                          <div className="flex items-center gap-3 mt-3">
                            <div className="flex items-center border border-border rounded">
                              <button
                                onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                                className="w-8 h-8 flex items-center justify-center text-muted hover:text-light transition-colors"
                                aria-label="Decrease quantity"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                </svg>
                              </button>
                              <span className="w-8 text-center font-mono text-sm text-light">
                                {item.quantity}
                              </span>
                              <button
                                onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                                className="w-8 h-8 flex items-center justify-center text-muted hover:text-light transition-colors"
                                aria-label="Increase quantity"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                              </button>
                            </div>

                            <button
                              onClick={() => removeItem(item.product.id)}
                              className="text-muted hover:text-ifr transition-colors text-sm"
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        {/* Line total */}
                        <div className="text-right">
                          <span className="font-mono text-light">
                            {formatPrice(item.product.price * item.quantity)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="border-t border-border p-6 space-y-4">
                {/* Subtotal */}
                <div className="flex items-center justify-between">
                  <span className="text-muted">Subtotal</span>
                  <span className="font-display text-xl font-bold text-light">
                    {formatPrice(total())}
                  </span>
                </div>

                <p className="text-xs text-muted">
                  Shipping and taxes calculated at checkout
                </p>

                {/* Checkout button */}
                <Link
                  to="/checkout"
                  onClick={closeCart}
                  className="block w-full btn-primary text-center"
                >
                  Checkout
                </Link>

                {/* Continue shopping */}
                <button
                  onClick={closeCart}
                  className="w-full text-center text-sm text-muted hover:text-light transition-colors"
                >
                  Continue Shopping
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
