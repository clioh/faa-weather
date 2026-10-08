import { motion } from 'motion/react'
import { useInView } from 'motion/react'
import { useRef } from 'react'

const steps = [
  {
    number: '01',
    title: 'Walk up',
    description: 'The camera detects you and wakes the display in under 500ms. Face recognition loads your personalized dashboard.',
    visual: (
      <div className="relative w-full aspect-video bg-instrument rounded-lg overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          {/* Simplified presence detection visual */}
          <div className="relative">
            <div className="w-24 h-24 rounded-full border-2 border-amber/30 flex items-center justify-center">
              <div className="w-16 h-16 rounded-full border-2 border-amber/50 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-amber/20 border border-amber animate-pulse" />
              </div>
            </div>
            {/* Radar sweep */}
            <div className="absolute inset-0 radar-container">
              <div className="radar-sweep" />
            </div>
          </div>
        </div>
        <div className="absolute bottom-4 left-4 font-mono text-xs text-vfr flex items-center gap-2">
          <span className="w-2 h-2 bg-vfr rounded-full animate-pulse" />
          FACE DETECTED
        </div>
      </div>
    ),
  },
  {
    number: '02',
    title: 'Get briefed',
    description: 'Weather, TFRs, NOTAMs, and your schedule—all updated and waiting. No apps to open, no buttons to press.',
    visual: (
      <div className="relative w-full aspect-video bg-instrument rounded-lg overflow-hidden p-4">
        <div className="grid grid-cols-2 gap-3 h-full">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-display text-lg font-bold text-light">KJFK</span>
              <span className="px-1.5 py-0.5 bg-vfr/20 border border-vfr/50 rounded text-vfr font-mono text-xs">VFR</span>
            </div>
            <div className="font-mono text-xs text-muted">31012KT 10SM FEW250</div>
          </div>
          <div className="space-y-2">
            <div className="font-display text-xs uppercase text-amber tracking-wider">Schedule</div>
            <div className="space-y-1">
              <div className="font-mono text-xs text-muted">09:00 <span className="text-light">Sim Session</span></div>
              <div className="font-mono text-xs text-muted">14:30 <span className="text-light">JFK→LAX</span></div>
            </div>
          </div>
        </div>
        <div className="absolute bottom-2 right-2 font-mono text-xs text-amber">
          ↻ LIVE
        </div>
      </div>
    ),
  },
  {
    number: '03',
    title: 'Walk away',
    description: 'Leave, and it goes back to sleep. It\'s just a mirror again until you need it.',
    visual: (
      <div className="relative w-full aspect-video bg-void rounded-lg overflow-hidden border border-border">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center space-y-2 opacity-30">
            <svg className="w-12 h-12 mx-auto text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
            <span className="font-mono text-xs text-muted">STANDBY</span>
          </div>
        </div>
      </div>
    ),
  },
]

export function HowItWorks() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section id="how-it-works" className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-void" />

      <div ref={ref} className="relative z-10 max-w-6xl mx-auto px-6">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-20"
        >
          <h2 className="font-display text-4xl md:text-5xl font-bold text-light mb-6">
            Zero <span className="text-gradient-amber">friction.</span>
          </h2>
          <p className="text-lg text-muted max-w-xl mx-auto">
            No phone to unlock. No app to open. Just walk up and glance.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="space-y-24">
          {steps.map((step, index) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 50 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: index * 0.2 }}
              className={`grid md:grid-cols-2 gap-12 items-center ${
                index % 2 === 1 ? 'md:flex-row-reverse' : ''
              }`}
            >
              <div className={index % 2 === 1 ? 'md:order-2' : ''}>
                <div className="space-y-4">
                  <span className="font-mono text-6xl font-bold text-amber/20">
                    {step.number}
                  </span>
                  <h3 className="font-display text-3xl font-bold text-light -mt-8 relative">
                    {step.title}
                  </h3>
                  <p className="text-lg text-muted leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </div>
              <div className={`instrument-card p-4 ${index % 2 === 1 ? 'md:order-1' : ''}`}>
                {step.visual}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Privacy callout */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.8 }}
          className="mt-24 instrument-card p-8 md:p-12"
        >
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-vfr/10 border border-vfr/30 flex items-center justify-center flex-shrink-0">
              <svg className="w-8 h-8 text-vfr" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-display text-2xl font-bold text-light mb-2">
                Your data stays home
              </h3>
              <p className="text-muted leading-relaxed">
                Face recognition runs entirely on-device. Your biometric data never leaves
                the Raspberry Pi—not to us, not to anyone. Weather data comes from public
                aviation APIs. That's it.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="px-4 py-2 bg-instrument border border-border rounded-lg">
                <div className="font-mono text-xs text-muted uppercase">Data Location</div>
                <div className="font-display text-lg text-vfr">On-Device</div>
              </div>
              <div className="px-4 py-2 bg-instrument border border-border rounded-lg">
                <div className="font-mono text-xs text-muted uppercase">Cloud Upload</div>
                <div className="font-display text-lg text-ifr">Never</div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
