import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { Navigation, CartDrawer, SiteFooter } from './components'
import {
  Home,
  Privacy,
  Terms,
  Team,
  Checkout,
  CheckoutSuccess,
  NotFound,
  Admin,
  License,
  Invite,
  Connect,
  GetApp,
} from './pages'
import { canPurchase } from './config/features'

// /license?token=… is a sign-in link from email, /invite#…&t=… carries a single-use invite
// token and /connect#…&pair=… a single-use pairing secret in the fragment. Never send any of
// them to analytics.
const FRAGMENT_SECRET_PATHS = ['/invite', '/connect']

const hasFragmentSecret = (pathname: string) =>
  FRAGMENT_SECRET_PATHS.some((path) => pathname.startsWith(path))

function redactTokens<T extends { url: string }>(event: T): T {
  const url = new URL(event.url)
  const hasToken = url.searchParams.has('token')
  if (!hasToken && !url.hash) return event
  url.searchParams.delete('token')
  if (hasFragmentSecret(url.pathname)) url.hash = ''
  return { ...event, url: url.toString() }
}

// Scroll to the element named by the URL hash (e.g. /terms#refunds) after a
// navigation. The browser only does this on a full page load, and in an SPA the
// target may not be rendered yet then, so retry for a few frames.
function ScrollToHash() {
  const { pathname, hash, key } = useLocation()
  useEffect(() => {
    // /invite and /connect keep their parameters in the hash; it is not an element id.
    if (!hash || hasFragmentSecret(pathname)) return
    let id: string
    try {
      id = decodeURIComponent(hash.slice(1))
    } catch {
      return
    }
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
  const ecommerceEnabled = canPurchase()

  return (
    <div>
      <ScrollToHash />
      <Routes>
        <Route
          path="/"
          element={
            <>
              <Navigation />
              <main>
                <Home />
              </main>
              <SiteFooter />
            </>
          }
        />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/team" element={<Team />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/license" element={<License />} />
        <Route path="/invite" element={<Invite />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="/app" element={<GetApp />} />
        {/* E-commerce routes - only available when feature flag is enabled */}
        {ecommerceEnabled && (
          <>
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/checkout/success" element={<CheckoutSuccess />} />
          </>
        )}
        <Route path="*" element={<NotFound />} />
      </Routes>

      {ecommerceEnabled && <CartDrawer />}
      <Analytics beforeSend={redactTokens} />
    </div>
  )
}
