import {
  SEO,
  Hero,
  Features,
  HowItWorks,
  Customization,
  InteractiveDemo,
  Pricing,
  FAQ,
  Footer,
} from '../components'

interface HomeProps {
  onWaitlistClick: () => void
}

export function Home({ onWaitlistClick }: HomeProps) {
  return (
    <>
      <SEO canonical="/" />
      <Hero onWaitlistClick={onWaitlistClick} />
      <Features />
      <HowItWorks />
      <Customization />
      <InteractiveDemo />
      <Pricing onWaitlistClick={onWaitlistClick} />
      <FAQ />
      <Footer onWaitlistClick={onWaitlistClick} />
    </>
  )
}
