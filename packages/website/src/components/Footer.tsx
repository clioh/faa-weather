import { motion } from 'motion/react'
import { Link } from 'react-router-dom'

interface FooterProps {
  onWaitlistClick: () => void
}

export function Footer({ onWaitlistClick }: FooterProps) {
  const specs = [
    { label: 'Display', value: '24" IPS 1080p' },
    { label: 'Processor', value: 'Raspberry Pi 5' },
    { label: 'Camera', value: 'Pi Camera Module 3' },
    { label: 'Detection', value: '<500ms wake time' },
    { label: 'Data', value: 'On-device only' },
    { label: 'Power', value: '15W typical' },
  ]

  return (
    <footer className="relative py-20 border-t border-border">
      {/* Background */}
      <div className="absolute inset-0 bg-void" />

      <div className="relative z-10 max-w-6xl mx-auto px-6">
        {/* CTA Banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="instrument-card p-8 md:p-12 mb-16 text-center"
        >
          <h3 className="font-display text-3xl md:text-4xl font-bold text-light mb-4">
            Get briefed before you get dressed.
          </h3>
          <p className="text-lg text-muted mb-8 max-w-xl mx-auto">
            Join the waitlist. We'll let you know when kits ship.
          </p>
          <button onClick={onWaitlistClick} className="btn-primary">
            Join the Waitlist
          </button>
        </motion.div>

        {/* Specs strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-16">
          {specs.map((spec) => (
            <div key={spec.label} className="p-4 bg-panel rounded-lg border border-border">
              <div className="font-mono text-xs text-amber uppercase tracking-wider mb-1">
                {spec.label}
              </div>
              <div className="font-display text-lg text-light">
                {spec.value}
              </div>
            </div>
          ))}
        </div>

        {/* Main footer content */}
        <div className="grid md:grid-cols-4 gap-12 mb-16">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-instrument border border-amber/30 rounded-lg flex items-center justify-center">
                <svg
                  viewBox="0 0 24 24"
                  className="w-6 h-6 text-amber"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <rect x="3" y="2" width="18" height="20" rx="2" />
                  <circle cx="18" cy="5" r="1.5" fill="currentColor" />
                </svg>
              </div>
              <span className="font-display text-xl font-bold">
                <span className="text-light">Sky</span>
                <span className="text-amber">Glass</span>
              </span>
            </div>
            <p className="text-muted leading-relaxed mb-4">
              A smart mirror that shows pilots what they need to know—weather,
              schedule, airspace—while they get ready.
            </p>
            <p className="text-sm text-muted/70">
              For awareness, not flight planning.
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="font-display text-sm uppercase tracking-wider text-amber mb-4">
              Product
            </h4>
            <ul className="space-y-3">
              <li>
                <a href="#features" className="text-muted hover:text-light transition-colors">
                  Features
                </a>
              </li>
              <li>
                <a href="#how-it-works" className="text-muted hover:text-light transition-colors">
                  How It Works
                </a>
              </li>
              <li>
                <a href="#pricing" className="text-muted hover:text-light transition-colors">
                  Pricing
                </a>
              </li>
              <li>
                <a href="#demo" className="text-muted hover:text-light transition-colors">
                  Demo
                </a>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="font-display text-sm uppercase tracking-wider text-amber mb-4">
              Company
            </h4>
            <ul className="space-y-3">
              <li>
                <Link to="/team" className="text-muted hover:text-light transition-colors">
                  About
                </Link>
              </li>
              <li>
                <Link to="/license" className="text-muted hover:text-light transition-colors">
                  Manage License
                </Link>
              </li>
              <li>
                <a
                  href="mailto:hello@skyglass.dev"
                  className="text-muted hover:text-light transition-colors"
                >
                  Contact
                </a>
              </li>
              <li>
                <a
                  href="https://twitter.com/skyglassdev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted hover:text-light transition-colors"
                >
                  Twitter / X
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-sm text-muted">
            © {new Date().getFullYear()} SkyGlass. All rights reserved.
          </div>
          <div className="flex items-center gap-6 text-sm text-muted">
            <Link to="/privacy" className="hover:text-light transition-colors">
              Privacy Policy
            </Link>
            <Link to="/terms" className="hover:text-light transition-colors">
              Terms of Service
            </Link>
            <Link to="/license" className="hover:text-light transition-colors">
              License
            </Link>
            <Link to="/team" className="hover:text-light transition-colors">
              About
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
