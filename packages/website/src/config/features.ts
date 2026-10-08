/**
 * Feature Flags
 *
 * Control feature availability across the site.
 * Set via environment variables or hardcode for development.
 */

export const features = {
  /**
   * E-commerce mode: When enabled, shows "Add to Cart" buttons
   * and enables the full checkout flow. When disabled, shows
   * "Join Waitlist" buttons instead.
   */
  ecommerce: import.meta.env.VITE_FEATURE_ECOMMERCE === 'true',

  /**
   * Pre-orders: When enabled (with ecommerce), allows purchases
   * but marks them as pre-orders with expected ship date.
   */
  preorders: import.meta.env.VITE_FEATURE_PREORDERS === 'true',
} as const

// Helper to check if purchasing is enabled
export const canPurchase = () => features.ecommerce

// Helper to check if it's pre-order mode
export const isPreorderMode = () => features.ecommerce && features.preorders
