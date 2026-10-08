import { motion } from 'motion/react'
import { useInView } from 'motion/react'
import { useRef, useState, useEffect } from 'react'

// Simulated METAR data
const airportData: Record<string, {
  rules: 'VFR' | 'MVFR' | 'IFR' | 'LIFR'
  wind: string
  visibility: string
  temp: string
  altimeter: string
}> = {
  KJFK: {
    rules: 'VFR',
    wind: '310° @ 12kt',
    visibility: '10 SM',
    temp: '-2°C',
    altimeter: '30.42',
  },
  KLAX: {
    rules: 'MVFR',
    wind: '250° @ 8kt',
    visibility: '6 SM',
    temp: '18°C',
    altimeter: '29.92',
  },
}

// Layout configurations
const layouts = [
  { id: 'classic', name: 'Classic', icon: '◈' },
  { id: 'weather', name: 'Weather', icon: '☀️' },
  { id: 'schedule', name: 'Schedule', icon: '📅' },
  { id: 'dashboard', name: 'Dashboard', icon: '▦' },
]

export function InteractiveDemo() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape')
  const [layout, setLayout] = useState('classic')
  const [time, setTime] = useState(new Date())

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

  const data = airportData['KJFK']

  // Render different layouts
  const renderLayout = () => {
    const isPortrait = orientation === 'portrait'

    switch (layout) {
      case 'classic':
        return (
          <div className="h-full p-5 flex flex-col relative">
            {/* Time display */}
            <div className="space-y-1">
              <div className={`font-mono text-light tracking-wider ${isPortrait ? 'text-2xl' : 'text-3xl'}`}>
                {formatTime(time)}
              </div>
              <div className="font-mono text-sm text-muted">
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

            {/* METAR display - top right */}
            <div className={`absolute top-5 right-5 text-right space-y-2 ${isPortrait ? 'max-w-[45%]' : ''}`}>
              <div className="flex items-center justify-end gap-2">
                <span className={`font-display font-bold text-light ${isPortrait ? 'text-base' : 'text-lg'}`}>KJFK</span>
                <span className="px-2 py-0.5 bg-vfr/20 border border-vfr/50 rounded text-vfr font-mono text-xs font-bold">
                  VFR
                </span>
              </div>
              <div className={`font-mono text-muted leading-relaxed ${isPortrait ? 'text-[8px]' : 'text-[10px]'}`}>
                METAR KJFK 131856Z 31012KT
                <br />10SM FEW250 M02/M14
                <br />A3042
              </div>
            </div>

            {/* Schedule - bottom */}
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
                  <span className="font-display text-xs text-light">Sim Session - KATL</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted">14:30</span>
                  <span className="font-display text-xs text-light">FO Trip - JFK→LAX</span>
                </div>
                {!isPortrait && (
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-muted">19:00</span>
                    <span className="font-display text-xs text-light">Layover - Los Angeles</span>
                  </div>
                )}
              </div>

              {/* Sun times */}
              <div className="flex gap-4 pt-3 border-t border-border">
                <div className="flex items-center gap-2">
                  <svg className="w-3 h-3 text-amber" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="5" />
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  <span className="font-mono text-[10px] text-muted">07:16</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-3 h-3 text-amber/60" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                  </svg>
                  <span className="font-mono text-[10px] text-muted">17:02</span>
                </div>
              </div>
            </div>
          </div>
        )

      case 'weather':
        return (
          <div className="h-full p-5 flex flex-col">
            {/* Top bar with time and status */}
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className={`font-mono text-light tracking-wider ${isPortrait ? 'text-3xl' : 'text-4xl'}`}>
                  {formatTime(time)}
                </div>
                <div className="font-mono text-[10px] text-muted uppercase tracking-widest mt-1">
                  {time.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-vfr rounded-full animate-pulse" />
                <span className="font-mono text-[10px] text-vfr uppercase">Live</span>
              </div>
            </div>

            {/* Main METAR display */}
            <div className="flex-1 flex flex-col justify-center">
              {/* Airport header */}
              <div className="flex items-center gap-3 mb-4">
                <span className={`font-display font-bold text-light ${isPortrait ? 'text-2xl' : 'text-3xl'}`}>KJFK</span>
                <span className="px-3 py-1 bg-vfr/20 border border-vfr/50 rounded text-vfr font-mono text-sm font-bold">
                  VFR
                </span>
              </div>

              {/* Weather grid */}
              <div className={`grid gap-4 ${isPortrait ? 'grid-cols-2' : 'grid-cols-4'}`}>
                <div className="bg-panel/40 rounded-lg p-3 border border-border/50">
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-3 h-3 text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2v20M2 12h20" />
                      <path d="M12 2l4 4M12 2l-4 4" />
                    </svg>
                    <span className="font-mono text-[10px] text-amber uppercase">Wind</span>
                  </div>
                  <div className="font-display text-light font-semibold">{data.wind}</div>
                </div>
                <div className="bg-panel/40 rounded-lg p-3 border border-border/50">
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-3 h-3 text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                    <span className="font-mono text-[10px] text-amber uppercase">Vis</span>
                  </div>
                  <div className="font-display text-light font-semibold">{data.visibility}</div>
                </div>
                <div className="bg-panel/40 rounded-lg p-3 border border-border/50">
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-3 h-3 text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 9v4M12 17h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
                    </svg>
                    <span className="font-mono text-[10px] text-amber uppercase">Temp</span>
                  </div>
                  <div className="font-display text-light font-semibold">{data.temp}</div>
                </div>
                <div className="bg-panel/40 rounded-lg p-3 border border-border/50">
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-3 h-3 text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                    </svg>
                    <span className="font-mono text-[10px] text-amber uppercase">Alt</span>
                  </div>
                  <div className="font-display text-light font-semibold">{data.altimeter}</div>
                </div>
              </div>

              {/* Raw METAR */}
              <div className="mt-4 p-2 bg-void/50 rounded border border-border/30">
                <div className="font-mono text-[9px] text-muted/70 leading-relaxed">
                  METAR KJFK 161853Z 31012KT 10SM FEW250 M02/M14 A3042
                </div>
              </div>
            </div>

            {/* Bottom status */}
            <div className="mt-auto pt-3 border-t border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <svg className="w-3 h-3 text-amber" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="5" />
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  <span className="font-mono text-[10px] text-muted">07:16</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <svg className="w-3 h-3 text-amber/60" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                  </svg>
                  <span className="font-mono text-[10px] text-muted">17:02</span>
                </div>
              </div>
              <div className="font-mono text-[10px] text-muted/50">Updated 2m ago</div>
            </div>
          </div>
        )

      case 'schedule':
        return (
          <div className={`h-full flex ${isPortrait ? 'flex-col' : ''}`}>
            {/* Schedule panel */}
            <div className={`${isPortrait ? 'flex-1 p-4' : 'flex-[3] p-5 border-r border-border/50'}`}>
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-mono text-[10px] text-amber uppercase tracking-widest">Today's Schedule</div>
                  <div className="font-display text-lg text-light font-semibold mt-1">
                    {time.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                  </div>
                </div>
                <div className={`font-mono text-light ${isPortrait ? 'text-xl' : 'text-2xl'}`}>
                  {formatTime(time)}
                </div>
              </div>

              {/* Schedule items */}
              <div className="space-y-2">
                {[
                  { time: '06:30', event: 'Pre-flight briefing', type: 'briefing', active: true },
                  { time: '08:00', event: 'KJFK → KORD', type: 'flight', active: false },
                  { time: '12:30', event: 'Layover - Chicago', type: 'layover', active: false },
                  { time: '15:00', event: 'KORD → KLAX', type: 'flight', active: false },
                ].slice(0, isPortrait ? 3 : 4).map((item, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                      item.active
                        ? 'bg-amber/10 border-amber/30'
                        : 'bg-panel/30 border-border/50'
                    }`}
                  >
                    <div className={`w-1 h-8 rounded-full ${
                      item.type === 'flight' ? 'bg-vfr' :
                      item.type === 'briefing' ? 'bg-amber' : 'bg-muted/30'
                    }`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-sm ${item.active ? 'text-amber' : 'text-muted'}`}>
                          {item.time}
                        </span>
                        {item.active && (
                          <span className="px-1.5 py-0.5 bg-amber/20 rounded text-amber font-mono text-[8px] uppercase">
                            Now
                          </span>
                        )}
                      </div>
                      <div className="font-display text-sm text-light">{item.event}</div>
                    </div>
                    {item.type === 'flight' && (
                      <svg className="w-4 h-4 text-muted" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
                      </svg>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Weather sidebar */}
            <div className={`${isPortrait ? 'p-4 border-t border-border/50' : 'flex-[2] p-5'} bg-panel/20`}>
              <div className="font-mono text-[10px] text-amber uppercase tracking-widest mb-3">Departure WX</div>
              <div className="flex items-center gap-2 mb-3">
                <span className="font-display text-xl font-bold text-light">KJFK</span>
                <span className="px-2 py-0.5 bg-vfr/20 border border-vfr/50 rounded text-vfr font-mono text-xs font-bold">
                  VFR
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Wind</span>
                  <span className="font-mono text-light">{data.wind}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Visibility</span>
                  <span className="font-mono text-light">{data.visibility}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Ceiling</span>
                  <span className="font-mono text-light">FEW250</span>
                </div>
              </div>
              {!isPortrait && (
                <div className="mt-4 pt-4 border-t border-border/30">
                  <div className="font-mono text-[10px] text-muted/70 uppercase mb-2">Destination</div>
                  <div className="flex items-center gap-2">
                    <span className="font-display font-bold text-light">KORD</span>
                    <span className="px-2 py-0.5 bg-mvfr/20 border border-mvfr/50 rounded text-mvfr font-mono text-xs font-bold">
                      MVFR
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )

      case 'dashboard':
        return (
          <div className={`h-full p-3 ${isPortrait ? 'flex flex-col gap-2' : 'grid grid-cols-3 grid-rows-2 gap-2'}`}>
            {/* Time & Weather - larger widget */}
            <div className={`bg-gradient-to-br from-panel/50 to-panel/20 rounded-xl p-4 border border-border/50 ${isPortrait ? '' : 'col-span-2 row-span-1'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className={`font-mono text-light tracking-wider ${isPortrait ? 'text-2xl' : 'text-3xl'}`}>
                    {formatTime(time)}
                  </div>
                  <div className="font-mono text-[10px] text-muted mt-1">
                    {time.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-display font-bold text-light">KJFK</span>
                  <span className="px-2 py-0.5 bg-vfr/20 border border-vfr/50 rounded text-vfr font-mono text-[10px] font-bold">
                    VFR
                  </span>
                </div>
              </div>
            </div>

            {/* Stock ticker mini */}
            <div className="bg-gradient-to-br from-vfr/5 to-transparent rounded-xl p-3 border border-border/50">
              <div className="font-mono text-[9px] text-muted uppercase tracking-wider mb-2">Markets</div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-xs text-light">AAPL</span>
                  <span className="font-mono text-[10px] text-vfr">+1.2%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-mono text-xs text-light">BA</span>
                  <span className="font-mono text-[10px] text-ifr">-0.8%</span>
                </div>
              </div>
            </div>

            {/* Next flight widget */}
            <div className="bg-gradient-to-br from-amber/10 to-transparent rounded-xl p-3 border border-amber/20">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[9px] text-amber uppercase tracking-wider">Next Flight</span>
                <svg className="w-3 h-3 text-amber/50" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
                </svg>
              </div>
              <div className="font-display text-sm text-light font-semibold">KJFK → KORD</div>
              <div className="font-mono text-[10px] text-muted">08:00L • 2h 45m</div>
            </div>

            {/* News widget */}
            <div className={`bg-gradient-to-br from-panel/30 to-transparent rounded-xl p-3 border border-border/50 ${isPortrait ? '' : 'col-span-1'}`}>
              <div className="font-mono text-[9px] text-amber uppercase tracking-wider mb-2">News</div>
              <div className="space-y-1.5">
                <div className="flex items-start gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-amber mt-1 flex-shrink-0" />
                  <span className="font-mono text-[9px] text-muted leading-tight line-clamp-2">FAA updates pilot rest requirements</span>
                </div>
              </div>
            </div>

            {/* Sun times widget */}
            <div className="bg-gradient-to-br from-panel/50 to-panel/20 rounded-xl p-3 border border-border/50">
              <div className="font-mono text-[9px] text-amber uppercase tracking-wider mb-2">Sun</div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1">
                  <svg className="w-2.5 h-2.5 text-amber" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="4" />
                  </svg>
                  <span className="font-mono text-light">06:48</span>
                </div>
                <div className="flex items-center gap-1">
                  <svg className="w-2.5 h-2.5 text-amber/50" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                  </svg>
                  <span className="font-mono text-light">17:23</span>
                </div>
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <section id="demo" className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-void via-panel to-void" />
      <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-10" />

      <div ref={ref} className="relative z-10 max-w-6xl mx-auto px-6">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-12"
        >
          <h2 className="font-display text-4xl md:text-5xl font-bold text-light mb-4">
            Fits your space
          </h2>
          <p className="text-lg text-muted max-w-2xl mx-auto">
            Horizontal above the dresser or vertical in the hallway. Four layout presets,
            or build your own in the app.
          </p>
        </motion.div>

        {/* Controls */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="flex flex-col md:flex-row gap-6 justify-center items-center mb-12"
        >
          {/* Orientation toggle */}
          <div className="flex items-center gap-2 p-1 bg-panel rounded-lg border border-border">
            <button
              onClick={() => setOrientation('landscape')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-display text-sm transition-all ${
                orientation === 'landscape'
                  ? 'bg-amber/20 text-amber'
                  : 'text-muted hover:text-light'
              }`}
            >
              <svg viewBox="0 0 24 16" className="w-6 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="1" width="22" height="14" rx="2" />
              </svg>
              Horizontal
            </button>
            <button
              onClick={() => setOrientation('portrait')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-display text-sm transition-all ${
                orientation === 'portrait'
                  ? 'bg-amber/20 text-amber'
                  : 'text-muted hover:text-light'
              }`}
            >
              <svg viewBox="0 0 16 24" className="w-4 h-6" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="1" width="14" height="22" rx="2" />
              </svg>
              Vertical
            </button>
          </div>

          {/* Layout selector */}
          <div className="flex items-center gap-1 p-1 bg-panel rounded-lg border border-border">
            {layouts.map((l) => (
              <button
                key={l.id}
                onClick={() => setLayout(l.id)}
                className={`px-4 py-2 rounded-md font-display text-sm transition-all ${
                  layout === l.id
                    ? 'bg-amber/20 text-amber'
                    : 'text-muted hover:text-light'
                }`}
              >
                <span className="hidden sm:inline">{l.name}</span>
                <span className="sm:hidden">{l.icon}</span>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Mirror display */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={isInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="flex justify-center"
        >
          <motion.div
            layout
            transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
            className={`relative bg-gradient-to-b from-zinc-800 to-zinc-900 rounded-xl p-2 shadow-2xl ${
              orientation === 'landscape'
                ? 'w-full max-w-2xl aspect-[16/10]'
                : 'w-full max-w-xs aspect-[9/16]'
            }`}
          >
            {/* Screen */}
            <div className="relative h-full bg-void rounded-lg overflow-hidden">
              {/* Scanlines */}
              <div className="absolute inset-0 scanlines pointer-events-none z-20" />
              {/* CRT glow */}
              <div className="absolute inset-0 crt-glow" />

              {/* Content */}
              <motion.div
                key={`${layout}-${orientation}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="relative h-full"
              >
                {renderLayout()}
              </motion.div>
            </div>

            {/* Status LED */}
            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2">
              <div className="w-2 h-2 rounded-full bg-vfr shadow-[0_0_10px_rgba(0,200,83,0.5)]" />
            </div>
          </motion.div>
        </motion.div>

        {/* Mounting suggestions */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="mt-12 text-center"
        >
          <p className="text-muted text-sm">
            {orientation === 'landscape'
              ? 'Dresser, entryway, or above the desk'
              : 'Hallway, closet, or any narrow wall'}
          </p>
        </motion.div>

      </div>
    </section>
  )
}
