import { motion } from 'motion/react'
import { useInView } from 'motion/react'
import { useRef, useState } from 'react'

const configOptions = [
  {
    id: 'widgets',
    label: 'Widgets',
    description: 'Choose which modules appear and where',
    options: ['Weather', 'Schedule', 'TFRs', 'NOTAMs', 'Astro', 'Clock'],
  },
  {
    id: 'airports',
    label: 'Airports',
    description: 'Track multiple airports at once',
    options: ['KJFK', 'KLAX', 'KORD', 'KSEA'],
  },
  {
    id: 'theme',
    label: 'Theme',
    description: 'Light, dark, or match sunrise/sunset',
    options: ['Dark', 'Light', 'Auto'],
  },
  {
    id: 'calendar',
    label: 'Calendars',
    description: 'Connect multiple calendar sources',
    options: ['Google', 'iCloud', 'Outlook', 'Airline XLSX'],
  },
]

export function Customization() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  const [activeTab, setActiveTab] = useState('layout')

  return (
    <section id="customize" className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-panel via-void to-panel" />
      <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-10" />

      <div ref={ref} className="relative z-10 max-w-6xl mx-auto px-6">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-mvfr/10 border border-mvfr/30 rounded-full mb-6">
            <span className="font-mono text-sm text-mvfr uppercase tracking-wider">
              Companion App
            </span>
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-light mb-6">
            Configure from <span className="text-gradient-amber">your phone.</span>
          </h2>
          <p className="text-lg text-muted max-w-2xl mx-auto">
            The SkyGlass app for iOS and Android handles setup, widget arrangement,
            airport selection, and calendar connections. Change anything, anytime.
          </p>
        </motion.div>

        {/* App showcase */}
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left: Phone mockup with app */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative"
          >
            {/* Glow behind phone */}
            <div className="absolute inset-0 bg-radial-glow scale-125 opacity-50" />

            {/* Phone frame */}
            <div className="relative max-w-xs mx-auto">
              <div className="bg-gradient-to-b from-zinc-700 to-zinc-900 rounded-[3rem] p-2 shadow-2xl">
                {/* Screen */}
                <div className="bg-void rounded-[2.5rem] overflow-hidden aspect-[9/19]">
                  {/* Status bar */}
                  <div className="h-12 bg-panel flex items-center justify-between px-6">
                    <span className="font-mono text-xs text-muted">9:41</span>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-2 border border-muted rounded-sm">
                        <div className="w-3/4 h-full bg-vfr rounded-sm" />
                      </div>
                    </div>
                  </div>

                  {/* App header */}
                  <div className="px-5 py-4 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-amber/20 rounded-xl flex items-center justify-center">
                        <svg className="w-6 h-6 text-amber" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <rect x="3" y="2" width="18" height="20" rx="2" strokeWidth="1.5" />
                        </svg>
                      </div>
                      <div>
                        <div className="font-display font-bold text-light">SkyGlass</div>
                        <div className="font-mono text-xs text-vfr flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-vfr rounded-full" />
                          Connected
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* App tabs */}
                  <div className="flex border-b border-border">
                    {['layout', 'data', 'style'].map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex-1 py-3 font-mono text-xs uppercase tracking-wider transition-colors ${
                          activeTab === tab
                            ? 'text-amber border-b-2 border-amber'
                            : 'text-muted hover:text-light'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  {/* App content */}
                  <div className="p-4 space-y-3">
                    {configOptions.map((option, i) => (
                      <motion.div
                        key={option.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={isInView ? { opacity: 1, y: 0 } : {}}
                        transition={{ delay: 0.4 + i * 0.1 }}
                        className="bg-panel rounded-xl p-3 border border-border"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="font-display text-sm font-semibold text-light">
                              {option.label}
                            </div>
                            <div className="font-mono text-xs text-muted">
                              {option.description}
                            </div>
                          </div>
                          <svg className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {option.options.slice(0, 3).map((opt, j) => (
                            <span
                              key={opt}
                              className={`px-2 py-0.5 rounded text-xs font-mono ${
                                j === 0
                                  ? 'bg-amber/20 text-amber border border-amber/30'
                                  : 'bg-instrument text-muted border border-border'
                              }`}
                            >
                              {opt}
                            </span>
                          ))}
                          {option.options.length > 3 && (
                            <span className="px-2 py-0.5 text-xs font-mono text-muted">
                              +{option.options.length - 3}
                            </span>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Notch */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-6 bg-black rounded-full" />
            </div>
          </motion.div>

          {/* Right: Feature list */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="space-y-8"
          >
            <div className="space-y-6">
              {[
                {
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                    </svg>
                  ),
                  title: 'Drag & Drop Widgets',
                  description: 'Move, resize, or hide anything. Your layout, your call.',
                },
                {
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                    </svg>
                  ),
                  title: 'Multiple Airports',
                  description: 'Track home base, destination, and alternates at once.',
                },
                {
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  ),
                  title: 'Calendar Sync',
                  description: 'Google, iCloud, Outlook—or forward your airline XLSX.',
                },
                {
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                    </svg>
                  ),
                  title: 'Dark & Light Modes',
                  description: 'Auto-dim by time or ambient light. Tweak colors and fonts.',
                },
              ].map((feature, i) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={isInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: 0.5 + i * 0.1 }}
                  className="flex gap-4"
                >
                  <div className="w-12 h-12 rounded-lg bg-amber/10 border border-amber/30 flex items-center justify-center text-amber flex-shrink-0">
                    {feature.icon}
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-semibold text-light mb-1">
                      {feature.title}
                    </h3>
                    <p className="text-muted text-sm leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* App note */}
            <div className="instrument-card p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-mvfr/10 border border-mvfr/30 flex items-center justify-center text-mvfr flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-display font-semibold text-light mb-1">
                    iOS, Android, or Browser
                  </h4>
                  <p className="text-sm text-muted">
                    Native apps for quick setup. Or use any browser at <span className="font-mono text-amber">skyglass.local</span>
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
