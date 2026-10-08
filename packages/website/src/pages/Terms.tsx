import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { SEO } from '../components'

export function Terms() {
  return (
    <div className="min-h-screen bg-void">
      <SEO
        title="Terms of Service"
        description="SkyGlass terms of service. Important: SkyGlass is for entertainment only, not for flight planning or aviation decision-making."
        canonical="/terms"
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
        <h1 className="font-display text-4xl font-bold text-light mb-4">Terms of Service</h1>
        <p className="text-muted mb-12">Last updated: January 2026</p>

        <div className="prose prose-invert max-w-none space-y-8">
          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Agreement to Terms</h2>
            <p className="text-muted leading-relaxed">
              By accessing or using SkyGlass products and services, you agree to be bound by these
              Terms of Service. If you do not agree to these terms, please do not use our products.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Important Disclaimer</h2>
            <div className="instrument-card p-6 border-ifr/30">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-ifr/10 border border-ifr/30 flex items-center justify-center text-ifr flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-display font-semibold text-light mb-2">Not for Flight Planning</h3>
                  <p className="text-muted text-sm leading-relaxed">
                    SkyGlass is a consumer entertainment and lifestyle product. It is <strong className="text-ifr">NOT</strong> intended
                    to be used for flight planning, pre-flight briefings, or any aviation decision-making.
                    Always use official sources (1800wxbrief.com, ForeFlight, etc.) and follow FAA regulations
                    for proper flight planning. Weather data displayed on SkyGlass may be delayed, incomplete,
                    or inaccurate.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Product Description</h2>
            <p className="text-muted leading-relaxed">
              SkyGlass is a smart mirror that displays aviation weather information, calendar data,
              and other information for entertainment and convenience purposes. The product includes:
            </p>
            <ul className="list-disc list-inside text-muted space-y-2 ml-4">
              <li>Hardware kit (mirror, frame, Raspberry Pi, camera)</li>
              <li>SkyGlass software</li>
              <li>Companion mobile app</li>
              <li>Web-based configuration interface</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Waitlist & Pre-Orders</h2>
            <p className="text-muted leading-relaxed">
              By joining our waitlist, you are expressing interest in SkyGlass. This does not
              constitute a purchase or guarantee availability. When pre-orders open:
            </p>
            <ul className="list-disc list-inside text-muted space-y-2 ml-4">
              <li>Waitlist members will be notified in order of signup</li>
              <li>Pricing and specifications may change before final release</li>
              <li>Pre-orders are refundable until the product ships</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Software License</h2>
            <p className="text-muted leading-relaxed">
              The SkyGlass software is licensed, not sold. Your purchase grants you a non-exclusive,
              non-transferable license to use the software on one SkyGlass device. You may not:
            </p>
            <ul className="list-disc list-inside text-muted space-y-2 ml-4">
              <li>Redistribute, sublicense, or resell the software</li>
              <li>Reverse engineer or decompile the software</li>
              <li>Remove any copyright or proprietary notices</li>
              <li>Use the software for commercial purposes without written permission</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Warranty</h2>
            <p className="text-muted leading-relaxed">
              Hardware kits include a limited one-year warranty covering defects in materials
              and workmanship under normal use. The warranty does not cover:
            </p>
            <ul className="list-disc list-inside text-muted space-y-2 ml-4">
              <li>Damage from misuse, modification, or improper installation</li>
              <li>Normal wear and tear</li>
              <li>Damage from power surges or environmental factors</li>
              <li>Software issues or third-party integrations</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Limitation of Liability</h2>
            <p className="text-muted leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, SKYGLASS SHALL NOT BE LIABLE FOR ANY INDIRECT,
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO
              LOSS OF PROFITS, DATA, OR USE, ARISING OUT OF OR RELATED TO YOUR USE OF THE PRODUCT.
            </p>
            <p className="text-muted leading-relaxed mt-4">
              IN NO EVENT SHALL OUR TOTAL LIABILITY EXCEED THE AMOUNT YOU PAID FOR THE PRODUCT.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Data Sources</h2>
            <p className="text-muted leading-relaxed">
              Aviation weather data is sourced from the Aviation Weather Center (aviationweather.gov),
              a service of NOAA's National Weather Service. We are not responsible for the accuracy,
              completeness, or timeliness of this data. Data may be delayed up to 5 minutes or more.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Changes to Terms</h2>
            <p className="text-muted leading-relaxed">
              We reserve the right to modify these terms at any time. We will notify users of
              material changes via email or through the product interface. Continued use of the
              product after changes constitutes acceptance of the new terms.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-light">Contact</h2>
            <p className="text-muted leading-relaxed">
              For questions about these terms, please contact us at{' '}
              <a href="mailto:legal@skyglass.dev" className="text-amber hover:underline">
                legal@skyglass.dev
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
            <Link to="/privacy" className="text-muted hover:text-light transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="text-amber">Terms of Service</Link>
            <Link to="/team" className="text-muted hover:text-light transition-colors">About</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
