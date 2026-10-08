import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { SEO } from '../components'

export function Privacy() {
  return (
    <div className="min-h-screen bg-void">
      <SEO
        title="Privacy Policy"
        description="SkyGlass privacy policy. Face recognition runs 100% on-device. Your biometric data never leaves your home."
        canonical="/privacy"
      />
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 bg-instrument border border-amber/30 rounded-lg flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-amber" fill="none" stroke="currentColor" strokeWidth="1.5">
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
        className="max-w-4xl mx-auto px-6 py-16"
      >
        <h1 className="font-display text-4xl font-bold text-light mb-4">Privacy Policy</h1>
        <p className="text-muted mb-12">Last updated: January 2026</p>

        <div className="prose prose-invert max-w-none space-y-8">
          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Our Commitment to Privacy</h2>
            <p className="text-muted leading-relaxed">
              SkyGlass is designed with privacy at its core. We believe your personal data—especially
              biometric data like face recognition—should stay under your control. This policy explains
              what data we collect, how we use it, and the choices you have.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Face Recognition Data</h2>
            <div className="instrument-card p-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-vfr/10 border border-vfr/30 flex items-center justify-center text-vfr flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-display font-semibold text-light mb-2">100% On-Device Processing</h3>
                  <p className="text-muted text-sm leading-relaxed">
                    Face recognition embeddings are generated and stored entirely on your SkyGlass device
                    (the Raspberry Pi). This data is <strong className="text-light">never transmitted</strong> to
                    our servers or any third party. You can delete your face data at any time through the
                    companion app or web interface.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Data We Collect</h2>

            <h3 className="font-display text-lg font-semibold text-amber">When you join our waitlist:</h3>
            <ul className="list-disc list-inside text-muted space-y-2 ml-4">
              <li>Email address (required)</li>
              <li>Home airport ICAO code (optional)</li>
              <li>Timestamp of signup</li>
            </ul>

            <h3 className="font-display text-lg font-semibold text-amber mt-6">When you use SkyGlass:</h3>
            <ul className="list-disc list-inside text-muted space-y-2 ml-4">
              <li><strong className="text-light">Aviation data requests:</strong> Your configured airports are sent to aviationweather.gov to fetch METAR/TAF data. We do not log these requests.</li>
              <li><strong className="text-light">Calendar data:</strong> If you connect Google Calendar, authentication is handled directly with Google. We do not store your calendar data on our servers.</li>
              <li><strong className="text-light">Anonymous analytics:</strong> We may collect anonymous usage statistics (e.g., feature usage, error rates) to improve the product. This data cannot be tied to your identity.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Data We Never Collect</h2>
            <ul className="list-disc list-inside text-muted space-y-2 ml-4">
              <li>Face images or biometric data</li>
              <li>Camera footage</li>
              <li>Your location (beyond airport codes you configure)</li>
              <li>Your calendar event contents</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Third-Party Services</h2>
            <p className="text-muted leading-relaxed">
              SkyGlass integrates with the following third-party services:
            </p>
            <ul className="list-disc list-inside text-muted space-y-2 ml-4">
              <li><strong className="text-light">Aviation Weather Center (aviationweather.gov):</strong> For METAR, TAF, and TFR data</li>
              <li><strong className="text-light">Google Calendar API:</strong> For calendar integration (optional)</li>
              <li><strong className="text-light">Sunrise-Sunset.org:</strong> For astronomical data</li>
            </ul>
            <p className="text-muted leading-relaxed mt-4">
              Each service has its own privacy policy. We encourage you to review them.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Your Rights</h2>
            <p className="text-muted leading-relaxed">
              You have the right to:
            </p>
            <ul className="list-disc list-inside text-muted space-y-2 ml-4">
              <li>Access the personal data we hold about you</li>
              <li>Request deletion of your data from our waitlist</li>
              <li>Delete all face recognition data stored on your device</li>
              <li>Opt out of anonymous analytics</li>
            </ul>
            <p className="text-muted leading-relaxed mt-4">
              To exercise these rights, contact us at{' '}
              <a href="mailto:privacy@skyglass.dev" className="text-amber hover:underline">
                privacy@skyglass.dev
              </a>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Contact</h2>
            <p className="text-muted leading-relaxed">
              If you have questions about this privacy policy or our data practices, please contact us at{' '}
              <a href="mailto:privacy@skyglass.dev" className="text-amber hover:underline">
                privacy@skyglass.dev
              </a>
            </p>
          </section>
        </div>
      </motion.main>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="max-w-4xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted">© {new Date().getFullYear()} SkyGlass. All rights reserved.</p>
          <div className="flex gap-6 text-sm">
            <Link to="/privacy" className="text-amber">Privacy Policy</Link>
            <Link to="/terms" className="text-muted hover:text-light transition-colors">Terms of Service</Link>
            <Link to="/team" className="text-muted hover:text-light transition-colors">About</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
