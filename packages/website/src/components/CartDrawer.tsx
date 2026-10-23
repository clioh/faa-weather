import { motion, AnimatePresence } from 'motion/react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useCart, formatPrice, cartRequiresShipping, MAX_QUANTITY_PER_ITEM } from '../store/cart'

export function CartDrawer() {
  const { items, isOpen, closeCart, removeItem, updateQuantity, total, itemCount } = useCart()

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, closeCart])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop: black 66% scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeCart}
            className="fixed inset-0 bg-black/[0.66] z-50"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-surface-elevated border-l border-line z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-4 pl-6 pr-3 py-4 border-b border-line">
              <div className="flex items-baseline gap-3">
                <h2 className="text-xl font-normal text-fg">Your cart</h2>
                {itemCount() > 0 && (
                  <span className="font-mono text-xs text-fg-3">
                    {itemCount()} {itemCount() === 1 ? 'item' : 'items'}
                  </span>
                )}
              </div>
              <button
                onClick={closeCart}
                className="w-11 h-11 flex items-center justify-center rounded-full text-fg-2 hover:text-fg transition-colors"
                aria-label="Close cart"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Cart Items */}
            <div className="flex-1 overflow-y-auto px-6">
              {items.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full border border-line flex items-center justify-center">
                    <svg
                      className="w-8 h-8 text-fg-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                      />
                    </svg>
                  </div>
                  <p className="text-fg-2 mb-2">Your cart is empty</p>
                  <button onClick={closeCart} className="link text-sm min-h-11 px-2">
                    Continue browsing
                  </button>
                </div>
              ) : (
                <ul>
                  {items.map((item) => (
                    <li key={item.product.id} className="py-5 border-b border-line last:border-b-0">
                      <div className="flex gap-4">
                        {/* Product icon */}
                        <div className="w-14 h-14 rounded-xl border border-line bg-tint flex items-center justify-center flex-shrink-0">
                          <svg
                            className="w-7 h-7 text-fg-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <rect x="3" y="2" width="18" height="20" rx="2" strokeWidth={1.5} />
                            <circle cx="18" cy="5" r="1.5" fill="currentColor" />
                          </svg>
                        </div>

                        {/* Product info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-medium text-fg truncate">{item.product.name}</h3>
                            {/* Line total */}
                            <span className="font-mono text-fg flex-shrink-0">
                              {formatPrice(item.product.price * item.quantity)}
                            </span>
                          </div>
                          <p className="text-fg-2 font-mono text-sm">
                            {formatPrice(item.product.price)}
                          </p>

                          {/* Quantity controls */}
                          <div className="flex items-center gap-2 mt-3">
                            <div className="flex items-center rounded-full border border-line-strong">
                              <button
                                onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                                className="w-11 h-11 flex items-center justify-center rounded-full text-fg-2 hover:text-fg transition-colors"
                                aria-label="Decrease quantity"
                              >
                                <svg
                                  className="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                  aria-hidden="true"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M20 12H4"
                                  />
                                </svg>
                              </button>
                              <span
                                className="w-8 text-center font-mono text-sm text-fg"
                                aria-live="polite"
                              >
                                {item.quantity}
                              </span>
                              <button
                                onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                                disabled={item.quantity >= MAX_QUANTITY_PER_ITEM}
                                title={
                                  item.quantity >= MAX_QUANTITY_PER_ITEM
                                    ? `Limit ${MAX_QUANTITY_PER_ITEM} per order`
                                    : undefined
                                }
                                className="w-11 h-11 flex items-center justify-center rounded-full text-fg-2 hover:text-fg transition-colors disabled:text-fg-disabled disabled:cursor-not-allowed"
                                aria-label="Increase quantity"
                              >
                                <svg
                                  className="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                  aria-hidden="true"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M12 4v16m8-8H4"
                                  />
                                </svg>
                              </button>
                            </div>

                            <button
                              onClick={() => removeItem(item.product.id)}
                              className="min-h-11 px-3 text-sm text-fg-2 hover:text-danger transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="border-t border-line px-6 pt-5 pb-6 space-y-4">
                {/* Subtotal */}
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-fg-2">Subtotal</span>
                  <span className="font-mono text-xl text-fg">{formatPrice(total())}</span>
                </div>

                <p className="text-xs text-fg-3">
                  {cartRequiresShipping(items)
                    ? 'Shipping and taxes calculated at checkout'
                    : 'Taxes calculated at checkout. Your license key is delivered by email.'}
                </p>

                {/* Checkout button */}
                <Link to="/checkout" onClick={closeCart} className="btn btn-primary w-full">
                  Checkout
                </Link>

                {/* Continue shopping */}
                <button
                  onClick={closeCart}
                  className="w-full min-h-11 text-center text-sm text-fg-2 hover:text-fg transition-colors"
                >
                  Continue shopping
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
