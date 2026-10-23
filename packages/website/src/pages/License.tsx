import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, SEO, SiteFooter } from '../components'
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

const statusStyles: Record<LicenseStatus, { dot: string; text: string; label: string }> = {
  active: { dot: 'bg-accent', text: 'text-accent', label: 'Active' },
  pending: { dot: 'bg-warning', text: 'text-warning', label: 'Not activated' },
  revoked: { dot: 'bg-danger', text: 'text-danger', label: 'Revoked' },
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
    <div role="alert" className="notice notice-error">
      {children}
    </div>
  )
}

function NoticeBox({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="notice notice-info">
      {children}
    </div>
  )
}

const supportLink = (
  <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2 hover:text-fg">
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
      <div className="border-y border-line py-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-1.5 h-1.5 bg-accent rounded-full" aria-hidden="true" />
          <span className="section-label text-accent">Check your inbox</span>
        </div>
        <p className="text-fg">If we have licenses for that email, a sign-in link is on its way.</p>
        <p className="text-sm text-fg-2">
          The link works for 30 minutes. Nothing arriving? Check spam, or make sure you used the
          same email as at checkout.
        </p>
        <button
          type="button"
          onClick={() => {
            setSent(false)
            setEmail('')
          }}
          className="link text-sm min-h-11 inline-flex items-center"
        >
          Use a different email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {notice && <ErrorBox>{notice}</ErrorBox>}

      <div>
        <label htmlFor="license-email" className="field-label">
          Email address
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
          aria-invalid={error ? 'true' : undefined}
          className="field-input"
        />
        <p className="field-hint">The email you used at checkout. We'll send you a sign-in link.</p>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <button type="submit" disabled={isSubmitting} className="btn btn-primary w-full sm:w-auto">
        {isSubmitting ? (
          <>
            <Spinner />
            Sending...
          </>
        ) : (
          'Email me a sign-in link'
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

function LicenseCard({
  license,
  email,
  releasesRemaining,
  confirming,
  isWorking,
  onAsk,
  onConfirm,
}: LicenseCardProps) {
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
    <li className="border-t border-line py-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-normal text-fg">{productName(license.productId)}</h3>
          <p className="font-mono text-sm text-fg-2 break-all">{maskKey(license.keyLast4)}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 pt-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
          <span className={`text-sm ${status.text}`}>{status.label}</span>
        </div>
      </div>

      <dl className="space-y-2">
        {details.map((item) => (
          <div key={item.label} className="flex items-baseline justify-between gap-4 min-w-0">
            <dt className="text-sm text-fg-3 flex-shrink-0">{item.label}</dt>
            <dd className="text-sm text-fg-2 font-mono text-right break-all min-w-0">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {license.status === 'revoked' && (
        <p className="text-sm text-fg-2">
          This license was revoked after a refund or chargeback. If that's unexpected, contact{' '}
          {supportLink}.
        </p>
      )}

      {license.status === 'pending' && license.keyLast4 === null && (
        <p className="text-sm text-fg-2">
          This license will come pre-installed on your kit's SD card. Your mirror activates it on
          first boot.
        </p>
      )}

      {canRelease && isConfirming !== 'release' && (
        <button
          type="button"
          onClick={() => onAsk({ kind: 'release', licenseId: license.id })}
          className="btn btn-secondary btn-sm h-11"
        >
          Release from this mirror
        </button>
      )}

      {canRelease && isConfirming === 'release' && (
        <div className="panel p-4 sm:p-5 space-y-4">
          <p className="text-fg">
            Release this license from{' '}
            <span className="font-mono">{license.mirrorId ?? 'its current mirror'}</span>?
          </p>
          <p className="text-sm text-fg-2">
            This frees the license so you can activate it on another mirror with the same key. The
            current mirror stops working after its next check-in.
          </p>
          <p
            className={`font-mono text-xs ${releasesRemaining <= 0 ? 'text-danger' : 'text-warning'}`}
          >
            {releasesRemaining} of {MAX_RELEASES} transfers left in the last 12 months
          </p>
          {releasesRemaining <= 0 ? (
            <p className="text-sm text-fg-2">
              You've used all your transfers for now. Contact {supportLink} and we'll sort it out.
            </p>
          ) : null}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onConfirm}
              disabled={isWorking || releasesRemaining <= 0}
              className="btn btn-danger btn-sm h-11"
            >
              {isWorking ? (
                <>
                  <Spinner className="w-4 h-4" />
                  Releasing...
                </>
              ) : (
                'Release license'
              )}
            </button>
            <button
              type="button"
              onClick={() => onAsk(null)}
              disabled={isWorking}
              className="btn btn-secondary btn-sm h-11"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {canReissue && isConfirming !== 'reissue' && (
        <button
          type="button"
          onClick={() => onAsk({ kind: 'reissue', licenseId: license.id })}
          className="btn btn-secondary btn-sm h-11"
        >
          Send a new key
        </button>
      )}

      {canReissue && isConfirming === 'reissue' && (
        <div className="panel p-4 sm:p-5 space-y-4">
          <p className="text-fg">
            Send a new key to <span className="font-mono break-all">{email}</span>?
          </p>
          <p className="text-sm text-fg-2">
            Use this if your key was lost or shared. The key ending in{' '}
            <span className="font-mono text-fg">{license.keyLast4}</span> stops working right away,
            and the new key arrives by email.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onConfirm}
              disabled={isWorking}
              className="btn btn-danger btn-sm h-11"
            >
              {isWorking ? (
                <>
                  <Spinner className="w-4 h-4" />
                  Sending...
                </>
              ) : (
                'Send new key'
              )}
            </button>
            <button
              type="button"
              onClick={() => onAsk(null)}
              disabled={isWorking}
              className="btn btn-secondary btn-sm h-11"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
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
      setLoadError(
        err instanceof LicenseApiError ? err.message : 'Something went wrong. Please try again.'
      )
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
          <>
            You've reached the limit of {MAX_RELEASES} transfers in 12 months. Contact {supportLink}{' '}
            and we'll help you move it.
          </>
        )
      } else if (err.httpStatus === 404) {
        setActionError('That license could not be found. The list has been refreshed.')
        setConfirming(null)
        await load()
      } else if (err.httpStatus === 409) {
        setActionError(
          'This license is active on a mirror. Release it first, then request a new key.'
        )
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
        <Spinner className="w-8 h-8 text-accent mb-4" />
        <p className="text-fg-2">Loading your licenses...</p>
      </div>
    )
  }

  if (loadError && !data) {
    return (
      <div className="space-y-6">
        <ErrorBox>{loadError}</ErrorBox>
        <button type="button" onClick={() => void load()} className="btn btn-secondary">
          Try again
        </button>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-sm text-fg-2 min-w-0">
          Signed in as <span className="text-fg font-mono break-all">{data.email}</span>
        </p>
        <button
          type="button"
          onClick={onSignOut}
          className="link text-sm min-h-11 inline-flex items-center self-start sm:self-auto"
        >
          Sign out
        </button>
      </div>

      {notice && <NoticeBox>{notice}</NoticeBox>}
      {actionError && <ErrorBox>{actionError}</ErrorBox>}
      {loadError && <ErrorBox>{loadError}</ErrorBox>}

      {data.licenses.length === 0 ? (
        <div className="border-y border-line py-8">
          <p className="text-fg mb-2">No licenses found for this email.</p>
          <p className="text-sm text-fg-2">
            If you bought SkyGlass with a different email, sign out and use that one. Otherwise,
            contact {supportLink}.
          </p>
        </div>
      ) : (
        <ul className="border-b border-line">
          {data.licenses.map((license) => (
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
          ))}
        </ul>
      )}

      <p className="text-xs text-fg-3">
        One license runs one mirror at a time. You can move a license {MAX_RELEASES} times in any 12
        months ({data.releasesRemaining} left). Reinstalling the same Pi never uses one up.
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
  const [token, setToken] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('token')
  )
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('token')) {
      navigate('/license', { replace: true })
    }
  }, [navigate])

  const handleExpired = useCallback(() => {
    setToken(null)
    setNotice(
      'That sign-in link has expired or is no longer valid. Enter your email to get a new one.'
    )
  }, [])

  const handleSignOut = useCallback(() => {
    setToken(null)
    setNotice(null)
  }, [])

  return (
    <div className="min-h-screen bg-bg flex flex-col overflow-x-hidden">
      <SEO
        title="Manage Your License"
        description="Release a SkyGlass license from a mirror or request a new license key."
        canonical="/license"
        noindex
      />

      <PageHeader />

      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="page-container flex-1 pt-10 pb-20 sm:pt-16"
      >
        <h1 className="display-3 text-fg mb-4">Manage your license</h1>
        <p className="text-fg-2 mb-10">
          {token
            ? 'Move a license to a new mirror, or replace a key that was lost.'
            : "Enter the email you used at checkout and we'll send you a link to view and move your licenses."}
        </p>

        {token ? (
          <LicenseList token={token} onExpired={handleExpired} onSignOut={handleSignOut} />
        ) : (
          <RequestLinkForm notice={notice} />
        )}

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
