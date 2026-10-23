import { useEffect, useState, type MouseEventHandler } from 'react'
import { useCart } from '../store/cart'
import { canPurchase } from '../config/features'
import { Logo } from './site'

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
]

function CartButton({
  count,
  onClick,
}: {
  count: number
  onClick: MouseEventHandler<HTMLButtonElement>
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-2 transition-colors hover:text-fg"
      aria-label={`Shopping cart${count > 0 ? `, ${count} item${count === 1 ? '' : 's'}` : ''}`}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M16 11V7a4 4 0 0 0-8 0v4M5 9h14l1 12H4L5 9z" />
      </svg>
      {count > 0 && (
        <span className="absolute top-1 right-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[11px] font-medium text-on-accent">
          {count}
        </span>
      )}
    </button>
  )
}

export function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const { openCart, itemCount } = useCart()
  const ecommerceEnabled = canPurchase()
  const cartCount = itemCount()

  const cta = ecommerceEnabled
    ? { label: 'Buy now', href: '#pricing' }
    : { label: 'Join the waitlist', href: '#waitlist' }

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Full-screen menu: lock page scroll and close on Escape.
  useEffect(() => {
    if (!isMenuOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [isMenuOpen])

  const closeMenu = () => setIsMenuOpen(false)

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-colors duration-200 ${
        // No backdrop-filter while the menu is open: it would become the containing
        // block of the fixed menu panel and clip it to the header.
        isMenuOpen
          ? 'border-line bg-bg'
          : isScrolled
            ? 'border-line bg-bg/90 backdrop-blur-md'
            : 'border-transparent bg-bg'
      }`}
    >
      <div className="site-container flex items-center justify-between gap-4 py-3 md:py-5">
        <Logo to="#top" />

        <nav aria-label="Main" className="hidden items-center gap-7 text-sm md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-fg-2 transition-colors hover:text-fg"
            >
              {link.label}
            </a>
          ))}
          {ecommerceEnabled && <CartButton count={cartCount} onClick={openCart} />}
          <a href={cta.href} className="btn btn-primary btn-sm">
            {cta.label}
          </a>
        </nav>

        <div className="flex items-center gap-1 md:hidden">
          {ecommerceEnabled && <CartButton count={cartCount} onClick={openCart} />}
          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-fg"
            aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-menu"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {isMenuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
            </svg>
          </button>
        </div>
      </div>

      {isMenuOpen && (
        <div
          id="mobile-menu"
          className="fixed inset-x-0 top-[69px] bottom-0 z-40 overflow-y-auto bg-bg md:hidden"
        >
          <nav aria-label="Main" className="site-container flex flex-col pt-4 pb-10">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                className="flex min-h-14 items-center border-b border-line text-2xl font-light text-fg"
              >
                {link.label}
              </a>
            ))}
            <a href={cta.href} onClick={closeMenu} className="btn btn-primary mt-8 w-full">
              {cta.label}
            </a>
          </nav>
        </div>
      )}
    </header>
  )
}
