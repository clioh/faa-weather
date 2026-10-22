import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Link, useNavigate } from 'react-router-dom'
import { SEO } from '../components'
import { getProduct } from '../store/cart'
import {
  LicenseApiError,
  listLicenses,
  reissueLicense,
  releaseLicense,
  requestManageLink,
  type LicenseStatus,
  type ManageListResponse,
  type ManagedLicense,
} from '../lib/licenseApi'

const SUPPORT_EMAIL = 'support@skyglass.dev'
const MAX_RELEASES = 3

const inputClass =
  'w-full px-4 py-3 bg-panel border border-border rounded-lg text-light placeholder:text-muted focus:outline-none focus:border-amber/50 font-mono'

const statusStyles: Record<LicenseStatus, { dot: string; text: string; label: string }> = {
  active: { dot: 'bg-vfr', text: 'text-vfr', label: 'Active' },
  pending: { dot: 'bg-amber', text: 'text-amber', label: 'Not activated' },
  revoked: { dot: 'bg-ifr', text: 'text-ifr', label: 'Revoked' },
}

const maskKey = (last4: string | null) => (last4 ? `••••-••••-••••-${last4}` : 'Not assigned yet')

const formatDate = (iso: string | null) => {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const productName = (productId: string) => getProduct(productId)?.name ?? productId

function Spinner({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="px-4 py-3 bg-ifr/10 border border-ifr/30 rounded-lg text-ifr text-sm flex items-start gap-3"
    >
      <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <div>{children}</div>
    </div>
  )
}

function NoticeBox({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="px-4 py-3 bg-vfr/10 border border-vfr/30 rounded-lg text-vfr text-sm flex items-start gap-3">
      <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
      <div>{children}</div>
    </div>
  )
}

const supportLink = (
  <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-light">
    {SUPPORT_EMAIL}
  </a>
)

// ---------------------------------------------------------------------------
// Mode 1: request a sign-in link
// ---------------------------------------------------------------------------

function RequestLinkForm({ notice }: { notice: string | null }) {
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) {
      setError('Enter the email you used at checkout.')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await requestManageLink(email.trim())
      setSent(true)
    } catch (err) {
      if (err instanceof LicenseApiError && err.httpStatus === 429) {
        setError('Too many requests from this network. Please wait an hour and try again.')
      } else if (err instanceof LicenseApiError) {
        setError(err.message)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (sent) {
    return (
      <div className="instrument-card p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-vfr rounded-full animate-pulse" />
          <span className="font-mono text-sm text-vfr uppercase tracking-wider">Check your inbox</span>
        </div>
        <p className="text-light">If we have licenses for that email, a sign-in link is on its way.</p>
        <p className="text-sm text-muted">
          The link works for 30 minutes. Nothing arriving? Check spam, or make sure you used the same
          email as at checkout.
        </p>
        <button
          type="button"
          onClick={() => {
            setSent(false)
            setEmail('')
          }}
          className="text-sm text-amber hover:underline"
        >
          Use a different email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="instrument-card p-6 md:p-8 space-y-6" noValidate>
      {notice && <ErrorBox>{notice}</ErrorBox>}

      <div>
        <label htmlFor="license-email" className="block font-mono text-xs text-amber uppercase tracking-wider mb-2">
          Email Address
        </label>
        <input
          id="license-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setError(null)
          }}
          placeholder="pilot@example.com"
          required
          className={inputClass}
        />
        <p className="mt-2 text-xs text-muted">The email you used at checkout. We'll send you a sign-in link.</p>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
      >
        {isSubmitting ? (
          <>
            <Spinner />
            Sending...
          </>
        ) : (
          'Email Me a Sign-In Link'
        )}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Mode 2: list and manage licenses
// ---------------------------------------------------------------------------

type PendingAction = { kind: 'release' | 'reissue'; licenseId: string } | null

interface LicenseCardProps {
  license: ManagedLicense
  email: string
  releasesRemaining: number
  confirming: PendingAction
  isWorking: boolean
  onAsk: (action: PendingAction) => void
  onConfirm: () => void
}

function LicenseCard({ license, email, releasesRemaining, confirming, isWorking, onAsk, onConfirm }: LicenseCardProps) {
  const status = statusStyles[license.status]
  const isConfirming = confirming?.licenseId === license.id ? confirming.kind : null
  const canRelease = license.status === 'active'
  // An unkeyed pending license is a kit that hasn't been provisioned yet: nothing to reissue.
  const canReissue = license.status === 'pending' && license.keyLast4 !== null

  const details = [
    { label: 'Mirror', value: license.mirrorId ?? '—' },
    { label: 'Activated', value: formatDate(license.activatedAt) },
    { label: 'Last seen', value: formatDate(license.lastSeenAt) },
  ]

  return (
    <div className="instrument-card p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold text-light">{productName(license.productId)}</h3>
          <p className="font-mono text-sm text-muted break-all">{maskKey(license.keyLast4)}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className={`w-2.5 h-2.5 rounded-full ${status.dot}`} />
          <span className={`font-mono text-xs uppercase tracking-wider ${status.text}`}>{status.label}</span>
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {details.map((item) => (
          <div key={item.label} className="p-3 bg-panel rounded-lg border border-border min-w-0">
            <dt className="font-mono text-xs text-amber uppercase tracking-wider mb-1">{item.label}</dt>
            <dd className="text-sm text-light font-mono break-all">{item.value}</dd>
          </div>
        ))}
      </dl>

      {license.status === 'revoked' && (
        <p className="text-sm text-muted">
          This license was revoked after a refund or chargeback. If that's unexpected, contact {supportLink}.
        </p>
      )}

      {license.status === 'pending' && license.keyLast4 === null && (
        <p className="text-sm text-muted">
          This license will come pre-installed on your kit's SD card. Your mirror activates it on first boot.
        </p>
      )}

      {canRelease && isConfirming !== 'release' && (
        <button type="button" onClick={() => onAsk({ kind: 'release', licenseId: license.id })} className="btn-secondary text-sm px-6 py-3">
          Release from this mirror
        </button>
      )}

      {canRelease && isConfirming === 'release' && (
        <div className="p-4 bg-panel border border-amber/30 rounded-lg space-y-4">
          <p className="text-sm text-light">Release this license from {license.mirrorId ?? 'its current mirror'}?</p>
          <p className="text-sm text-muted">
            This frees the license so you can activate it on another mirror with the same key. The current mirror
            stops working after its next check-in.
          </p>
          <p className="font-mono text-xs uppercase tracking-wider text-amber">
            {releasesRemaining} of {MAX_RELEASES} transfers left in the last 12 months
          </p>
          {releasesRemaining <= 0 ? (
            <p className="text-sm text-muted">
              You've used all your transfers for now. Contact {supportLink} and we'll sort it out.
            </p>
          ) : null}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onConfirm}
              disabled={isWorking || releasesRemaining <= 0}
              className="btn-primary text-sm px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isWorking ? (
                <>
                  <Spinner className="w-4 h-4" />
                  Releasing...
                </>
              ) : (
                'Release License'
              )}
            </button>
            <button
              type="button"
              onClick={() => onAsk(null)}
              disabled={isWorking}
              className="px-6 py-3 bg-panel border border-border text-muted font-display text-sm uppercase tracking-wider hover:text-light hover:border-light/30 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {canReissue && isConfirming !== 'reissue' && (
        <button type="button" onClick={() => onAsk({ kind: 'reissue', licenseId: license.id })} className="btn-secondary text-sm px-6 py-3">
          Send a new key
        </button>
      )}

      {canReissue && isConfirming === 'reissue' && (
        <div className="p-4 bg-panel border border-amber/30 rounded-lg space-y-4">
          <p className="text-sm text-light">Send a new key to {email}?</p>
          <p className="text-sm text-muted">
            Use this if your key was lost or shared. The key ending in{' '}
            <span className="font-mono text-light">{license.keyLast4}</span> stops working right away, and the new
            key arrives by email.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onConfirm}
              disabled={isWorking}
              className="btn-primary text-sm px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isWorking ? (
                <>
                  <Spinner className="w-4 h-4" />
                  Sending...
                </>
              ) : (
                'Send New Key'
              )}
            </button>
            <button
              type="button"
              onClick={() => onAsk(null)}
              disabled={isWorking}
              className="px-6 py-3 bg-panel border border-border text-muted font-display text-sm uppercase tracking-wider hover:text-light hover:border-light/30 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface LicenseListProps {
  token: string
  onExpired: () => void
  onSignOut: () => void
}

