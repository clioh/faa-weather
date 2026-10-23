import { useState, useEffect, useMemo } from 'react'
import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { SEO, PageHeader, SiteFooter } from '../components'
import { useCart, formatPrice, cartRequiresShipping } from '../store/cart'
import { stripePromise, stripeAppearance, stripeFonts } from '../config/stripe'
import {
  FALLBACK_TAX_RATE,
  isUsZip,
  shippingCostFor,
  type BillingAddress,
} from '../../shared/catalog'

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
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[28px] font-light tracking-[-0.01em] text-fg">Payment</h2>
        <button
          type="button"
          onClick={onBack}
          className="link min-h-11 inline-flex items-center text-sm"
        >
          {needsShipping ? 'Edit shipping' : 'Edit contact'}
        </button>
      </div>

      {/* Delivery summary */}
      {needsShipping ? (
        <div className="rounded-2xl border border-line bg-tint p-4">
          <p className="text-[13px] text-fg-3 mb-1">Shipping to</p>
          <p className="text-fg">
            {shippingData.firstName} {shippingData.lastName}
          </p>
          <p className="text-fg-2 text-sm">
            {shippingData.address}
            {shippingData.apartment && `, ${shippingData.apartment}`}
            <br />
            {shippingData.city}, {shippingData.state}{' '}
            <span className="font-mono">{shippingData.zip}</span>
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-tint p-4">
          <p className="text-[13px] text-fg-3 mb-1">License key will be emailed to</p>
          <p className="text-fg break-all">{shippingData.email}</p>
          {billingAddress && (
            <p className="text-fg-2 text-sm mt-1">
              Billing ZIP <span className="font-mono">{billingAddress.postal_code}</span>
            </p>
          )}
        </div>
      )}

      {/* Stripe Payment Element */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <svg
            className="w-5 h-5 text-fg-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
            />
          </svg>
          <span className="section-label">Payment details</span>
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
                  address: {
                    postal_code: billingAddress.postal_code,
                    country: billingAddress.country,
                  },
                },
              },
            }),
          }}
        />
      </div>

      {/* Error message */}
      {error && (
        <div role="alert" className="notice notice-error flex items-start gap-3">
          <svg
            className="w-5 h-5 flex-shrink-0 mt-0.5 text-danger"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {error}
        </div>
      )}

      <p className="text-xs text-fg-3 text-center">
        By placing your order you agree to the{' '}
        <Link to="/terms" target="_blank" rel="noopener noreferrer" className="link">
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link to="/terms#refunds" target="_blank" rel="noopener noreferrer" className="link">
          Refund Policy
        </Link>
        .
      </p>

      {/* Submit button */}
      <button
        type="submit"
        disabled={isProcessing || !stripe || !elements}
        className="btn btn-primary w-full"
      >
        {isProcessing ? (
          <>
            <svg
              className="w-5 h-5 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Processing...
          </>
        ) : (
          <>
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            Pay now
          </>
        )}
      </button>

      <p className="text-xs text-fg-3 text-center">
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
    () =>
      !needsShipping && isUsZip(billingZip) ? { postal_code: billingZip, country: 'US' } : null,
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
  const taxCents =
    taxData.taxSource === 'estimating'
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
  }, [
    step,
    clientSecret,
    items,
    needsShipping,
    shippingData,
    billingAddress,
    taxData.calculationId,
    promoData.promotionCodeId,
  ])

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
      <div className="min-h-screen bg-bg flex flex-col">
        <SEO title="Checkout" description="Complete your SkyGlass order" noindex />
        <PageHeader />
        <main className="page-container flex-1 flex items-center justify-center py-16">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full border border-line flex items-center justify-center">
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
            <h1 className="display-3 text-fg mb-3">Your cart is empty</h1>
            <p className="text-fg-2 mb-8">Add some items to your cart to checkout.</p>
            <Link to="/#pricing" className="btn btn-primary">
              View products
            </Link>
          </div>
        </main>
        <SiteFooter />
      </div>
    )
  }

  const stepClass = (s: CheckoutStep) => (step === s ? 'text-fg' : 'text-fg-3')
  const chevron = (
    <svg
      className="w-3.5 h-3.5 text-fg-3"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <SEO title="Checkout" description="Complete your SkyGlass order" noindex />

      <PageHeader
        right={
          <>
            {/* Progress indicator */}
            <div className="hidden md:flex items-center gap-2 text-sm">
              <span
                className={stepClass('information')}
                aria-current={step === 'information' ? 'step' : undefined}
              >
                Information
              </span>
              {chevron}
              {needsShipping && (
                <>
                  <span
                    className={stepClass('shipping')}
                    aria-current={step === 'shipping' ? 'step' : undefined}
                  >
                    Shipping
                  </span>
                  {chevron}
                </>
              )}
              <span
                className={stepClass('payment')}
                aria-current={step === 'payment' ? 'step' : undefined}
              >
                Payment
              </span>
            </div>
            <div className="md:hidden flex items-center gap-2 text-sm text-fg-2 min-h-11">
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
                  strokeWidth={1.5}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              Secure checkout
            </div>
          </>
        }
      />

      <main className="site-container flex-1 pt-4 pb-20 sm:pt-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-16">
          {/* Form Section */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="min-w-0"
          >
            {/* Information Step */}
            {step === 'information' && (
              <form onSubmit={handleInformationSubmit} className="space-y-6">
                <h2 className="text-[28px] font-light tracking-[-0.01em] text-fg">Contact</h2>
                <div>
                  <label htmlFor="checkout-email" className="field-label">
                    Email address
                  </label>
                  <input
                    id="checkout-email"
                    type="email"
                    autoComplete="email"
                    value={shippingData.email}
                    onChange={(e) => updateField('email', e.target.value)}
                    placeholder="pilot@example.com"
                    required
                    className="field-input"
                  />
                </div>

                {!needsShipping && (
                  <>
                    <div>
                      <label htmlFor="billing-zip" className="field-label">
                        Billing ZIP code
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
                        className="field-input font-mono"
                      />
                      <p className="field-hint">Used to calculate sales tax. US only.</p>
                    </div>
                    <p className="text-sm text-fg-2">
                      Nothing ships with a Software License. Your license key is emailed here after
                      checkout.
                    </p>
                  </>
                )}

                {error && (
                  <div role="alert" className="notice notice-error">
                    {error}
                  </div>
                )}

                <button type="submit" className="btn btn-primary w-full">
                  {needsShipping ? 'Continue to shipping' : 'Continue to payment'}
                </button>
              </form>
            )}

            {/* Shipping Step */}
            {step === 'shipping' && needsShipping && (
              <form onSubmit={handleShippingSubmit} className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-[28px] font-light tracking-[-0.01em] text-fg">Shipping</h2>
                  <button
                    type="button"
                    onClick={() => setStep('information')}
                    className="link min-h-11 inline-flex items-center text-sm"
                  >
                    Edit contact
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="ship-first-name" className="field-label">
                      First name
                    </label>
                    <input
                      id="ship-first-name"
                      type="text"
                      autoComplete="given-name"
                      value={shippingData.firstName}
                      onChange={(e) => updateField('firstName', e.target.value)}
                      required
                      className="field-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="ship-last-name" className="field-label">
                      Last name
                    </label>
                    <input
                      id="ship-last-name"
                      type="text"
                      autoComplete="family-name"
                      value={shippingData.lastName}
                      onChange={(e) => updateField('lastName', e.target.value)}
                      required
                      className="field-input"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="ship-address" className="field-label">
                    Address
                  </label>
                  <input
                    id="ship-address"
                    type="text"
                    autoComplete="address-line1"
                    value={shippingData.address}
                    onChange={(e) => updateField('address', e.target.value)}
                    placeholder="123 Flight St"
                    required
                    className="field-input"
                  />
                </div>

                <div>
                  <label htmlFor="ship-apartment" className="field-label">
                    Apartment, suite, etc. (optional)
                  </label>
                  <input
                    id="ship-apartment"
                    type="text"
                    autoComplete="address-line2"
                    value={shippingData.apartment}
                    onChange={(e) => updateField('apartment', e.target.value)}
                    className="field-input"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <div className="col-span-2 sm:col-span-1">
                    <label htmlFor="ship-city" className="field-label">
                      City
                    </label>
                    <input
                      id="ship-city"
                      type="text"
                      autoComplete="address-level2"
                      value={shippingData.city}
                      onChange={(e) => updateField('city', e.target.value)}
                      required
                      className="field-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="ship-state" className="field-label">
                      State
                    </label>
                    <input
                      id="ship-state"
                      type="text"
                      autoComplete="address-level1"
                      value={shippingData.state}
                      onChange={(e) => updateField('state', e.target.value)}
                      placeholder="CA"
                      maxLength={2}
                      required
                      className="field-input font-mono uppercase"
                    />
                  </div>
                  <div>
                    <label htmlFor="ship-zip" className="field-label">
                      ZIP
                    </label>
                    <input
                      id="ship-zip"
                      type="text"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      value={shippingData.zip}
                      onChange={(e) => updateField('zip', e.target.value)}
                      placeholder="94102"
                      required
                      className="field-input font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="ship-phone" className="field-label">
                    Phone (optional)
                  </label>
                  <input
                    id="ship-phone"
                    type="tel"
                    autoComplete="tel"
                    value={shippingData.phone}
                    onChange={(e) => updateField('phone', e.target.value)}
                    placeholder="(555) 123-4567"
                    className="field-input font-mono"
                  />
                </div>

                {error && (
                  <div role="alert" className="notice notice-error">
                    {error}
                  </div>
                )}

                <button type="submit" className="btn btn-primary w-full">
                  Continue to payment
                </button>
              </form>
            )}

            {/* Payment Step */}
            {step === 'payment' && (
              <>
                {isLoadingPayment ? (
                  <div className="flex flex-col items-center justify-center py-12" role="status">
                    <svg
                      className="w-8 h-8 animate-spin text-accent mb-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <p className="text-fg-2">Preparing secure checkout...</p>
                  </div>
                ) : error && !clientSecret ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full border border-danger/40 bg-danger/[0.08] flex items-center justify-center">
                      <svg
                        className="w-8 h-8 text-danger"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                    <p role="alert" className="text-danger mb-6">
                      {error}
                    </p>
                    <button
                      onClick={() => {
                        setError(null)
                        setClientSecret(null)
                        setStep('payment')
                      }}
                      className="btn btn-secondary"
                    >
                      Try again
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
                      fonts: stripeFonts,
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
          <motion.aside
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="panel p-5 sm:p-7 self-start min-w-0"
            aria-label="Order summary"
          >
            <h2 className="text-xl font-normal text-fg mb-2">Order summary</h2>

            <ul>
              {items.map((item) => (
                <li
                  key={item.product.id}
                  className="flex gap-4 py-4 border-b border-line last:border-b-0"
                >
                  <div className="relative w-14 h-14 rounded-xl border border-line bg-tint flex items-center justify-center flex-shrink-0">
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
                    {item.quantity > 1 && (
                      <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full bg-fg text-bg font-mono text-[11px] font-medium flex items-center justify-center">
                        {item.quantity}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-fg">{item.product.name}</h3>
                    <p className="text-sm text-fg-2">{item.product.description}</p>
                  </div>
                  <div className="font-mono text-fg">
                    {formatPrice(item.product.price * item.quantity)}
                  </div>
                </li>
              ))}
            </ul>

            {/* Promo Code Input */}
            <div className="border-t border-line py-4">
              {promoData.code ? (
                // Applied promo code
                <div className="flex items-center justify-between gap-3 rounded-[14px] border border-accent/40 bg-accent-muted pl-4 pr-1 min-h-[52px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <svg
                      className="w-5 h-5 text-accent flex-shrink-0"
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
                    <span className="font-mono text-sm text-fg truncate">{promoData.code}</span>
                    <span className="font-mono text-xs text-fg-2">
                      {promoData.discountType === 'percent'
                        ? `${promoData.percentOff}% off`
                        : `-${formatPrice(promoData.amountOff! / 100)}`}
                    </span>
                  </div>
                  <button
                    onClick={removePromoCode}
                    disabled={promoLocked}
                    className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-full text-fg-2 hover:text-fg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Remove promo code"
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
                        d="M6 18L18 6M6 6l12 12"
                      />
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
                      aria-label="Promo code"
                      aria-invalid={promoData.error ? 'true' : undefined}
                      className="field-input flex-1 min-w-0 font-mono uppercase disabled:opacity-50"
                    />
                    <button
                      onClick={validatePromoCode}
                      disabled={promoLocked || promoData.isValidating || !promoInput.trim()}
                      className="btn btn-secondary btn-sm h-[52px] rounded-[26px] flex-shrink-0"
                    >
                      {promoData.isValidating ? (
                        <svg
                          className="w-4 h-4 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                          aria-label="Checking code"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                      ) : (
                        'Apply'
                      )}
                    </button>
                  </div>
                  {promoData.error && (
                    <p role="alert" className="field-error">
                      {promoData.error}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Totals: hairline rows */}
            <dl className="text-sm">
              <div className="flex justify-between gap-4 py-3 border-t border-line">
                <dt className="text-fg-2">Subtotal</dt>
                <dd className="text-fg font-mono">{formatPrice(subtotal)}</dd>
              </div>
              {discountCents > 0 && (
                <div className="flex justify-between gap-4 py-3 border-t border-line">
                  <dt className="text-fg-2">Discount</dt>
                  <dd className="text-fg font-mono">-{formatPrice(discountCents / 100)}</dd>
                </div>
              )}
              {needsShipping && (
                <div className="flex justify-between gap-4 py-3 border-t border-line">
                  <dt className="text-fg-2">Shipping</dt>
                  <dd className="text-fg font-mono">
                    {shipping === 0 ? 'Free' : formatPrice(shipping)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4 py-3 border-t border-line">
                <dt className="text-fg-2 flex items-center gap-2">
                  Tax
                  {taxData.isCalculating && (
                    <svg
                      className="w-3 h-3 animate-spin text-accent"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-label="Calculating tax"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  )}
                  {taxData.taxSource === 'estimating' && !taxData.isCalculating && (
                    <span className="text-xs text-fg-3">(est.)</span>
                  )}
                </dt>
                <dd className="text-fg font-mono">{formatPrice(tax)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 pt-4 pb-1 border-t border-line-strong">
                <dt className="text-base font-medium text-fg">Total</dt>
                <dd className="font-mono text-2xl font-light text-fg">{formatPrice(orderTotal)}</dd>
              </div>
            </dl>

            {/* Trust badges */}
            <div className="mt-6 pt-4 border-t border-line">
              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 text-sm">
                <div className="flex items-center gap-2 text-fg-2 min-h-11">
                  <svg
                    className="w-5 h-5 text-fg-3 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  <span>Secure checkout</span>
                </div>
                {/* The hardware warranty only applies to kits */}
                {needsShipping && (
                  <Link
                    to="/terms#warranty"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-fg-2 hover:text-fg transition-colors min-h-11"
                  >
                    <svg
                      className="w-5 h-5 text-fg-3 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                      />
                    </svg>
                    <span>1-year warranty</span>
                  </Link>
                )}
                <div className="flex items-center gap-2 text-fg-2 min-h-11">
                  <svg
                    className="w-5 h-5 text-fg-3 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                    />
                  </svg>
                  <span>Powered by Stripe</span>
                </div>
                <Link
                  to="/terms#refunds"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-fg-2 hover:text-fg transition-colors min-h-11"
                >
                  <svg
                    className="w-5 h-5 text-fg-3 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z"
                    />
                  </svg>
                  <span>{needsShipping ? '30-day returns' : '30-day hassle-free refund'}</span>
                </Link>
              </div>
            </div>
          </motion.aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
