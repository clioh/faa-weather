import { motion } from 'motion/react'
import { useInView } from 'motion/react'
import { useRef } from 'react'

const features = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
        <path d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
      </svg>
    ),
    title: 'Live Aviation Weather',
    description: 'Real-time METAR and TAF with VFR/MVFR/IFR/LIFR color coding. Know if you\'re flying before you finish your coffee.',
    color: 'vfr',
    badge: 'METAR/TAF',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
        <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    title: 'TFRs & NOTAMs',
    description: 'Active restrictions and notices for your airports. Critical airspace info, automatically updated.',
    color: 'ifr',
    badge: 'ALERTS',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
        <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    title: 'Flight Schedule',
    description: 'Syncs with Google Calendar. Airline pilots can import XLSX schedules via email.',
    color: 'mvfr',
    badge: 'SYNC',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
        <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    ),
    title: 'Presence Detection',
    description: 'Wakes when you walk up, sleeps when you leave. On-device face recognition—no cloud, no data leaving home.',
    color: 'amber',
    badge: 'PRIVACY',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
        <circle cx="12" cy="12" r="5" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
    title: 'Sun & Moon',
    description: 'Sunrise, sunset, civil twilight, and moon phase. Plan your night currency at a glance.',
    color: 'amber',
    badge: 'ASTRO',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
        <path d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
      </svg>
    ),
    title: 'Gesture Control',
    description: 'Wave to dismiss or sleep the display. No buttons, no touch, no voice commands.',
    color: 'lifr',
    badge: 'TOUCH-FREE',
  },
]

export function Features() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section id="features" className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-void via-panel to-void" />
      <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-20" />

      <div ref={ref} className="relative z-10 max-w-7xl mx-auto px-6">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-20"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber/10 border border-amber/30 rounded-full mb-6">
            <span className="font-mono text-sm text-amber uppercase tracking-wider">
              Built for Pilots
            </span>
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-light mb-6">
            Everything you check,
            <br />
            <span className="text-gradient-amber">before you check it.</span>
          </h2>
          <p className="text-lg text-muted max-w-2xl mx-auto">
            Weather, schedule, restrictions—all on one screen while you get ready.
            A quick glance that might save you a longer look later.
          </p>
        </motion.div>

        {/* Features grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="instrument-card p-8 group hover:border-amber/30 transition-all duration-300"
            >
              {/* Icon */}
              <div
                className={`w-14 h-14 rounded-lg bg-${feature.color}/10 border border-${feature.color}/30 flex items-center justify-center mb-6 text-${feature.color} group-hover:scale-110 transition-transform`}
                style={{
                  backgroundColor: `var(--color-${feature.color}, rgba(255,179,0,0.1))`,
                  borderColor: `var(--color-${feature.color}, rgba(255,179,0,0.3))`,
                }}
              >
                <div className={feature.color === 'amber' ? 'text-amber' : feature.color === 'vfr' ? 'text-vfr' : feature.color === 'mvfr' ? 'text-mvfr' : feature.color === 'ifr' ? 'text-ifr' : 'text-lifr'}>
                  {feature.icon}
                </div>
              </div>

              {/* Badge */}
              <div className="mb-4">
                <span className={`inline-block px-2 py-1 text-xs font-mono uppercase tracking-wider rounded ${
                  feature.color === 'vfr' ? 'badge-vfr' :
                  feature.color === 'mvfr' ? 'badge-mvfr' :
                  feature.color === 'ifr' ? 'badge-ifr' :
                  feature.color === 'lifr' ? 'badge-lifr' :
                  'bg-amber/20 text-amber border border-amber/30'
                }`}>
                  {feature.badge}
                </span>
              </div>

              {/* Content */}
              <h3 className="font-display text-xl font-semibold text-light mb-3">
                {feature.title}
              </h3>
              <p className="text-muted leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
