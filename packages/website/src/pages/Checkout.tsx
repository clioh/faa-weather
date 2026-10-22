import { useState, useEffect, useMemo } from 'react'
import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { SEO } from '../components'
import { useCart, formatPrice, cartRequiresShipping } from '../store/cart'
import { stripePromise, stripeAppearance } from '../config/stripe'
import { FALLBACK_TAX_RATE, isUsZip, shippingCostFor, type BillingAddress } from '../../shared/catalog'

type CheckoutStep = 'information' | 'shipping' | 'payment'

interface ShippingData {
  email: string
  firstName: string
  lastName: string
  address: string
  apartment: string
  city: string
  state: string
  zip: string
  country: string
  phone: string
}

const initialShippingData: ShippingData = {
  email: '',
  firstName: '',
  lastName: '',
  address: '',
  apartment: '',
  city: '',
  state: '',
  zip: '',
  country: 'US',
  phone: '',
}

// Payment form component that uses Stripe hooks
function PaymentForm({
  shippingData,
  needsShipping,
  billingAddress,
  onBack,
  onSuccess,
  onProcessingChange,
}: {
  shippingData: ShippingData
  needsShipping: boolean
  /** Tax address for a license-only cart; null when the cart ships. */
  billingAddress: BillingAddress | null
  onBack: () => void
  onSuccess: () => void
  /** Lets the page lock the promo box while a payment is being confirmed. */
  onProcessingChange: (processing: boolean) => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [isProcessing, setIsProcessingState] = useState(false)
  const setIsProcessing = (processing: boolean) => {
    setIsProcessingState(processing)
    onProcessingChange(processing)
  }
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!stripe || !elements) {
      return
    }

    setIsProcessing(true)
    setError(null)

    const { error: submitError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/checkout/success`,
        receipt_email: shippingData.email,
        ...(needsShipping && {
          shipping: {
            name: `${shippingData.firstName} ${shippingData.lastName}`,
            address: {
              line1: shippingData.address,
              line2: shippingData.apartment || undefined,
              city: shippingData.city,
              state: shippingData.state,
              postal_code: shippingData.zip,
              country: shippingData.country,
            },
          },
        }),
      },
    })

    if (submitError) {
      if (submitError.type === 'card_error' || submitError.type === 'validation_error') {
        setError(submitError.message || 'Payment failed')
      } else {
        setError('An unexpected error occurred')
      }
      setIsProcessing(false)
    } else {
      // Payment succeeded, redirect handled by return_url
      onSuccess()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold text-light">Payment</h2>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-amber hover:underline"
        >
          {needsShipping ? 'Edit shipping' : 'Edit contact'}
        </button>
      </div>

      {/* Delivery summary */}
      {needsShipping ? (
        <div className="p-4 bg-panel border border-border rounded-lg">
          <p className="text-sm text-muted mb-1">Shipping to</p>
          <p className="text-light">
            {shippingData.firstName} {shippingData.lastName}
          </p>
          <p className="text-muted text-sm">
            {shippingData.address}
            {shippingData.apartment && `, ${shippingData.apartment}`}
            <br />
            {shippingData.city}, {shippingData.state} {shippingData.zip}
          </p>
        </div>
      ) : (
        <div className="p-4 bg-panel border border-border rounded-lg">
          <p className="text-sm text-muted mb-1">License key will be emailed to</p>
          <p className="text-light font-mono break-all">{shippingData.email}</p>
          {billingAddress && (
            <p className="text-muted text-sm mt-1">Billing ZIP {billingAddress.postal_code}</p>
          )}
        </div>
      )}

      {/* Stripe Payment Element */}
      <div className="instrument-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-amber" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          <span className="font-display font-semibold text-light">Payment Details</span>
        </div>

        <PaymentElement
          options={{
            layout: 'tabs',
            paymentMethodOrder: ['card', 'apple_pay', 'google_pay'],
            // License-only carts: prefill the card's billing ZIP with the one used for tax.
            // A prefill rather than a confirmPayment override, so a buyer whose card is
            // billed elsewhere can still correct it for address verification.
            ...(billingAddress && {
              defaultValues: {
                billingDetails: {
                  email: shippingData.email,
                  address: { postal_code: billingAddress.postal_code, country: billingAddress.country },
                },
              },
            }),
          }}
        />
      </div>

      {/* Error message */}
      {error && (
        <div className="px-4 py-3 bg-ifr/10 border border-ifr/30 rounded-lg text-ifr text-sm flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      <p className="text-xs text-muted text-center">
        By placing your order you agree to the{' '}
        <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-amber hover:underline">
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link to="/terms#refunds" target="_blank" rel="noopener noreferrer" className="text-amber hover:underline">
          Refund Policy
        </Link>
        .
      </p>

      {/* Submit button */}
      <button
        type="submit"
        disabled={isProcessing || !stripe || !elements}
        className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
      >
        {isProcessing ? (
          <>
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Processing...
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Pay Now
          </>
        )}
      </button>

      <p className="text-xs text-muted text-center">
        Your payment is secured by Stripe. We never store your card details.
      </p>
    </form>
  )
}

interface TaxData {
  calculationId: string | null
  taxAmount: number // in cents
  isCalculating: boolean
  taxSource: 'stripe_tax' | 'fallback' | 'estimating'
}

interface PromoData {
  promotionCodeId: string | null
  code: string
  discountType: 'percent' | 'amount' | null
  percentOff: number | null
  amountOff: number | null
  discountAmount: number // in cents
  isValidating: boolean
  error: string | null
}

export function Checkout() {
  const { items, total, clearCart } = useCart()
  const [step, setStep] = useState<CheckoutStep>('information')
  const [shippingData, setShippingData] = useState<ShippingData>(initialShippingData)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [isLoadingPayment, setIsLoadingPayment] = useState(false)
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Tax calculation state
  const [taxData, setTaxData] = useState<TaxData>({
    calculationId: null,
    taxAmount: 0,
    isCalculating: false,
    taxSource: 'estimating',
  })

  // Promo code state
  const [promoInput, setPromoInput] = useState('')
  const [promoData, setPromoData] = useState<PromoData>({
    promotionCodeId: null,
    code: '',
    discountType: null,
    percentOff: null,
    amountOff: null,
    discountAmount: 0,
    isValidating: false,
    error: null,
  })

  // A cart with only the Software License has nothing to ship: no shipping address or
  // charge. Sales tax is then based on the buyer's billing ZIP instead.
  const needsShipping = cartRequiresShipping(items)
  const billingZip = shippingData.zip.trim()
  // Memoized: it is a dependency of the PaymentIntent effect below
  const billingAddress = useMemo<BillingAddress | null>(
    () => (!needsShipping && isUsZip(billingZip) ? { postal_code: billingZip, country: 'US' } : null),
    [needsShipping, billingZip]
  )

  const subtotal = total()
  const subtotalCents = Math.round(subtotal * 100)
  const discountCents = promoData.discountAmount
  const discountedSubtotalCents = subtotalCents - discountCents
  // Free shipping based on original subtotal
  const shippingCents = shippingCostFor(
    items.map((item) => ({ productId: item.product.id })),
    subtotalCents
  )
  const shipping = shippingCents / 100

  // Use calculated tax or estimate (on discounted amount)
  const taxCents = taxData.taxSource === 'estimating'
    ? Math.round(discountedSubtotalCents * FALLBACK_TAX_RATE) // Estimate until calculated
    : Math.round(taxData.taxAmount * (discountedSubtotalCents / subtotalCents || 1)) // Proportional if discount applied
  const tax = taxCents / 100

  const orderTotalCents = discountedSubtotalCents + shippingCents + taxCents
  const orderTotal = orderTotalCents / 100

  const updateField = (field: keyof ShippingData, value: string) => {
    setShippingData((prev) => ({ ...prev, [field]: value }))
    setError(null)
    // Any change before payment invalidates a PaymentIntent created for the old details
    setClientSecret(null)
    // Reset tax calculation when address changes
    if (['city', 'state', 'zip', 'country'].includes(field)) {
      setTaxData((prev) => ({ ...prev, calculationId: null, taxSource: 'estimating' }))
    }
  }

  // Calculate tax from the shipping address, or from the billing ZIP for a license-only cart.
  // Resolves false (with an error shown) when the address must be corrected first.
  const fallbackTax = () =>
    setTaxData({
      calculationId: null,
      taxAmount: Math.round(subtotalCents * FALLBACK_TAX_RATE),
      isCalculating: false,
      taxSource: 'fallback',
    })

  const calculateTax = async (): Promise<boolean> => {
    if (needsShipping && (!shippingData.city || !shippingData.state || !shippingData.zip)) {
      return false
    }
    if (!needsShipping && !billingAddress) {
      return false
    }

    setTaxData((prev) => ({ ...prev, isCalculating: true }))

    try {
      const response = await fetch('/api/calculate-tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
          })),
          ...(needsShipping
            ? {
                shipping: {
                  line1: shippingData.address,
                  line2: shippingData.apartment || undefined,
                  city: shippingData.city,
                  state: shippingData.state,
                  postal_code: shippingData.zip,
                  country: shippingData.country,
                },
              }
            : { billingAddress }),
        }),
      })

      const data = await response.json()

      if (data.error) {
        if (data.fallback || response.status >= 500) {
          // Stripe Tax itself is unavailable: use the fallback rate
          console.warn('Tax calculation failed, using fallback:', data.error)
          fallbackTax()
          return true
        }
        // The address was rejected: let the buyer fix it
        setTaxData((prev) => ({ ...prev, isCalculating: false }))
        setError(data.error)
        return false
      }

      setTaxData({
        calculationId: data.calculationId,
        taxAmount: data.taxAmount,
        isCalculating: false,
        taxSource: 'stripe_tax',
      })
      return true
    } catch {
      // Network error: use fallback
      fallbackTax()
      return true
    }
  }

  // Validate promo code
  const validatePromoCode = async () => {
    if (!promoInput.trim()) {
      setPromoData((prev) => ({ ...prev, error: 'Enter a promo code' }))
      return
    }

    setPromoData((prev) => ({ ...prev, isValidating: true, error: null }))

    try {
      const response = await fetch('/api/validate-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: promoInput.trim(),
          subtotal: subtotalCents,
        }),
      })

      const data = await response.json()

      if (!data.valid) {
        setPromoData((prev) => ({
          ...prev,
          isValidating: false,
          error: data.error || 'Invalid promo code',
        }))
      } else {
        setPromoData({
          promotionCodeId: data.promotionCodeId,
          code: data.code,
          discountType: data.discountType,
          percentOff: data.percentOff || null,
          amountOff: data.amountOff || null,
          discountAmount: data.discountAmount,
          isValidating: false,
          error: null,
        })
        setPromoInput('') // Clear input on success
        // The PaymentIntent was priced without this code: recreate it so the charge matches the total shown
        setClientSecret(null)
      }
    } catch {
      setPromoData((prev) => ({
        ...prev,
        isValidating: false,
        error: 'Failed to validate code',
      }))
    }
  }

  // Remove promo code
  const removePromoCode = () => {
    setPromoData({
      promotionCodeId: null,
      code: '',
      discountType: null,
      percentOff: null,
      amountOff: null,
      discountAmount: 0,
      isValidating: false,
      error: null,
    })
    setPromoInput('')
    // Recreate the PaymentIntent at the undiscounted price
    setClientSecret(null)
  }

  // Changing the code mid-request or mid-confirmation could charge a different amount than shown
  const promoLocked = isLoadingPayment || isPaymentProcessing

  // Create PaymentIntent when entering payment step
  useEffect(() => {
    if (step === 'payment' && !clientSecret && items.length > 0) {
      // Ignore a response whose inputs changed while it was in flight (e.g. a promo code
      // applied mid-request); the re-run creates the intent for the current inputs instead.
      let cancelled = false
      setIsLoadingPayment(true)
      setError(null)

      fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((item) => ({
            productId: item.product.id,
            name: item.product.name,
            price: item.product.price,
            quantity: item.quantity,
          })),
          email: shippingData.email,
          // A shipping address when anything ships, else the billing ZIP for sales tax
          ...(needsShipping
            ? {
                shipping: {
                  name: `${shippingData.firstName} ${shippingData.lastName}`,
                  address: {
                    line1: shippingData.address,
                    line2: shippingData.apartment || undefined,
                    city: shippingData.city,
                    state: shippingData.state,
                    postal_code: shippingData.zip,
                    country: shippingData.country,
                  },
                },
              }
            : { billingAddress }),
          // Pass promotion code ID if available
          promotionCodeId: promoData.promotionCodeId,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return
          if (data.promoError) {
            // The server re-checks the code at payment time. Drop it (which
            // re-runs this effect without a code) and show why on the promo field.
            setPromoData({
              promotionCodeId: null,
              code: '',
              discountType: null,
              percentOff: null,
              amountOff: null,
              discountAmount: 0,
              isValidating: false,
              error: data.error || 'This promo code can no longer be applied',
            })
          } else if (data.error) {
            setError(data.error)
          } else {
            setClientSecret(data.clientSecret)
            // Update tax and discount from server response
            if (data.breakdown) {
              setTaxData((prev) => ({
                ...prev,
                taxAmount: data.breakdown.tax,
                taxSource: data.taxSource || prev.taxSource,
              }))
              // Update discount if server returned different value
              if (data.breakdown.discount !== undefined) {
                setPromoData((prev) => ({
                  ...prev,
                  discountAmount: data.breakdown.discount,
                }))
              }
            }
          }
        })
        .catch(() => {
          if (!cancelled) setError('Failed to initialize payment. Please try again.')
        })
        .finally(() => {
          if (!cancelled) setIsLoadingPayment(false)
        })
      return () => {
        cancelled = true
      }
    }
  }, [step, clientSecret, items, needsShipping, shippingData, billingAddress, taxData.calculationId, promoData.promotionCodeId])

  const handleInformationSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!shippingData.email) {
      setError('Email is required')
      return
    }
    if (!needsShipping) {
      if (!billingAddress) {
        setError('Enter a 5-digit US ZIP code (or ZIP+4)')
        return
      }
      if (await calculateTax()) setStep('payment')
      return
    }
    setStep('shipping')
  }

  const handleShippingSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (
      !shippingData.firstName ||
      !shippingData.lastName ||
      !shippingData.address ||
      !shippingData.city ||
      !shippingData.state ||
      !shippingData.zip
    ) {
      setError('Please fill in all required fields')
      return
    }

    // Calculate tax before moving to payment
    if (await calculateTax()) setStep('payment')
  }

  const handlePaymentSuccess = () => {
    clearCart()
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center p-6">
        <SEO title="Checkout" description="Complete your SkyGlass order" />
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-panel border border-border flex items-center justify-center">
            <svg className="w-10 h-10 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
          </div>
          <h1 className="font-display text-2xl font-bold text-light mb-2">Your cart is empty</h1>
          <p className="text-muted mb-6">Add some items to your cart to checkout.</p>
          <Link to="/#pricing" className="btn-primary">
            View Products
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-void">
      <SEO title="Checkout" description="Complete your SkyGlass order" />

      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
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

          {/* Progress indicator */}
          <div className="hidden md:flex items-center gap-2 text-sm">
            <span className={step === 'information' ? 'text-amber' : 'text-muted'}>Information</span>
            <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {needsShipping && (
              <>
                <span className={step === 'shipping' ? 'text-amber' : 'text-muted'}>Shipping</span>
                <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </>
            )}
            <span className={step === 'payment' ? 'text-amber' : 'text-muted'}>Payment</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid lg:grid-cols-2 gap-12">
          {/* Form Section */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
          >
            {/* Information Step */}
            {step === 'information' && (
              <form onSubmit={handleInformationSubmit} className="space-y-6">
                <h2 className="font-display text-2xl font-bold text-light">Contact</h2>
                <div>
                  <label className="block font-mono text-xs text-amber uppercase tracking-wider mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={shippingData.email}
                    onChange={(e) => updateField('email', e.target.value)}
                    placeholder="pilot@example.com"
                    required
                    className="w-full px-4 py-3 bg-panel border border-border rounded-lg text-light placeholder:text-muted focus:outline-none focus:border-amber/50 font-mono"
                  />
                </div>

                {!needsShipping && (
                  <>
                    <div>
                      <label
                        htmlFor="billing-zip"
                        className="block font-mono text-xs text-amber uppercase tracking-wider mb-2"
                      >
                        Billing ZIP Code
                      </label>
                      <input
                        id="billing-zip"
                        type="text"
                        inputMode="numeric"
                        autoComplete="postal-code"
                        value={shippingData.zip}
                        onChange={(e) => updateField('zip', e.target.value)}
                        placeholder="94102"
                        maxLength={10}
                        pattern="\d{5}(-\d{4})?"
                        title="5-digit ZIP code or ZIP+4"
                        required
                        className="w-full px-4 py-3 bg-panel border border-border rounded-lg text-light placeholder:text-muted focus:outline-none focus:border-amber/50 font-mono"
                      />
                      <p className="text-xs text-muted mt-2">Used to calculate sales tax. US only.</p>
                    </div>
                    <p className="text-sm text-muted">
                      Nothing ships with a Software License. Your license key is emailed here
                      after checkout.
                    </p>
                  </>
                )}

                {error && (
                  <div className="px-4 py-3 bg-ifr/10 border border-ifr/30 rounded-lg text-ifr text-sm">
                    {error}
                  </div>
                )}

                <button type="submit" className="w-full btn-primary">
                  {needsShipping ? 'Continue to Shipping' : 'Continue to Payment'}
                </button>
              </form>
            )}

            {/* Shipping Step */}
            {step === 'shipping' && needsShipping && (
              <form onSubmit={handleShippingSubmit} className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-2xl font-bold text-light">Shipping</h2>
                  <button
                    type="button"
                    onClick={() => setStep('information')}
                    className="text-sm text-amber hover:underline"
                  >
                    Edit contact
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-mono text-xs text-amber uppercase tracking-wider mb-2">
                      First Name
                    </label>
                    <input
                      type="text"
                      value={shippingData.firstName}
                      onChange={(e) => updateField('firstName', e.target.value)}
                      required
                      className="w-full px-4 py-3 bg-panel border border-border rounded-lg text-light placeholder:text-muted focus:outline-none focus:border-amber/50"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-xs text-amber uppercase tracking-wider mb-2">
                      Last Name
                    </label>
                    <input
                      type="text"
                      value={shippingData.lastName}
                      onChange={(e) => updateField('lastName', e.target.value)}
                      required
                      className="w-full px-4 py-3 bg-panel border border-border rounded-lg text-light placeholder:text-muted focus:outline-none focus:border-amber/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-xs text-amber uppercase tracking-wider mb-2">
                    Address
                  </label>
                  <input
                    type="text"
                    value={shippingData.address}
                    onChange={(e) => updateField('address', e.target.value)}
                    placeholder="123 Flight St"
                    required
                    className="w-full px-4 py-3 bg-panel border border-border rounded-lg text-light placeholder:text-muted focus:outline-none focus:border-amber/50"
                  />
                </div>

                <div>
                  <label className="block font-mono text-xs text-amber uppercase tracking-wider mb-2">
                    Apartment, suite, etc. (optional)
                  </label>
                  <input
                    type="text"
                    value={shippingData.apartment}
                    onChange={(e) => updateField('apartment', e.target.value)}
                    className="w-full px-4 py-3 bg-panel border border-border rounded-lg text-light placeholder:text-muted focus:outline-none focus:border-amber/50"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block font-mono text-xs text-amber uppercase tracking-wider mb-2">
                      City
                    </label>
                    <input
                      type="text"
                      value={shippingData.city}
                      onChange={(e) => updateField('city', e.target.value)}
                      required
                      className="w-full px-4 py-3 bg-panel border border-border rounded-lg text-light placeholder:text-muted focus:outline-none focus:border-amber/50"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-xs text-amber uppercase tracking-wider mb-2">
                      State
                    </label>
                    <input
                      type="text"
                      value={shippingData.state}
                      onChange={(e) => updateField('state', e.target.value)}
                      placeholder="CA"
                      maxLength={2}
                      required
                      className="w-full px-4 py-3 bg-panel border border-border rounded-lg text-light placeholder:text-muted focus:outline-none focus:border-amber/50 uppercase"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-xs text-amber uppercase tracking-wider mb-2">
                      ZIP
                    </label>
                    <input
                      type="text"
                      value={shippingData.zip}
                      onChange={(e) => updateField('zip', e.target.value)}
                      placeholder="94102"
                      required
                      className="w-full px-4 py-3 bg-panel border border-border rounded-lg text-light placeholder:text-muted focus:outline-none focus:border-amber/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-xs text-amber uppercase tracking-wider mb-2">
                    Phone (optional)
                  </label>
                  <input
                    type="tel"
                    value={shippingData.phone}
                    onChange={(e) => updateField('phone', e.target.value)}
                    placeholder="(555) 123-4567"
                    className="w-full px-4 py-3 bg-panel border border-border rounded-lg text-light placeholder:text-muted focus:outline-none focus:border-amber/50"
                  />
                </div>

                {error && (
                  <div className="px-4 py-3 bg-ifr/10 border border-ifr/30 rounded-lg text-ifr text-sm">
                    {error}
                  </div>
                )}

                <button type="submit" className="w-full btn-primary">
                  Continue to Payment
                </button>
              </form>
            )}

            {/* Payment Step */}
            {step === 'payment' && (
              <>
                {isLoadingPayment ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <svg className="w-8 h-8 animate-spin text-amber mb-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="text-muted">Preparing secure checkout...</p>
                  </div>
                ) : error && !clientSecret ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-ifr/10 border border-ifr/30 flex items-center justify-center">
                      <svg className="w-8 h-8 text-ifr" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <p className="text-ifr mb-4">{error}</p>
                    <button
                      onClick={() => {
                        setError(null)
                        setClientSecret(null)
                        setStep('payment')
                      }}
                      className="btn-secondary"
                    >
                      Try Again
                    </button>
                  </div>
                ) : clientSecret ? (
                  <Elements
                    // A new intent (e.g. after a promo change) needs a fresh Payment Element
                    key={clientSecret}
                    stripe={stripePromise}
                    options={{
                      clientSecret,
                      appearance: stripeAppearance,
                    }}
                  >
                    <PaymentForm
                      shippingData={shippingData}
                      needsShipping={needsShipping}
                      billingAddress={billingAddress}
                      onBack={() => setStep(needsShipping ? 'shipping' : 'information')}
                      onSuccess={handlePaymentSuccess}
                      onProcessingChange={setIsPaymentProcessing}
                    />
                  </Elements>
                ) : null}
              </>
            )}
          </motion.div>

          {/* Order Summary */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="lg:pl-12 lg:border-l lg:border-border"
          >
            <h2 className="font-display text-xl font-bold text-light mb-6">Order Summary</h2>

            <div className="space-y-4 mb-6">
              {items.map((item) => (
                <div key={item.product.id} className="flex gap-4">
                  <div className="relative w-16 h-16 bg-instrument border border-border rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-8 h-8 text-amber/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <rect x="3" y="2" width="18" height="20" rx="2" strokeWidth={1.5} />
                      <circle cx="18" cy="5" r="1.5" fill="currentColor" />
                    </svg>
                    {item.quantity > 1 && (
                      <span className="absolute -top-2 -right-2 w-5 h-5 bg-amber text-void text-xs font-bold rounded-full flex items-center justify-center">
                        {item.quantity}
                      </span>
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-display font-semibold text-light">{item.product.name}</h3>
                    <p className="text-sm text-muted">{item.product.description}</p>
                  </div>
                  <div className="font-mono text-light">
                    {formatPrice(item.product.price * item.quantity)}
                  </div>
                </div>
              ))}
            </div>

            {/* Promo Code Input */}
            <div className="border-t border-border pt-4">
              {promoData.code ? (
                // Applied promo code
                <div className="flex items-center justify-between bg-vfr/10 border border-vfr/30 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-vfr" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="font-mono text-sm text-vfr">{promoData.code}</span>
                    <span className="text-xs text-vfr/70">
                      {promoData.discountType === 'percent'
                        ? `${promoData.percentOff}% off`
                        : `-${formatPrice(promoData.amountOff! / 100)}`}
                    </span>
                  </div>
                  <button
                    onClick={removePromoCode}
                    disabled={promoLocked}
                    className="text-muted hover:text-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Remove promo code"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                // Promo code input
                <div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={promoInput}
                      onChange={(e) => {
                        setPromoInput(e.target.value.toUpperCase())
                        setPromoData((prev) => ({ ...prev, error: null }))
                      }}
                      disabled={promoLocked}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          if (!promoLocked && !promoData.isValidating) validatePromoCode()
                        }
                      }}
                      placeholder="Promo code"
                      className="flex-1 px-3 py-2 bg-panel border border-border rounded-lg text-light placeholder:text-muted text-sm font-mono focus:outline-none focus:border-amber/50 uppercase disabled:opacity-50"
                    />
                    <button
                      onClick={validatePromoCode}
                      disabled={promoLocked || promoData.isValidating || !promoInput.trim()}
                      className="px-4 py-2 bg-instrument border border-border rounded-lg text-sm text-light hover:bg-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {promoData.isValidating ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        'Apply'
                      )}
                    </button>
                  </div>
                  {promoData.error && (
                    <p className="text-ifr text-xs mt-2">{promoData.error}</p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted">Subtotal</span>
                <span className="text-light font-mono">{formatPrice(subtotal)}</span>
              </div>
              {discountCents > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-vfr">Discount</span>
                  <span className="text-vfr font-mono">-{formatPrice(discountCents / 100)}</span>
                </div>
              )}
              {needsShipping && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Shipping</span>
                  <span className="text-light font-mono">
                    {shipping === 0 ? 'Free' : formatPrice(shipping)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted flex items-center gap-2">
                  Tax
                  {taxData.isCalculating && (
                    <svg className="w-3 h-3 animate-spin text-amber" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {taxData.taxSource === 'estimating' && !taxData.isCalculating && (
                    <span className="text-xs text-muted/60">(est.)</span>
                  )}
                </span>
                <span className="text-light font-mono">{formatPrice(tax)}</span>
              </div>
              <div className="flex justify-between pt-3 border-t border-border">
                <span className="font-display font-semibold text-light">Total</span>
                <span className="font-display text-xl font-bold text-amber">{formatPrice(orderTotal)}</span>
              </div>
            </div>

            {/* Trust badges */}
            <div className="mt-8 pt-6 border-t border-border">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2 text-muted">
                  <svg className="w-5 h-5 text-vfr" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>Secure checkout</span>
                </div>
                {/* The hardware warranty only applies to kits */}
                {needsShipping && (
                  <Link to="/terms#warranty" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-muted hover:text-light transition-colors">
                    <svg className="w-5 h-5 text-vfr" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <span>1-year warranty</span>
                  </Link>
                )}
                <div className="flex items-center gap-2 text-muted">
                  <svg className="w-5 h-5 text-vfr" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  <span>Powered by Stripe</span>
                </div>
                <Link to="/terms#refunds" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-muted hover:text-light transition-colors">
                  <svg className="w-5 h-5 text-vfr" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" />
                  </svg>
                  <span>{needsShipping ? '30-day returns' : '30-day hassle-free refund'}</span>
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
