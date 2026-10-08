import { loadStripe, type Appearance } from '@stripe/stripe-js'

// Initialize Stripe with your publishable key. Stripe.js throws when given an
// empty key, so when VITE_STRIPE_PUBLISHABLE_KEY is unset (local dev without
// e-commerce) resolve to null instead; <Elements stripe={null}> renders a
// loading state rather than crashing.
const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined

export const stripeConfigured = Boolean(stripePublishableKey)

export const stripePromise = stripePublishableKey
  ? loadStripe(stripePublishableKey)
  : Promise.resolve(null)

if (!stripeConfigured && import.meta.env.DEV) {
  console.warn('[SkyGlass] VITE_STRIPE_PUBLISHABLE_KEY is not set; checkout is disabled.')
}

// Custom appearance to match SkyGlass branding
// Colors from tailwind.config.js:
// - void: #0a0a0f (dark background)
// - panel: #12121a (card background)
// - instrument: #1a1a24 (input background)
// - border: #2a2a3a
// - amber: #f5a623 (accent)
// - light: #e8e8ec (text)
// - muted: #8a8a9a (secondary text)

export const stripeAppearance: Appearance = {
  theme: 'night',
  labels: 'floating',
  variables: {
    // Colors
    colorPrimary: '#f5a623', // amber
    colorBackground: '#1a1a24', // instrument
    colorText: '#e8e8ec', // light
    colorTextSecondary: '#8a8a9a', // muted
    colorTextPlaceholder: '#5a5a6a',
    colorDanger: '#ef4444', // red for errors
    colorSuccess: '#4ade80', // green (vfr)

    // Borders
    borderRadius: '8px',

    // Focus
    colorPrimaryText: '#0a0a0f', // void (for contrast on amber)

    // Fonts - match the site's mono font for card numbers
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
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
      backgroundColor: '#0a0a0f', // void
      border: '1px solid #2a2a3a',
      boxShadow: 'none',
      padding: '12px 16px',
      transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    },
    '.Input:hover': {
      borderColor: '#3a3a4a',
    },
    '.Input:focus': {
      borderColor: 'rgba(245, 166, 35, 0.5)', // amber/50
      boxShadow: '0 0 0 1px rgba(245, 166, 35, 0.1)',
      outline: 'none',
    },
    '.Input--invalid': {
      borderColor: '#ef4444',
      boxShadow: '0 0 0 1px rgba(239, 68, 68, 0.1)',
    },
    '.Input::placeholder': {
      color: '#5a5a6a',
    },
    '.Label': {
      color: '#f5a623', // amber
      fontSize: '11px',
      fontWeight: '500',
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    },
    '.Error': {
      color: '#ef4444',
      fontSize: '12px',
      marginTop: '4px',
    },
    '.Tab': {
      backgroundColor: '#12121a', // panel
      border: '1px solid #2a2a3a',
      borderRadius: '8px',
      color: '#8a8a9a', // muted
    },
    '.Tab:hover': {
      backgroundColor: '#1a1a24',
      borderColor: '#3a3a4a',
      color: '#e8e8ec',
    },
    '.Tab--selected': {
      backgroundColor: 'rgba(245, 166, 35, 0.1)',
      borderColor: 'rgba(245, 166, 35, 0.5)',
      color: '#f5a623',
    },
    '.TabIcon': {
      fill: 'currentColor',
    },
    '.TabLabel': {
      fontWeight: '500',
    },
    '.Block': {
      backgroundColor: '#12121a',
      borderRadius: '8px',
      border: '1px solid #2a2a3a',
    },
  },
}

// Elements options
export const stripeElementsOptions = {
  appearance: stripeAppearance,
  loader: 'auto' as const,
}
