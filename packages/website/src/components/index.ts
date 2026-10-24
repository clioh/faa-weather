export { SEO } from './SEO'
export { Navigation } from './Navigation'
export { Hero } from './Hero'
export { Features } from './Features'
export { HowItWorks } from './HowItWorks'
export { Customization } from './Customization'
export { Pricing } from './Pricing'
export { FAQ } from './FAQ'
export { PrivacyBand } from './PrivacyBand'
export { Waitlist } from './Waitlist'
export { CartDrawer } from './CartDrawer'

// Error handling
export { ErrorBoundary, ErrorFallback } from './ErrorBoundary'

// Site chrome shared by every page
export { Logo, PageHeader, SiteFooter } from './site'

// App links (/app, /connect, /invite)
export {
  StoreButtons,
  detectPlatform,
  isAppAvailable,
  storesFor,
  type Platform,
} from './StoreButtons'
export { StepList, type Step } from './StepList'
