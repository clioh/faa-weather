import type { ReactNode } from 'react'

interface Feature {
  title: string
  body: string
  icon: ReactNode
}

const features: Feature[] = [
  {
    title: 'Live aviation weather',
    body: 'Real-time METAR and TAF with VFR, MVFR, IFR and LIFR colour coding, straight from aviationweather.gov.',
    icon: <path d="M3 15a4 4 0 0 0 4 4h9a5 5 0 1 0-.1-10A5 5 0 0 0 6.1 11.1 4 4 0 0 0 3 15z" />,
  },
  {
    title: 'TFRs & NOTAMs',
    body: 'Active restrictions and notices for your airports. Critical airspace info, automatically updated.',
    icon: (
      <>
        <path d="M12 3l9 16H3z" />
        <path d="M12 10v4M12 17h0" />
      </>
    ),
  },
  {
    title: 'Your schedule',
    body: 'Google, Outlook, iCloud, CalDAV or a calendar link. Airline pilots can upload their XLSX schedule.',
    icon: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </>
    ),
  },
  {
    title: 'Presence detection',
    body: 'Wakes when you walk up, sleeps when you leave. On-device face recognition — no cloud.',
    icon: (
      <>
        <path d="M2.5 12C4 7.9 7.7 5 12 5s8 2.9 9.5 7c-1.5 4.1-5.2 7-9.5 7s-8-2.9-9.5-7z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  {
    title: 'Sun & moon',
    body: 'Sunrise, sunset, civil twilight and moon phase. Plan your night currency at a glance.',
    icon: <path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 6v3M5.6 10.6l1.8 1.8M18.4 10.6l-1.8 1.8" />,
  },
  {
    title: 'A layout for everyone',
    body: 'Each person in the house gets their own widgets, arranged their way from their phone. The mirror shows yours when it recognizes you.',
    icon: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
        <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3a6.5 6.5 0 0 1 3.5 5.7" />
      </>
    ),
  },
]

export function Features() {
  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className="flex scroll-mt-24 flex-col gap-12 pb-[120px]"
    >
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h2 id="features-heading" className="display-2 m-0 max-w-[640px]">
          Know if you're flying before you finish your coffee.
        </h2>
        <p className="m-0 max-w-[360px] text-[15px] leading-[1.6] text-white/62">
          Black stays invisible behind the glass. Every lit pixel earns its place, and colour only
          ever means something.
        </p>
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-x-10 p-0">
        {features.map((feature) => (
          <li key={feature.title} className="flex gap-[18px] border-t border-line py-7">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="flex-none text-accent"
            >
              {feature.icon}
            </svg>
            <div className="flex flex-col gap-2">
              <h3 className="m-0 text-lg font-medium">{feature.title}</h3>
              <p className="m-0 text-[15px] leading-[1.6] text-white/62">{feature.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
