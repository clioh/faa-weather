import type { FormEvent } from 'react'
import { useWaitlist } from '../store/waitlist'

/** "Be first in line.": inline email signup, the target of every waitlist CTA (#waitlist). */
export function Waitlist() {
  const { email, isSubmitted, isSubmitting, error, setEmail, submit } = useWaitlist()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    await submit()
  }

  return (
    <section
      id="waitlist"
      aria-labelledby="waitlist-heading"
      className="flex scroll-mt-24 flex-col items-center gap-6 border-t border-line pt-24 pb-[120px] text-center"
    >
      <h2
        id="waitlist-heading"
        className="m-0 text-[clamp(40px,5.6vw,72px)] leading-[1.02] font-extralight tracking-[-0.035em]"
      >
        Be first in line.
      </h2>
      <p className="m-0 max-w-[460px] text-[17px] leading-[1.55] text-balance text-fg-2">
        We'll email you once when pre-orders open. Nothing else.
      </p>

      <div className="flex w-[min(520px,100%)] flex-col items-center gap-3">
        {isSubmitted ? null : (
          <form
            onSubmit={handleSubmit}
            noValidate
            className="flex w-full flex-wrap justify-center gap-2.5"
          >
            <label htmlFor="waitlist-email" className="sr-only">
              Email address
            </label>
            <input
              id="waitlist-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'waitlist-status' : undefined}
              className="field-input h-[52px] min-w-0 flex-[1_1_260px] rounded-[26px] px-[22px]"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary max-[400px]:w-full"
            >
              {isSubmitting ? 'Joining…' : 'Join the waitlist'}
            </button>
          </form>
        )}

        <div id="waitlist-status" aria-live="polite" className="w-full">
          {isSubmitted ? (
            <div className="notice notice-info text-left">
              You're on the list. We'll email you when pre-orders open.
            </div>
          ) : error ? (
            <div className="notice notice-error text-left">{error}</div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
