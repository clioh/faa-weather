import { useState } from 'react'
import { motion } from 'motion/react'
import { PageHeader, SEO, SiteFooter, StepList, StoreButtons, detectPlatform } from '../components'

const SUPPORT_EMAIL = 'support@skyglass.dev'

const steps = [
  {
    title: 'Install the SkyGlass app',
    body: 'For iPhone, iPad and Android phones.',
  },
  {
    title: 'Connect the mirror to your WiFi',
    body: 'A new mirror shows a setup network on its screen. The app walks you through joining it and putting the mirror on your home WiFi.',
  },
  {
    title: 'Finish setup in the app',
    body: 'Activate your license, choose your airports and location, and teach the mirror your face. Then arrange your widgets.',
  },
]

export function GetApp() {
  const [platform] = useState(detectPlatform)

  return (
    <div className="min-h-screen bg-bg flex flex-col overflow-x-hidden">
      <SEO
        title="Get the App"
        description="Download the SkyGlass app for iPhone and Android. Setup, pairing and layout for your SkyGlass mirror all happen in the app."
        canonical="/app"
      />

      <PageHeader />

      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="page-container flex-1 pt-10 pb-20 sm:pt-16"
      >
        <h1 className="display-3 text-fg mb-4">Get the SkyGlass app</h1>
        <p className="text-fg-2 mb-10">
          The mirror has no keyboard or touchscreen. Everything from WiFi and your license to your
          airports, face and widget layout is set up from your phone, and the app pairs with the
          mirror over your home network.
        </p>

        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
          <StoreButtons platform={platform} primary />
        </div>
        {platform === 'desktop' && (
          <p className="mt-4 text-sm text-fg-3">
            On a computer? Open skyglass.dev/app on your phone, or search for SkyGlass in the store.
          </p>
        )}

        <section className="pt-12">
          <h2 className="text-xl font-normal text-fg mb-4">How setup works</h2>
          <StepList steps={steps} />
        </section>

        <p className="mt-12 text-sm text-fg-3">
          Need help?{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="link">
            {SUPPORT_EMAIL}
          </a>
        </p>
      </motion.main>

      <SiteFooter />
    </div>
  )
}