function LicenseList({ token, onExpired, onSignOut }: LicenseListProps) {
  const [data, setData] = useState<ManageListResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [confirming, setConfirming] = useState<PendingAction>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [actionError, setActionError] = useState<React.ReactNode>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      setData(await listLicenses(token))
    } catch (err) {
      if (err instanceof LicenseApiError && err.httpStatus === 401) {
        onExpired()
        return
      }
      setLoadError(err instanceof LicenseApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [token, onExpired])

  useEffect(() => {
    void load()
  }, [load])

  const ask = (action: PendingAction) => {
    setConfirming(action)
    setActionError(null)
    setNotice(null)
  }

  const confirm = async () => {
    if (!confirming || !data) return
    const { kind, licenseId } = confirming
    setIsWorking(true)
    setActionError(null)
    try {
      if (kind === 'release') {
        await releaseLicense(token, licenseId)
        setNotice('License released. You can now activate it on another mirror with the same key.')
      } else {
        await reissueLicense(token, licenseId)
        setNotice(`A new key is on its way to ${data.email}. The old key no longer works.`)
      }
      setConfirming(null)
      await load()
    } catch (err) {
      if (!(err instanceof LicenseApiError)) {
        setActionError('Something went wrong. Please try again.')
      } else if (err.httpStatus === 401) {
        onExpired()
      } else if (err.code === 'transfer_limit' || err.httpStatus === 429) {
        setActionError(
          <>You've reached the limit of {MAX_RELEASES} transfers in 12 months. Contact {supportLink} and we'll help you move it.</>
        )
      } else if (err.httpStatus === 404) {
        setActionError('That license could not be found. The list has been refreshed.')
        setConfirming(null)
        await load()
      } else if (err.httpStatus === 409) {
        setActionError('This license is active on a mirror. Release it first, then request a new key.')
        setConfirming(null)
        await load()
      } else {
        setActionError(err.message)
      }
    } finally {
      setIsWorking(false)
    }
  }

  if (isLoading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Spinner className="w-8 h-8 text-amber mb-4" />
        <p className="text-muted">Loading your licenses...</p>
      </div>
    )
  }

  if (loadError && !data) {
    return (
      <div className="instrument-card p-6 md:p-8 text-center space-y-6">
        <ErrorBox>{loadError}</ErrorBox>
        <button type="button" onClick={() => void load()} className="btn-secondary">
          Try Again
        </button>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-sm text-muted">
          Signed in as <span className="text-light font-mono break-all">{data.email}</span>
        </p>
        <button type="button" onClick={onSignOut} className="text-sm text-amber hover:underline self-start sm:self-auto">
          Sign out
        </button>
      </div>

      {notice && <NoticeBox>{notice}</NoticeBox>}
      {actionError && <ErrorBox>{actionError}</ErrorBox>}
      {loadError && <ErrorBox>{loadError}</ErrorBox>}

      {data.licenses.length === 0 ? (
        <div className="instrument-card p-6 md:p-8 text-center">
          <p className="text-light mb-2">No licenses found for this email.</p>
          <p className="text-sm text-muted">
            If you bought SkyGlass with a different email, sign out and use that one. Otherwise, contact {supportLink}.
          </p>
        </div>
      ) : (
        data.licenses.map((license) => (
          <LicenseCard
            key={license.id}
            license={license}
            email={data.email}
            releasesRemaining={data.releasesRemaining}
            confirming={confirming}
            isWorking={isWorking}
            onAsk={ask}
            onConfirm={() => void confirm()}
          />
        ))
      )}

      <p className="text-xs text-muted text-center">
        One license runs one mirror at a time. You can move a license {MAX_RELEASES} times in any 12 months
        ({data.releasesRemaining} left). Reinstalling the same Pi never uses one up.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function License() {
  const navigate = useNavigate()
  // Read the emailed sign-in token once, then strip it from the URL so it doesn't linger in
  // history, screenshots, or shared links.
  const [token, setToken] = useState<string | null>(() => new URLSearchParams(window.location.search).get('token'))
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('token')) {
      navigate('/license', { replace: true })
    }
  }, [navigate])

  const handleExpired = useCallback(() => {
    setToken(null)
    setNotice('That sign-in link has expired or is no longer valid. Enter your email to get a new one.')
  }, [])

  const handleSignOut = useCallback(() => {
    setToken(null)
    setNotice(null)
  }, [])

  return (
    <div className="min-h-screen bg-void flex flex-col">
      <SEO
        title="Manage Your License"
        description="Release a SkyGlass license from a mirror or request a new license key."
        canonical="/license"
        noindex
      />

      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group" aria-label="SkyGlass - Back to home">
            <div className="w-10 h-10 bg-instrument border border-amber/30 rounded-lg flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-amber" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="2" width="18" height="20" rx="2" />
                <circle cx="18" cy="5" r="1.5" fill="currentColor" />
              </svg>
            </div>
            <span className="font-display text-xl font-bold">
              <span className="text-light">Sky</span>
              <span className="text-amber">Glass</span>
            </span>
          </Link>
          <Link to="/" className="text-sm text-muted hover:text-amber transition-colors">
            ← Back to Home
          </Link>
        </div>
      </header>

      {/* Content */}
      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="flex-1 w-full max-w-2xl mx-auto px-6 py-16"
      >
        <h1 className="font-display text-4xl font-bold text-light mb-4">
          Manage your <span className="text-gradient-amber">license</span>
        </h1>
        <p className="text-muted mb-10">
          {token
            ? 'Move a license to a new mirror, or replace a key that was lost.'
            : "Enter the email you used at checkout and we'll send you a link to view and move your licenses."}
        </p>

        {token ? (
          <LicenseList token={token} onExpired={handleExpired} onSignOut={handleSignOut} />
        ) : (
          <RequestLinkForm notice={notice} />
        )}
      </motion.main>

      {/* Minimal footer */}
      <footer className="border-t border-border py-6">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <p className="text-sm text-muted">
            Need help?{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-amber hover:underline">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}
