const steps = [
  {
    title: 'Walk up',
    body: 'The camera detects you and wakes the display in under 500ms. Face recognition loads your personalized dashboard.',
  },
  {
    title: 'Get briefed',
    body: 'Weather, TFRs, NOTAMs, and your schedule — all updated and waiting. No apps to open, no buttons to press.',
  },
  {
    title: 'Walk away',
    body: "Leave, and it goes back to sleep. It's just a mirror again until you need it.",
  },
]

export function HowItWorks() {
  return (
    <section
      id="how"
      aria-labelledby="how-heading"
      className="flex scroll-mt-24 flex-col gap-2 pb-[120px]"
    >
      <h2 id="how-heading" className="eyebrow m-0 pb-4 font-normal">
        How it works
      </h2>
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] border-t border-line p-0">
        {steps.map((step, i) => (
          <li key={step.title} className="flex flex-col gap-3 pt-8 pr-8">
            <div className="font-mono text-xs text-accent" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </div>
            <h3 className="m-0 text-2xl font-light">{step.title}</h3>
            <p className="m-0 text-[15px] leading-[1.6] text-white/62">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
