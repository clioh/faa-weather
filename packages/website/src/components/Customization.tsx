import { formatLocal, formatLongDate, formatZulu, useNow } from './mirrorClock'

const notams = [
  '!JFK 01/032 JFK RWY 13R/31L CLSD 0400-1000',
  '!JFK 01/047 JFK TWY B BTN K AND L CLSD',
]

const highlights = [
  { title: 'Drag & drop', body: 'Move, resize or hide anything.' },
  { title: 'Multiple airports', body: 'Home base, destination and alternates at once.' },
  {
    title: 'Every calendar',
    body: 'Google, iCloud, Outlook, calendar links or your airline XLSX.',
  },
  { title: 'Not just for pilots', body: 'Forecast, radar, news, stocks, to-dos and photos.' },
]

const labelClass = 'text-[11px] uppercase tracking-[0.14em] text-fg-3'

function MirrorLandscape() {
  const now = useNow()

  return (
    <div
      role="img"
      aria-label="Landscape SkyGlass layout with the time, KJFK weather and METAR, NOTAMs, today's schedule and sun times"
      className="aspect-video min-w-[880px] rounded-[18px] border border-white/12 bg-bezel p-3.5"
    >
      <div
        aria-hidden="true"
        className="grid h-full w-full grid-cols-12 grid-rows-8 gap-[18px] rounded-lg bg-bg p-[3%]"
      >
        <div className="col-span-4 col-start-1 row-span-2 row-start-1 flex flex-col gap-1.5">
          <div className="text-[clamp(40px,5.5vw,76px)] leading-[0.95] font-extralight tracking-[-0.04em]">
            {formatLocal(now)}
          </div>
          <div className="font-mono text-sm text-fg-3">
            {formatZulu(now)} · {formatLongDate(now)}
          </div>
        </div>
        <div className="col-span-4 col-start-9 row-span-1 row-start-1 flex items-center justify-end gap-3.5">
          <div className="font-mono text-[22px]">KJFK</div>
          <div className="badge-vfr px-2.5 py-[3px] text-sm">VFR</div>
        </div>
        <div className="col-span-6 col-start-7 row-span-2 row-start-2 flex flex-col gap-1.5 text-right">
          <div className={labelClass}>METAR</div>
          <div className="font-mono text-sm leading-[1.6] text-white/78">
            KJFK 131856Z 31012KT 10SM FEW250 M02/M14 A3042
          </div>
        </div>
        <div className="col-span-4 col-start-1 row-span-2 row-start-3 grid grid-cols-3 content-start gap-2.5">
          {[
            ['Wind', '310@12'],
            ['Vis', '10SM'],
            ['Temp', '−2°C'],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-[3px]">
              <div className="text-[11px] tracking-[0.12em] text-fg-3 uppercase">{label}</div>
              <div className="font-mono text-lg">{value}</div>
            </div>
          ))}
        </div>
        <div className="col-span-6 col-start-7 row-span-3 row-start-4 flex flex-col items-end gap-2 text-right">
          <div className={labelClass}>NOTAMs</div>
          {notams.map((line) => (
            <div key={line} className="font-mono text-[13px] leading-[1.6] text-white/72">
              {line}
            </div>
          ))}
        </div>
        <div className="col-span-5 col-start-1 row-span-3 row-start-6 flex flex-col justify-end gap-2.5">
          <div className="text-[11px] tracking-[0.14em] text-accent uppercase">Today</div>
          <div className="flex gap-4 text-lg">
            <span className="font-mono text-fg-3">09:00</span>
            <span className="font-light">Sim Session · KATL</span>
          </div>
          <div className="flex gap-4 text-lg">
            <span className="font-mono text-fg-3">14:30</span>
            <span className="font-light">FO Trip · JFK → LAX</span>
          </div>
        </div>
        <div className="col-span-4 col-start-9 row-span-2 row-start-7 flex items-end justify-end gap-7 font-mono text-sm text-white/62">
          <span>SR 07:16</span>
          <span>SS 17:02</span>
          <span>CT 17:33</span>
        </div>
      </div>
    </div>
  )
}

/** "Your layout, your call.": the landscape mirror mock and what the phone app lets you change. */
export function Customization() {
  return (
    <section aria-labelledby="layout-heading" className="flex flex-col gap-8 pb-[120px]">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h2 id="layout-heading" className="display-2 m-0">
          Your layout, your call.
        </h2>
        <p className="m-0 max-w-[420px] text-[15px] leading-[1.6] text-white/62">
          Drag, resize and hide widgets from the phone app and watch the mirror update live.
          Landscape or portrait, 24 widgets to choose from.
        </p>
      </div>
      {/* Scrolls sideways on narrow screens; tabIndex lets keyboard users scroll it. */}
      <div
        className="overflow-x-auto rounded-[18px]"
        tabIndex={0}
        role="region"
        aria-label="Example mirror layout"
      >
        <MirrorLandscape />
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-6 p-0">
        {highlights.map((item) => (
          <li key={item.title} className="flex flex-col gap-1.5">
            <h3 className="m-0 text-base font-medium">{item.title}</h3>
            <p className="m-0 text-sm leading-[1.6] text-white/62">{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
