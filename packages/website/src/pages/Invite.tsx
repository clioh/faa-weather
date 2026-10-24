import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  PageHeader,
  SEO,
  SiteFooter,
  StepList,
  StoreButtons,
  detectPlatform,
  isAppAvailable,
} from '../components'
import { APP_URL_SCHEME } from '../config/app'
import { cleanLabel, hashParams, parseHost, parsePort } from '../lib/appLinks'

const SUPPORT_EMAIL = 'support@skyglass.dev'

const TOKEN_PATTERN = /^sgi_[A-Za-z0-9_-]{20,120}$/

export interface InviteParams {
  host: string
  port: number
  token: string
  personName: string | null
  mirrorName: string | null
}

/**
 * Parse the invite from the URL fragment: #h=<host>&p=<port>&t=<token>&n=<name>&m=<mirror>.
 * The values live in the fragment so the single-use token never reaches a server, logs or
 * analytics. Returns null when a required value is missing or malformed.
 */
export function parseInviteHash(hash: string): InviteParams | null {
  const params = hashParams(hash)
  const host = parseHost(params.get('h'))
  const port = parsePort(params.get('p'))
  const token = params.get('t')?.trim() ?? ''
  if (!host || port === null || !TOKEN_PATTERN.test(token)) return null

  return {
    host,
    port,
    token,
    personName: cleanLabel(params.get('n')),
    mirrorName: cleanLabel(params.get('m')),
  }
}

export function appInviteUrl({ host, port, token }: InviteParams): string {
  return `${APP_URL_SCHEME}://invite?host=${encodeURIComponent(host)}&port=${encodeURIComponent(String(port))}&token=${encodeURIComponent(token)}`
}

function InviteDetails({ invite }: { invite: InviteParams }) {
  const mirror = invite.mirrorName ?? 'a SkyGlass mirror'
  const [platform] = useState(detectPlatform)

  const steps = [
    {
      title: 'Install the SkyGlass app',
      body: isAppAvailable(platform)
        ? 'Get it from the App Store on iPhone or iPad, or from Google Play on Android.'
        : "The app isn't in the App Store or Google Play yet. Ask whoever invited you how to get it.",
    },
    {
      title: 'Join the same WiFi as the mirror',
      body: 'Your phone talks to the mirror directly over your home network.',
    },
    {
      title: 'Tap "Open in SkyGlass app"',
      body: 'If you just installed the app, come back to this link and open it again.',
    },
  ]

  return (
    <div className="space-y-6">
      <section className="space-y-6">
        <div className="flex items-center gap-2.5">
          <span className="w-1.5 h-1.5 bg-accent rounded-full flex-shrink-0" aria-hidden="true" />
          <span className="section-label text-accent">Invite ready</span>
        </div>

        <dl className="border-b border-line">
          <div className="flex items-baseline justify-between gap-4 min-h-[52px] py-3.5 border-t border-line min-w-0">
            <dt className="text-fg-2 flex-shrink-0">Mirror</dt>
            <dd className="text-fg text-right break-words min-w-0">
              {invite.mirrorName ?? 'SkyGlass'}
            </dd>
          </div>
          {invite.personName && (
            <div className="flex items-baseline justify-between gap-4 min-h-[52px] py-3.5 border-t border-line min-w-0">
              <dt className="text-fg-2 flex-shrink-0">Invited</dt>
              <dd className="text-fg text-right break-words min-w-0">{invite.personName}</dd>
            </div>
          )}
        </dl>

        <p className="text-fg-2">
          Your face is already set up on {mirror}. Open this invite in the SkyGlass app to choose
          what the mirror shows when it recognizes you: your weather, calendar, airports and
          widgets.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <a href={appInviteUrl(invite)} className="btn btn-primary w-full sm:w-auto">
            Open in SkyGlass app
          </a>
          <StoreButtons platform={platform} />
        </div>
      </section>

      <section className="pt-4">
        <h2 className="text-xl font-normal text-fg mb-4">How to accept</h2>
        <StepList steps={steps} />
      </section>

      <p className="text-xs text-fg-3">
        Invites expire after 7 days and work once. If this one has expired, ask whoever invited you
        to send a new one.
      </p>
    </div>
  )
}

function IncompleteInvite() {
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-2.5">
        <span className="w-1.5 h-1.5 bg-danger rounded-full flex-shrink-0" aria-hidden="true" />
        <span className="section-label text-danger">Invite incomplete</span>
      </div>
      <h2 className="text-xl font-normal text-fg">This invite link is incomplete</h2>
      <p className="text-fg-2">
        Part of the link is missing, which can happen when a link is copied or wraps across lines.
        Open the original message and tap the whole link, or ask whoever invited you to send it
        again.
      </p>
      <p className="text-sm text-fg-3">
        Invites expire after 7 days and can be re-sent from the SkyGlass app.
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Invite() {
  // Read the fragment only in the browser. Never copy it into the query string, log it,
  // or send it anywhere: it carries a single-use token.
  const [invite, setInvite] = useState<InviteParams | null>(() =>
    parseInviteHash(window.location.hash)
  )

  useEffect(() => {
    const onHashChange = () => setInvite(parseInviteHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <div className="min-h-screen bg-bg flex flex-col overflow-x-hidden">
      <SEO
        title="You're Invited"
        description="You've been invited to use a SkyGlass mirror. Open the invite in the SkyGlass app."
        canonical="/invite"
        noindex
      />

      <PageHeader />

      {/* Content */}
      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="page-container flex-1 pt-10 pb-20 sm:pt-16"
      >
        <h1 className="display-3 text-fg mb-4 break-words">
          {invite?.personName ? <>{invite.personName}, you're invited</> : <>You're invited</>}
        </h1>
        <p className="text-fg-2 mb-10">
          {invite
            ? `You've been invited to use ${invite.mirrorName ? `the "${invite.mirrorName}"` : 'a SkyGlass'} mirror.`
            : 'Someone invited you to use their SkyGlass mirror.'}
        </p>

        {invite ? <InviteDetails invite={invite} /> : <IncompleteInvite />}

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
