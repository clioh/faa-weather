import { motion, AnimatePresence } from 'motion/react'
import { useWaitlist } from '../store/waitlist'

interface WaitlistModalProps {
  isOpen: boolean
  onClose: () => void
}

export function WaitlistModal({ isOpen, onClose }: WaitlistModalProps) {
  const {
    email,
    airport,
    position,
    isSubmitted,
    isSubmitting,
    error,
    setEmail,
    setAirport,
    submit,
    reset,
  } = useWaitlist()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await submit()
  }

  const handleClose = () => {
    onClose()
    // Reset form after animation completes
    setTimeout(reset, 300)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-void/90 backdrop-blur-sm z-50"
          />

          {/* Modal Container */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.3 }}
              className="w-full max-w-lg"
            >
            <div className="instrument-card p-8 relative">
              {/* Close button */}
              <button
                onClick={handleClose}
                className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center text-muted hover:text-light transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {!isSubmitted ? (
                <>
                  {/* Header */}
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber/10 border border-amber/30 flex items-center justify-center">
                      <svg className="w-8 h-8 text-amber" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                    </div>
                    <h3 className="font-display text-2xl font-bold text-light mb-2">
                      Join the Waitlist
                    </h3>
                    <p className="text-muted">
                      Be the first to know when SkyGlass is available for pre-order.
                    </p>
                  </div>

                  {/* Form */}
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                      <label className="block font-mono text-xs text-amber uppercase tracking-wider mb-2">
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="pilot@example.com"
                        required
                        className="w-full px-4 py-3 bg-panel border border-border rounded-lg text-light placeholder:text-muted focus:outline-none focus:border-amber/50 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-xs text-amber uppercase tracking-wider mb-2">
                        Home Airport (Optional)
                      </label>
                      <input
                        type="text"
                        value={airport}
                        onChange={(e) => setAirport(e.target.value)}
                        placeholder="KJFK"
                        maxLength={4}
                        className="w-full px-4 py-3 bg-panel border border-border rounded-lg text-light placeholder:text-muted focus:outline-none focus:border-amber/50 font-mono uppercase"
                      />
                      <p className="text-xs text-muted mt-2">
                        Enter your ICAO code to see your airport's weather in your welcome email.
                      </p>
                    </div>

                    {error && (
                      <div className="px-4 py-3 bg-ifr/10 border border-ifr/30 rounded-lg text-ifr text-sm">
                        {error}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                    >
                      {isSubmitting ? (
                        <>
                          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Processing...
                        </>
                      ) : (
                        'Join Waitlist'
                      )}
                    </button>

                    <p className="text-xs text-muted text-center">
                      We'll only email you about SkyGlass. No spam, ever.
                    </p>
                  </form>
                </>
              ) : (
                /* Success state */
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center py-8"
                >
                  <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-vfr/20 border border-vfr/50 flex items-center justify-center">
                    <svg className="w-10 h-10 text-vfr" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="font-display text-2xl font-bold text-light mb-2">
                    You're on the list!
                  </h3>
                  <p className="text-muted mb-6">
                    We'll notify you as soon as SkyGlass is ready for pre-order.
                    {airport && (
                      <>
                        <br />
                        <span className="text-amber">Check your inbox for weather at {airport}.</span>
                      </>
                    )}
                  </p>

                  {position && (
                    <div className="instrument-card p-4 inline-block">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 bg-vfr rounded-full animate-pulse" />
                        <span className="font-mono text-sm text-muted">
                          Position #{position} in queue
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="mt-8">
                    <button
                      onClick={handleClose}
                      className="btn-secondary"
                    >
                      Back to Site
                    </button>
                  </div>
                </motion.div>
              )}
            </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
