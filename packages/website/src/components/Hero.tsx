import { useEffect, useState, useRef } from 'react'
import { motion, useScroll, useTransform, AnimatePresence } from 'motion/react'

interface HeroProps {
  onWaitlistClick: () => void
}

export function Hero({ onWaitlistClick }: HeroProps) {
  const [time, setTime] = useState(new Date())
  const [isAwake, setIsAwake] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const mirrorStickyRef = useRef<HTMLDivElement>(null)

  // Scroll tracking for the entire section
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  })

  // For mobile: scroll-linked transformation
  // Start transformation only after mirror is fully in viewport
  // Progress ~0.4 = mirror fully visible, 0.4-0.55 = transformation
  const mobileOpacity = useTransform(scrollYProgress, [0.4, 0.55], [0, 1])
  const mobileReflectionOpacity = useTransform(scrollYProgress, [0.4, 0.55], [1, 0])

  // Detect mobile/touch device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.matchMedia('(max-width: 1024px)').matches || 'ontouchstart' in window)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  }

  const formatZulu = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    })
  }

  // Desktop: hover handlers
  const handleMouseEnter = () => {
    if (!isMobile) setIsAwake(true)
  }

  const handleMouseLeave = () => {
    if (!isMobile) setIsAwake(false)
  }

  // Mirror component (reused in both layouts)
  const MirrorDisplay = ({ showScrollHint = false }: { showScrollHint?: boolean }) => (
    <div className="relative aspect-[3/4] w-full max-w-sm mx-auto">
      {/* Mirror frame */}
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 to-zinc-900 rounded-xl shadow-2xl" />

      {/* Mirror surface */}
      <div className="absolute inset-2 rounded-lg overflow-hidden">
        {/* SLEEPING STATE - Reflective mirror surface */}
        {isMobile ? (
          <motion.div
            className="absolute inset-0 bg-gradient-to-br from-zinc-800 via-zinc-700 to-zinc-900 z-10 pointer-events-none"
            style={{ opacity: mobileReflectionOpacity }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-transparent" />
            <div className="absolute top-0 left-0 right-0 h-1/3 bg-gradient-to-b from-white/10 to-transparent" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-24 h-32 rounded-full bg-zinc-600/30 blur-xl" />
            </div>
            {showScrollHint && (
              <motion.div
                className="absolute inset-0 flex items-center justify-center"
                style={{ opacity: mobileReflectionOpacity }}
              >
                <div className="text-center space-y-3">
                  <motion.div
                    animate={{ y: [0, -5, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="w-12 h-12 mx-auto rounded-full border-2 border-amber/30 flex items-center justify-center"
                  >
                    <svg className="w-5 h-5 text-amber/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                  </motion.div>
                  <p className="font-mono text-xs text-amber/50 uppercase tracking-wider">
                    Scroll to wake
                  </p>
                </div>
              </motion.div>
            )}
          </motion.div>
        ) : (
          <AnimatePresence>
            {!isAwake && (
              <motion.div
                className="absolute inset-0 bg-gradient-to-br from-zinc-800 via-zinc-700 to-zinc-900 z-10"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-transparent" />
                <div className="absolute top-0 left-0 right-0 h-1/3 bg-gradient-to-b from-white/10 to-transparent" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-24 h-32 rounded-full bg-zinc-600/30 blur-xl" />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center space-y-3">
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="w-16 h-16 mx-auto rounded-full border-2 border-amber/30 flex items-center justify-center"
                    >
                      <svg className="w-8 h-8 text-amber/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </motion.div>
                    <p className="font-mono text-xs text-amber/50 uppercase tracking-wider">
                      Hover to approach
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {/* AWAKE STATE - Dashboard */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-br from-panel via-instrument to-void"
          style={isMobile ? { opacity: mobileOpacity } : undefined}
          animate={!isMobile ? { opacity: isAwake ? 1 : 0 } : undefined}
          transition={{ duration: 0.4 }}
        >
          <div className="absolute inset-0 crt-glow" />
          <div className="absolute inset-0 scanlines pointer-events-none" />
          <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-white/5 to-transparent" />

          <div className="relative h-full p-5 flex flex-col">
            {/* Time display */}
            <div className="space-y-1">
              <div className="font-mono text-3xl text-light tracking-wider">
                {formatTime(time)}
              </div>
              <div className="font-mono text-base text-muted">
                {formatZulu(time)} Z
              </div>
              <div className="font-display text-xs text-muted uppercase tracking-wider">
                {time.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
            </div>

            {/* METAR display */}
            <div className="absolute top-5 right-5 text-right space-y-2">
              <div className="flex items-center justify-end gap-2">
                <span className="font-display text-lg font-bold text-light">KJFK</span>
                <span className="px-2 py-0.5 bg-vfr/20 border border-vfr/50 rounded text-vfr font-mono text-xs font-bold">
                  VFR
                </span>
              </div>
              <div className="font-mono text-[10px] text-muted leading-relaxed max-w-36">
                METAR KJFK 131856Z 31012KT
                <br />10SM FEW250 M02/M14
                <br />A3042
              </div>
            </div>

            {/* Schedule */}
            <div className="mt-auto space-y-3">
              <div className="space-y-1">
                <div className="font-display text-[10px] uppercase tracking-widest text-amber">
                  Today's Schedule
                </div>
                <div className="h-px bg-gradient-to-r from-amber/50 to-transparent" />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted">09:00</span>
                  <span className="font-body text-xs text-light">Sim Session - KATL</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted">14:30</span>
                  <span className="font-body text-xs text-light">FO Trip - JFK→LAX</span>
                </div>
              </div>

              {/* Sun times */}
              <div className="flex gap-4 pt-3 border-t border-border">
                <div className="flex items-center gap-2">
                  <svg className="w-3 h-3 text-amber" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="5" />
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                  </svg>
                  <span className="font-mono text-[10px] text-muted">07:16</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-3 h-3 text-amber/60" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                  <span className="font-mono text-[10px] text-muted">17:02</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Presence indicator */}
      {isMobile ? (
        <motion.div
          style={{ opacity: mobileOpacity, scale: mobileOpacity }}
          className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 bg-instrument border border-vfr/30 rounded-full"
        >
          <span className="w-2 h-2 bg-vfr rounded-full animate-pulse" />
          <span className="font-mono text-[10px] text-vfr whitespace-nowrap">
            Welcome back, Captain
          </span>
        </motion.div>
      ) : (
        <div
          className={`absolute -bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-instrument border border-vfr/30 rounded-full pointer-events-none transition-all duration-300 ${
            isAwake ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-90 translate-y-2'
          }`}
        >
          <span className="w-2 h-2 bg-vfr rounded-full animate-pulse" />
          <span className="font-mono text-xs text-vfr">Welcome back, Captain</span>
        </div>
      )}
    </div>
  )

  // MOBILE LAYOUT
  if (isMobile) {
    return (
      <section ref={sectionRef} className="relative">
        {/* Background effects - spans entire section */}
        <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-30" />
        <div className="ambient-glow top-1/4 -left-48" />
        <div className="ambient-glow bottom-1/4 -right-48" />

        {/* Scan line animation */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute w-full h-px bg-gradient-to-r from-transparent via-amber/30 to-transparent animate-scan-line" />
        </div>

        {/* Hero text section - scrolls normally */}
        <div className="relative z-10 min-h-screen flex flex-col justify-center px-6 py-20">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="space-y-6"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-vfr/10 border border-vfr/30 rounded-full">
              <span className="w-2 h-2 bg-vfr rounded-full animate-pulse" />
              <span className="font-mono text-sm text-vfr">Pre-orders opening soon</span>
            </div>

            <h1 className="font-display text-5xl font-bold leading-tight">
              <span className="text-light">Bring the</span>
              <br />
              <span className="text-light">flight deck</span>
              <br />
              <span className="text-gradient-amber">home.</span>
            </h1>

            <p className="text-base font-medium text-light/80 max-w-md">
              It's a mirror. Until you walk up—then it displays live METAR, TFRs, and your flight schedule.
            </p>

            <p className="text-base text-muted max-w-md leading-relaxed">
              SkyGlass looks like an ordinary mirror on your wall. When you approach, it wakes and shows
              your aviation briefing. Step away, and it's just a mirror again.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 pt-2">
              <button onClick={onWaitlistClick} className="btn-primary">
                Join the Waitlist
              </button>
              <a href="#features" className="btn-secondary text-center">
                Learn More
              </a>
            </div>

            <div className="flex flex-col gap-3 pt-4 text-sm">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-amber" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span className="text-muted">On-device face recognition</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-amber" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span className="text-muted">Data never leaves your home</span>
              </div>
            </div>
          </motion.div>

          {/* Scroll indicator at bottom of hero text */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2"
          >
            <motion.div
              animate={{ y: [0, 10, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="flex flex-col items-center gap-2 text-muted"
            >
              <span className="font-mono text-xs uppercase tracking-widest">Scroll</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </motion.div>
          </motion.div>
        </div>

        {/* Sticky mirror section */}
        <div ref={mirrorStickyRef} className="relative h-[150vh]">
          {/* Sticky container - mirror stays in center while scrolling through this section */}
          <div className="sticky top-0 h-screen flex items-center justify-center px-6 py-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: "-20%" }}
              transition={{ duration: 0.8 }}
              className="w-full"
            >
              {/* Glow effect */}
              <motion.div
                className="absolute inset-0 bg-radial-glow scale-150 pointer-events-none"
                style={{ opacity: mobileOpacity }}
              />
              <MirrorDisplay showScrollHint />
            </motion.div>
          </div>
        </div>
      </section>
    )
  }

  // DESKTOP LAYOUT
  return (
    <section ref={sectionRef} className="relative min-h-screen flex items-center overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-30" />
      <div className="ambient-glow top-1/4 -left-48" />
      <div className="ambient-glow bottom-1/4 -right-48" />

      {/* Scan line animation */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute w-full h-px bg-gradient-to-r from-transparent via-amber/30 to-transparent animate-scan-line" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-32 grid lg:grid-cols-2 gap-16 items-center">
        {/* Left: Copy */}
        <div className="space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="space-y-4"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-vfr/10 border border-vfr/30 rounded-full">
              <span className="w-2 h-2 bg-vfr rounded-full animate-pulse" />
              <span className="font-mono text-sm text-vfr">Pre-orders opening soon</span>
            </div>

            <h1 className="font-display text-5xl xl:text-7xl font-bold leading-tight">
              <span className="text-light">Bring the</span>
              <br />
              <span className="text-light">flight deck</span>
              <br />
              <span className="text-gradient-amber">home.</span>
            </h1>
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15 }}
            className="text-lg font-medium text-light/80 max-w-lg"
          >
            It's a mirror. Until you walk up—then it displays live METAR, TFRs, and your flight schedule.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.25 }}
            className="text-lg text-muted max-w-lg leading-relaxed"
          >
            SkyGlass looks like an ordinary mirror on your wall. When you approach, it wakes and shows
            your aviation briefing. Step away, and it's just a mirror again.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.35 }}
            className="flex flex-col sm:flex-row gap-4"
          >
            <button onClick={onWaitlistClick} className="btn-primary">
              Join the Waitlist
            </button>
            <a href="#demo" className="btn-secondary text-center">
              See Demo
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="flex items-center gap-6 pt-4"
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-amber" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="text-sm text-muted">On-device face recognition</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-amber" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="text-sm text-muted">Data never leaves your home</span>
            </div>
          </motion.div>
        </div>

        {/* Right: Interactive Mirror */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.3 }}
          className="relative"
        >
          {/* Glow effect behind mirror - only when awake */}
          <motion.div
            className="absolute inset-0 bg-radial-glow scale-150 pointer-events-none"
            animate={{ opacity: isAwake ? 1 : 0 }}
            transition={{ duration: 0.5 }}
          />

          <div
            className="relative mx-auto cursor-pointer"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <MirrorDisplay />
          </div>

          {/* State label - desktop only */}
          <motion.div
            className="absolute -top-8 left-1/2 -translate-x-1/2 flex items-center gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
          >
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider transition-all duration-300 ${
              !isAwake ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-800/50 text-zinc-600'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${!isAwake ? 'bg-zinc-400' : 'bg-zinc-600'}`} />
              Standby
            </div>
            <svg className="w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider transition-all duration-300 ${
              isAwake ? 'bg-vfr/20 text-vfr' : 'bg-zinc-800/50 text-zinc-600'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${isAwake ? 'bg-vfr animate-pulse' : 'bg-zinc-600'}`} />
              Active
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
