import { loadStripe, type Appearance } from '@stripe/stripe-js'

// Initialize Stripe with your publishable key. Stripe.js throws when given an
// empty key, so when VITE_STRIPE_PUBLISHABLE_KEY is unset (local dev without
// e-commerce) resolve to null instead; <Elements stripe={null}> renders a
// loading state rather than crashing.
const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined

const stripeConfigured = Boolean(stripePublishableKey)

export const stripePromise = stripePublishableKey
  ? loadStripe(stripePublishableKey)
  : Promise.resolve(null)

if (!stripeConfigured && import.meta.env.DEV) {
  console.warn('[SkyGlass] VITE_STRIPE_PUBLISHABLE_KEY is not set; checkout is disabled.')
}

// Payment Element styled in the Glass Cockpit language (docs/design/DESIGN_SYSTEM.md,
// tokens in src/index.css). The Element renders in Stripe's iframe, so the values are
// repeated here rather than read from CSS:
// - bg #000000 (black ground; inputs are transparent on it)
// - accent #7ad7ff (focus, selected tab, success; success is never the VFR colour)
// - fg #ffffff, fg-2 rgba(255,255,255,0.68), placeholder rgba(255,255,255,0.4)
// - line rgba(255,255,255,0.14) (hairlines), line-strong rgba(255,255,255,0.24) (inputs)
// - danger #ff6b7a
// Inputs match .field-input: 52px tall, radius 14, accent border on focus, no focus shadow.

const INTER = '"Inter", -apple-system, sans-serif'

export const stripeAppearance: Appearance = {
  theme: 'night',
  labels: 'above',
  variables: {
    // Colors
    colorPrimary: '#7ad7ff', // accent
    colorBackground: '#000000', // bg
    colorText: '#ffffff', // fg
    colorTextSecondary: 'rgba(255, 255, 255, 0.68)', // fg-2
    colorTextPlaceholder: 'rgba(255, 255, 255, 0.4)', // fg-disabled
    colorDanger: '#ff6b7a', // danger
    colorSuccess: '#7ad7ff', // success uses the accent

    // Text on the accent fill
    colorPrimaryText: '#00141f', // on-accent

    // Borders
    borderRadius: '14px',

    // Fonts: Inter throughout (the card number cannot be set to mono on its own)
    fontFamily: INTER,
    fontSizeBase: '16px',
    fontWeightNormal: '400',
    fontWeightMedium: '500',
    fontWeightBold: '600',

    // Spacing
    spacingUnit: '4px',
    spacingGridRow: '16px',
    spacingGridColumn: '16px',
  },
  rules: {
    '.Input': {
      backgroundColor: 'transparent',
      border: '1px solid rgba(255, 255, 255, 0.24)', // line-strong
      boxShadow: 'none',
      // 16px text + 2 x 15px padding + 2px border = 52px, like .field-input
      padding: '15px 16px',
      transition: 'border-color 150ms ease',
    },
    '.Input:hover': {
      borderColor: 'rgba(255, 255, 255, 0.5)',
    },
    '.Input:focus': {
      borderColor: '#7ad7ff',
      boxShadow: 'none',
      outline: 'none',
    },
    '.Input--invalid': {
      borderColor: '#ff6b7a',
      boxShadow: 'none',
    },
    '.Input::placeholder': {
      color: 'rgba(255, 255, 255, 0.4)',
    },
    '.Label': {
      color: 'rgba(255, 255, 255, 0.68)', // fg-2, like .field-label
      fontSize: '13px',
      fontWeight: '400',
      textTransform: 'none',
      letterSpacing: 'normal',
      fontFamily: INTER,
      marginBottom: '8px',
    },
    '.Error': {
      color: '#ff6b7a',
      fontSize: '12px',
      marginTop: '6px',
    },
    '.Tab': {
      backgroundColor: 'transparent',
      border: '1px solid rgba(255, 255, 255, 0.14)', // line
      borderRadius: '14px',
      boxShadow: 'none',
      color: 'rgba(255, 255, 255, 0.68)',
    },
    '.Tab:hover': {
      borderColor: 'rgba(255, 255, 255, 0.24)',
      color: '#ffffff',
    },
    '.Tab:focus': {
      borderColor: '#7ad7ff',
      boxShadow: 'none',
    },
    '.Tab--selected': {
      backgroundColor: 'rgba(122, 215, 255, 0.12)', // accent-muted
      borderColor: '#7ad7ff',
      color: '#ffffff',
    },
    '.Tab--selected:focus': {
      boxShadow: 'none',
    },
    '.TabIcon': {
      fill: 'currentColor',
    },
    '.TabIcon--selected': {
      fill: '#7ad7ff',
    },
    '.TabLabel': {
      fontWeight: '500',
    },
    '.Block': {
      backgroundColor: 'transparent',
      borderRadius: '14px',
      border: '1px solid rgba(255, 255, 255, 0.14)', // line
      boxShadow: 'none',
    },
  },
}

// Inter for the Payment Element iframe (it cannot see the page's fonts)
export const stripeFonts = [
  { cssSrc: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap' },
]
