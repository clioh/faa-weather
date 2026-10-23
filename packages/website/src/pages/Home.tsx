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

export function Home() {
  return (
    <>
      <SEO canonical="/" />
      <div id="top" className="site-container scroll-mt-24">
        <Hero />
        <HowItWorks />
        <Features />
        <Customization />
        <PrivacyBand />
        <Pricing />
        <FAQ />
        <Waitlist />
      </div>
    </>
  )
}
