import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useCart } from '../store/cart'
import { canPurchase } from '../config/features'

interface NavigationProps {
  onWaitlistClick: () => void
}

export function Navigation({ onWaitlistClick }: NavigationProps) {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const { openCart, itemCount } = useCart()
  const ecommerceEnabled = canPurchase()
  const cartCount = itemCount()

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const navLinks = [
    { label: 'Features', href: '#features' },
    { label: 'How It Works', href: '#how-it-works' },
    { label: 'App', href: '#customize' },
    { label: 'Demo', href: '#demo' },
    { label: 'Pricing', href: '#pricing' },
  ]

  return (
    <>
      <motion.nav
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled
            ? 'bg-void/90 backdrop-blur-lg border-b border-border'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          {/* Logo */}
          <a href="#" className="flex items-center gap-3 group" aria-label="SkyGlass - Back to top">
            <div className="relative w-10 h-10">
              <div className="absolute inset-0 bg-amber/20 rounded-lg blur-lg group-hover:bg-amber/30 transition-colors" />
              <div className="relative w-full h-full bg-instrument border border-amber/30 rounded-lg flex items-center justify-center">
                <svg
                  viewBox="0 0 24 24"
                  className="w-6 h-6 text-amber"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <rect x="3" y="2" width="18" height="20" rx="2" />
                  <circle cx="18" cy="5" r="1.5" fill="currentColor" />
                  <text
                    x="5"
                    y="10"
                    fontSize="4"
                    fontFamily="monospace"
                    fill="currentColor"
                  >
                    08:42
                  </text>
                </svg>
              </div>
            </div>
            <span className="font-display text-xl font-bold tracking-wide">
              <span className="text-light">Sky</span>
              <span className="text-amber">Glass</span>
            </span>
          </a>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="font-display text-sm uppercase tracking-wider text-muted hover:text-amber transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-4">
            {ecommerceEnabled ? (
              <>
                {/* Cart button */}
                <button
                  onClick={openCart}
                  className="relative w-10 h-10 flex items-center justify-center text-muted hover:text-amber transition-colors"
                  aria-label={`Shopping cart${cartCount > 0 ? `, ${cartCount} items` : ''}`}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                  {cartCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-amber text-void text-xs font-bold rounded-full flex items-center justify-center">
                      {cartCount}
                    </span>
                  )}
                </button>
                {/* Buy button */}
                <a
                  href="#pricing"
                  className="px-6 py-2.5 bg-amber/10 border border-amber/50 text-amber font-display text-sm uppercase tracking-wider hover:bg-amber/20 hover:border-amber transition-all"
                >
                  Buy Now
                </a>
              </>
            ) : (
              <button
                onClick={onWaitlistClick}
                className="px-6 py-2.5 bg-amber/10 border border-amber/50 text-amber font-display text-sm uppercase tracking-wider hover:bg-amber/20 hover:border-amber transition-all"
              >
                Join Waitlist
              </button>
            )}
          </div>

          {/* Mobile: Cart + Menu Button */}
          <div className="md:hidden flex items-center gap-2">
            {ecommerceEnabled && (
              <button
                onClick={openCart}
                className="relative w-10 h-10 flex items-center justify-center text-muted hover:text-amber transition-colors"
                aria-label={`Shopping cart${cartCount > 0 ? `, ${cartCount} items` : ''}`}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-amber text-void text-xs font-bold rounded-full flex items-center justify-center">
                    {cartCount}
                  </span>
                )}
              </button>
            )}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="w-10 h-10 flex flex-col items-center justify-center gap-1.5"
              aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={isMobileMenuOpen}
            >
              <motion.span
                animate={isMobileMenuOpen ? { rotate: 45, y: 6 } : { rotate: 0, y: 0 }}
                className="w-6 h-0.5 bg-amber"
              />
              <motion.span
                animate={isMobileMenuOpen ? { opacity: 0 } : { opacity: 1 }}
                className="w-6 h-0.5 bg-amber"
              />
              <motion.span
                animate={isMobileMenuOpen ? { rotate: -45, y: -6 } : { rotate: 0, y: 0 }}
                className="w-6 h-0.5 bg-amber"
              />
            </button>
          </div>
        </div>
      </motion.nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed inset-0 z-40 bg-void/98 backdrop-blur-lg md:hidden pt-24"
          >
            <div className="flex flex-col items-center gap-8 p-8">
              {navLinks.map((link, i) => (
                <motion.a
                  key={link.href}
                  href={link.href}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="font-display text-2xl uppercase tracking-wider text-light hover:text-amber transition-colors"
                >
                  {link.label}
                </motion.a>
              ))}
              <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                onClick={() => {
                  setIsMobileMenuOpen(false)
                  if (ecommerceEnabled) {
                    window.location.hash = '#pricing'
                  } else {
                    onWaitlistClick()
                  }
                }}
                className="mt-4 btn-primary"
              >
                {ecommerceEnabled ? 'Buy Now' : 'Join Waitlist'}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
