import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { SEO } from '../components'

export function NotFound() {
  return (
    <div className="min-h-screen bg-void flex flex-col">
      <SEO
        title="404 - Page Not Found"
        description="The page you're looking for doesn't exist or has been moved."
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
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-lg"
        >
          {/* Glitchy 404 display */}
          <div className="relative mb-8">
            <div className="font-mono text-8xl md:text-9xl font-bold text-amber/20 select-none">
              404
            </div>
            <motion.div
              className="absolute inset-0 font-mono text-8xl md:text-9xl font-bold text-amber"
              animate={{
                opacity: [1, 0.5, 1, 0.8, 1],
                x: [0, -2, 0, 2, 0],
              }}
              transition={{
                duration: 0.5,
                repeat: Infinity,
                repeatDelay: 3,
              }}
            >
              404
            </motion.div>
          </div>

          {/* Aviation-themed message */}
          <div className="instrument-card p-6 mb-8">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="w-3 h-3 rounded-full bg-ifr animate-pulse" />
              <span className="font-mono text-sm text-ifr uppercase tracking-wider">
                Signal Lost
              </span>
            </div>
            <h1 className="font-display text-2xl font-bold text-light mb-2">
              Off Course
            </h1>
            <p className="text-muted">
              The page you're looking for doesn't exist or has been moved.
              Let's get you back on track.
            </p>
          </div>

          {/* Navigation options */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/"
              className="px-6 py-3 bg-amber/10 border border-amber/50 text-amber font-display text-sm uppercase tracking-wider hover:bg-amber/20 transition-colors"
            >
              Return Home
            </Link>
            <button
              onClick={() => window.history.back()}
              className="px-6 py-3 bg-panel border border-border text-muted font-display text-sm uppercase tracking-wider hover:text-light hover:border-light/30 transition-colors"
            >
              Go Back
            </button>
          </div>

          {/* Coordinates joke */}
          <p className="mt-8 font-mono text-xs text-muted/50">
            Position: N/A | Altitude: N/A | Heading: ???
          </p>
        </motion.div>
      </main>

      {/* Minimal footer */}
      <footer className="border-t border-border py-6">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <p className="text-sm text-muted">
            Need help?{' '}
            <a href="mailto:hello@skyglass.dev" className="text-amber hover:underline">
              Contact us
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}
