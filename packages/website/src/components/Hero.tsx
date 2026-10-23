import { motion, useReducedMotion } from 'motion/react'
import { canPurchase, isPreorderMode } from '../config/features'
import { formatLocal, formatShortDate, formatZulu, useNow } from './mirrorClock'

function MirrorPortrait() {
  const now = useNow()

  return (
    <div
      role="img"
      aria-label="SkyGlass mirror showing the time, KJFK weather in VFR, today's schedule and sunrise and sunset"
      className="aspect-[3/4] w-[min(400px,100%)] rounded-[18px] border border-white/12 bg-bezel p-3"
    >
      <div
        className="flex h-full w-full flex-col gap-[18px] rounded-lg bg-bg p-5 sm:p-7"
        aria-hidden="true"
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <div className="text-[clamp(44px,13vw,56px)] leading-none font-extralight tracking-[-0.04em]">
              {formatLocal(now)}
            </div>
            <div className="font-mono text-[13px] text-fg-3">
              {formatZulu(now)} · {formatShortDate(now)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="font-mono text-lg">KJFK</div>
            <div className="badge-vfr text-xs">VFR</div>
          </div>
        </div>
        <div className="font-mono text-xs leading-[1.7] text-white/62">
          METAR KJFK 131856Z 31012KT 10SM FEW250 M02/M14 A3042
        </div>
        <div className="h-px bg-line" />
        <div className="flex-1" />
        <div className="flex flex-col gap-2.5">
          <div className="text-[11px] tracking-[0.14em] text-accent uppercase">Today</div>
          <div className="flex gap-3.5 text-[15px]">
            <span className="font-mono text-fg-3">09:00</span>
            <span className="font-light">Sim Session · KATL</span>
          </div>
          <div className="flex gap-3.5 text-[15px]">
            <span className="font-mono text-fg-3">14:30</span>
            <span className="font-light">FO Trip · JFK → LAX</span>
          </div>
        </div>
        <div className="h-px bg-line" />
        <div className="flex justify-between font-mono text-xs text-fg-3">
          <span>SR 07:16</span>
          <span>SS 17:02</span>
        </div>
      </div>
    </div>
  )
}

export function Hero() {
  const reduceMotion = useReducedMotion()
  const ecommerceEnabled = canPurchase()

  const fadeIn = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.5, delay, ease: 'easeOut' as const },
        }

  return (
    <section className="grid grid-cols-[repeat(auto-fit,minmax(min(460px,100%),1fr))] items-center gap-16 pt-12 pb-28 md:pt-[72px]">
      <motion.div className="flex flex-col gap-7" {...fadeIn(0)}>
        <div className="flex items-center gap-2.5 font-mono text-xs tracking-[0.12em] text-white/62 uppercase">
          <span className="h-[7px] w-[7px] rounded-full bg-accent" aria-hidden="true" />
          {isPreorderMode()
            ? 'Pre-orders open'
            : ecommerceEnabled
              ? 'Now available'
              : 'Pre-orders opening soon'}
        </div>
        <h1 className="display-1 m-0">Bring the flight deck home.</h1>
        <p className="m-0 max-w-[520px] text-[19px] leading-[1.55] text-pretty text-fg-2">
          A mirror that wakes when you walk up with METAR, TAF, TFRs, NOTAMs and your schedule —
          then goes back to being a mirror when you leave.
        </p>
        <div className="flex flex-wrap items-center gap-3.5">
          <a href={ecommerceEnabled ? '#pricing' : '#waitlist'} className="btn btn-primary">
            {ecommerceEnabled ? 'Buy now' : 'Join the waitlist'}
          </a>
          <a href="#how" className="btn btn-secondary px-[22px]">
            See how it works
          </a>
        </div>
      </motion.div>
      <motion.div className="flex justify-center" {...fadeIn(0.1)}>
        <MirrorPortrait />
      </motion.div>
    </section>
  )
}
