import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import {
  PageHeader,
  SEO,
  SiteFooter,
  StepList,
  StoreButtons,
  detectPlatform,
  isAppAvailable,
  type Platform,
} from '../components'
import { APP_URL_SCHEME } from '../config/app'
import { cleanLabel, hashParams, parseHost, parsePort } from '../lib/appLinks'

const SUPPORT_EMAIL = 'support@skyglass.dev'

// The mirror's QR secret: 16 random bytes as base64url (22 characters) today
// (packages/backend/src/pairing/service.ts). Accept a little more in case it grows.
const PAIR_SECRET_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export interface ConnectParams {
  host: string
  port: number
  /** Single-use pairing secret from the QR code; null when the link has none. */
  pair: string | null
  mirrorName: string | null
}

/**
 * Parse the pairing link from the URL fragment: #h=<host>&p=<port>&pair=<secret>&m=<mirror>.
 * The values live in the fragment so the pairing secret never reaches a server, logs or
 * analytics. Returns null when the host or port is missing or malformed. A missing or
 * malformed secret only drops the secret: the app can still pair with the on-screen code.
 */
export function parseConnectHash(hash: string): ConnectParams | null {
  const params = hashParams(hash)
  const host = parseHost(params.get('h'))
  const port = parsePort(params.get('p'))
  if (!host || port === null) return null

  const pair = params.get('pair')?.trim() ?? ''
  return {
    host,
    port,
    pair: PAIR_SECRET_PATTERN.test(pair) ? pair : null,
    mirrorName: cleanLabel(params.get('m')),
  }
}

export function appConnectUrl({ host, port, pair }: ConnectParams): string {
  const query = new URLSearchParams({ host, port: String(port) })
  if (pair) query.set('pair', pair)
  return `${APP_URL_SCHEME}://connect?${query.toString()}`
}

function installStep(platform: Platform) {
  if (!isAppAvailable(platform)) {
    return {
      title: 'Install the SkyGlass app',
      body: "The app isn't in the App Store or Google Play yet. It's coming soon.",
    }
  }
  const where =
    platform === 'ios'
      ? 'from the App Store'
      : platform === 'android'
        ? 'from Google Play'
        : 'on your phone, from the App Store (iPhone) or Google Play (Android)'
  return { title: 'Install the SkyGlass app', body: `Get it ${where}.` }
}

function ConnectDetails({ link, platform }: { link: ConnectParams; platform: Platform }) {
  const steps = [
    installStep(platform),
    {
      title: 'Join the same WiFi as the mirror',
      body: 'Your phone talks to the mirror directly over your home network, not through the internet.',
    },
    {
      title: "Scan the mirror's code again",
      body: "The app opens and pairs by itself. Or just open the app: it finds the mirror on your network and pairs with the 6-digit code on the mirror's screen.",
    },
  ]

  return (
    <div className="space-y-6">
      <section className="space-y-6">
        <div className="flex items-center gap-2.5">
          <span className="w-1.5 h-1.5 bg-accent rounded-full flex-shrink-0" aria-hidden="true" />
          <span className="section-label text-accent">Mirror found</span>
        </div>

        <dl className="border-b border-line">
          <div className="flex items-baseline justify-between gap-4 min-h-[52px] py-3.5 border-t border-line min-w-0">
            <dt className="text-fg-2 flex-shrink-0">Mirror</dt>
            <dd className="text-fg text-right break-words min-w-0">
              {link.mirrorName ?? 'SkyGlass'}
            </dd>
          </div>
        </dl>

        <p className="text-fg-2">
          This code pairs the SkyGlass app with the mirror. If you have the app, it normally opens
          by itself. If you're seeing this page instead, install the app, or tap "Open in SkyGlass
          app" if it's already on this phone.
        </p>

        {platform === 'desktop' && (
          <div role="status" className="notice notice-info">
            Open this on your phone. Point your phone's camera at the code on the mirror, or visit{' '}
            <Link to="/app" className="link">
              skyglass.dev/app
            </Link>{' '}
            on your phone to get the app.
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
          {platform !== 'desktop' && (
            <a href={appConnectUrl(link)} className="btn btn-primary w-full sm:w-auto">
              Open in SkyGlass app
            </a>
          )}
          <StoreButtons platform={platform} />
        </div>
      </section>

      <section className="pt-4">
        <h2 className="text-xl font-normal text-fg mb-4">How to pair</h2>
        <StepList steps={steps} />
      </section>

      <p className="text-xs text-fg-3">
        The code on the mirror changes every 10 minutes and works once, so scan it fresh rather than
        reusing a photo or an old link.
      </p>
    </div>
  )
}

function IncompleteLink() {
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-2.5">
        <span className="w-1.5 h-1.5 bg-danger rounded-full flex-shrink-0" aria-hidden="true" />
        <span className="section-label text-danger">Link incomplete</span>
      </div>
      <h2 className="text-xl font-normal text-fg">Scan the code on the mirror</h2>
      <p className="text-fg-2">
        This page opens from the code a SkyGlass mirror shows on its screen, and part of that link
        is missing here. Point your phone's camera at the code on the mirror to pair it with the
        SkyGlass app.
      </p>
      <p className="text-fg-2">
        Don't have the app yet?{' '}
        <Link to="/app" className="link">
          Get the SkyGlass app
        </Link>
        . Once it's installed, open it on the same WiFi as the mirror: it finds the mirror and pairs
        with the code on the mirror's screen.
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Connect() {
  // Read the fragment only in the browser. Never copy it into the query string, log it,
  // or send it anywhere but the app: it carries a single-use pairing secret.
  const [link, setLink] = useState<ConnectParams | null>(() =>
    parseConnectHash(window.location.hash)
  )
  const [platform] = useState(detectPlatform)

  useEffect(() => {
    const onHashChange = () => setLink(parseConnectHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <div className="min-h-screen bg-bg flex flex-col overflow-x-hidden">
      <SEO
        title="Pair Your Phone"
        description="Pair the SkyGlass phone app with your SkyGlass mirror."
        canonical="/connect"
        noindex
      />

      <PageHeader />

      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="page-container flex-1 pt-10 pb-20 sm:pt-16"
      >
        <h1 className="display-3 text-fg mb-4 break-words">
          {link?.mirrorName ? <>Pair with {link.mirrorName}</> : <>Pair with your mirror</>}
        </h1>
        <p className="text-fg-2 mb-10">
          {link
            ? 'Set up and control your SkyGlass mirror from the SkyGlass app.'
            : 'Connect the SkyGlass app to your SkyGlass mirror.'}
        </p>

        {link ? <ConnectDetails link={link} platform={platform} /> : <IncompleteLink />}

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
