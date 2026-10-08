import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { Navigation, WaitlistModal, CartDrawer } from './components'
import { Home, Privacy, Terms, Team, Checkout, CheckoutSuccess, NotFound, Admin } from './pages'
import { canPurchase } from './config/features'

export default function App() {
  const [isWaitlistOpen, setIsWaitlistOpen] = useState(false)

  const openWaitlist = () => setIsWaitlistOpen(true)
  const closeWaitlist = () => setIsWaitlistOpen(false)

  const ecommerceEnabled = canPurchase()

  return (
    <div className="relative noise">
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
      <Analytics />
    </div>
  )
}
