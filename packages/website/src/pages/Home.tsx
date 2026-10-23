import { Helmet } from 'react-helmet-async'
import {
  SEO,
  Hero,
  HowItWorks,
  Features,
  Customization,
  PrivacyBand,
  Pricing,
  FAQ,
  Waitlist,
} from '../components'
import { canPurchase, isPreorderMode } from '../config/features'
import { CATALOG } from '../../shared/catalog'

/**
 * Product structured data. Availability follows the store mode, so search
 * results never claim a kit can be ordered when it can't: pre-order mode is
 * PreOrder, purchasing is InStock, and with the store off there is no offer.
 */
function productJsonLd(): string {
  const availability = isPreorderMode()
    ? 'https://schema.org/PreOrder'
    : canPurchase()
      ? 'https://schema.org/InStock'
      : null
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'SkyGlass Complete Kit',
    description:
      'A complete smart mirror kit for pilots featuring aviation weather (METAR/TAF), TFRs, NOTAMs, flight schedules and presence detection. Includes Raspberry Pi 5, 24-inch display, two-way mirror, and all hardware.',
    brand: { '@type': 'Brand', name: 'SkyGlass' },
    ...(availability && {
      offers: {
        '@type': 'Offer',
        price: String(CATALOG['complete-kit'].priceCents / 100),
        priceCurrency: 'USD',
        availability,
        url: 'https://skyglass.dev/#pricing',
      },
    }),
    category: 'Aviation Electronics',
    audience: { '@type': 'Audience', audienceType: 'Pilots' },
  })
}

export function Home() {
  return (
    <>
      <SEO canonical="/" />
      <Helmet>
        <script type="application/ld+json">{productJsonLd()}</script>
      </Helmet>
      <div id="top" className="site-container scroll-mt-24">
        <Hero />
        <HowItWorks />
        <Features />
        <Customization />
        <PrivacyBand />
        <Pricing />
        <FAQ />
        {/* The waitlist is for before the store opens; every CTA points at #pricing once it has. */}
        {!canPurchase() && <Waitlist />}
      </div>
    </>
  )
}
