import { useEffect, useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { Navigation, WaitlistModal, CartDrawer } from './components'
import { Home, Privacy, Terms, Team, Checkout, CheckoutSuccess, NotFound, Admin, License } from './pages'
import { canPurchase } from './config/features'

// /license?token=… is a sign-in link from email. Never send the token to analytics.
function redactLicenseToken<T extends { url: string }>(event: T): T {
  const url = new URL(event.url)
  if (!url.searchParams.has('token')) return event
  url.searchParams.delete('token')
  return { ...event, url: url.toString() }
}

// Scroll to the element named by the URL hash (e.g. /terms#refunds) after a
// navigation. The browser only does this on a full page load, and in an SPA the
// target may not be rendered yet then, so retry for a few frames.
function ScrollToHash() {
  const { pathname, hash, key } = useLocation()
  useEffect(() => {
    if (!hash) return
    const id = decodeURIComponent(hash.slice(1))
    let frame = 0
    let tries = 0
    const tryScroll = () => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView()
      else if (tries++ < 30) frame = requestAnimationFrame(tryScroll)
    }
    tryScroll()
    return () => cancelAnimationFrame(frame)
  }, [pathname, hash, key])
  return null
}

export default function App() {
  const [isWaitlistOpen, setIsWaitlistOpen] = useState(false)

  const openWaitlist = () => setIsWaitlistOpen(true)
  const closeWaitlist = () => setIsWaitlistOpen(false)

  const ecommerceEnabled = canPurchase()

  return (
    <div className="relative noise">
      <ScrollToHash />
      <Routes>
        <Route
          path="/"
          element={
            <>
              <Navigation onWaitlistClick={openWaitlist} />
              <main>
                <Home onWaitlistClick={openWaitlist} />
              </main>
            </>
          }
        />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/team" element={<Team />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/license" element={<License />} />
        {/* E-commerce routes - only available when feature flag is enabled */}
        {ecommerceEnabled && (
          <>
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/checkout/success" element={<CheckoutSuccess />} />
          </>
        )}
        <Route path="*" element={<NotFound />} />
      </Routes>

      <WaitlistModal isOpen={isWaitlistOpen} onClose={closeWaitlist} />
      {ecommerceEnabled && <CartDrawer />}
      <Analytics beforeSend={redactLicenseToken} />
    </div>
  )
}
