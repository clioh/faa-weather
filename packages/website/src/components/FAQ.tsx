import { Link } from 'react-router-dom'

const faqs: { question: string; answer: string; link?: { to: string; label: string } }[] = [
  {
    question: 'What exactly is SkyGlass?',
    answer:
      'SkyGlass is a smart mirror that looks like a regular mirror when idle. When you walk up to it, it detects your presence and displays aviation weather (METAR/TAF), TFRs, NOTAMs, your flight schedule, and more. Step away, and it returns to being just a mirror.',
  },
  {
    question: 'Where does the weather data come from?',
    answer:
      'Weather data comes from the Aviation Weather Center (aviationweather.gov), the official source for US aviation weather. Data refreshes automatically and is typically less than 5 minutes old.',
  },
  {
    question: 'How does the face recognition work? Is it private?',
    answer:
      'Face recognition runs entirely on-device using the Raspberry Pi. Your face embeddings are stored locally and never leave your home—not to our servers, not to any cloud. You can delete your data anytime through the companion app.',
  },
  {
    question: 'Can I use this for flight planning?',
    answer:
      "No. SkyGlass is for awareness and convenience only—it's not a replacement for proper flight planning. Always use official sources like 1800wxbrief.com or ForeFlight for actual flight planning and pre-flight briefings.",
  },
  {
    question: 'How hard is it to set up?',
    answer:
      'The Complete Kit takes about 30 minutes to assemble—just mount the mirror, connect the Pi, and run through the app setup. The Hardware Kit requires sourcing your own mirror and frame but includes detailed instructions. The Software License is for experienced DIYers bringing their own Pi, display, and mirror.',
  },
  {
    question: 'What size mirror does it use?',
    answer:
      'The Complete Kit includes a 24" display with a two-way mirror overlay. If you\'re building your own, any size works—just match your display size to your mirror. Most builders use 20-27" displays.',
  },
  {
    question: 'Can multiple people use it?',
    answer:
      'Yes. SkyGlass supports multiple face profiles, each with their own home airports, calendar connections, and widget preferences. It automatically shows the right dashboard when it recognizes you.',
  },
  {
    question: 'How does licensing work?',
    answer:
      'Each mirror needs one SkyGlass license. Kits ship with the license pre-installed, so the mirror activates itself on first boot. If you buy the Software License, we email you a key to enter in the companion app during setup. A license runs one mirror at a time; to move it to a new mirror, release it at skyglass.dev/license (up to 3 times in any 12 months). Reinstalling or re-flashing the same Pi never uses up a license.',
  },
  {
    question: "What's your refund policy?",
    answer:
      'The Software License is fully refundable within 30 days of purchase, no questions asked. Kits can be returned within 30 days of delivery for a full refund of the product price (no restocking fee; return shipping is on us if the kit arrived damaged or defective, or we sent the wrong item). Pre-orders are refundable in full until they ship. Kits also carry a 1-year hardware warranty. A refund revokes the license that came with the purchase. Email support@skyglass.dev with your order number to start.',
    link: { to: '/terms#refunds', label: 'Read the full refund and warranty policy' },
  },
  {
    question: 'Does it work without internet?',
    answer:
      'Basic features like time, date, and cached weather work offline. Live weather updates, TFRs, and calendar sync require an internet connection. The mirror itself will always function, and its license keeps working for 30 days between check-ins.',
  },
]

export function FAQ() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="grid scroll-mt-24 grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-12 pb-[120px]"
    >
      <h2 id="faq-heading" className="display-2 m-0">
        Questions
      </h2>
      <div className="flex flex-col">
        {faqs.map((faq, index) => (
          <details
            key={faq.question}
            open={index === 0}
            className={`group border-t border-line py-3 ${index === faqs.length - 1 ? 'border-b' : ''}`}
          >
            <summary className="flex min-h-11 items-center justify-between gap-4 py-1 text-lg">
              {faq.question}
              <span aria-hidden="true" className="flex-none font-mono text-accent">
                <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">−</span>
              </span>
            </summary>
            <div className="pt-1.5 pb-2.5">
              <p className="m-0 text-[15px] leading-[1.6] text-fg-2">{faq.answer}</p>
              {faq.link && (
                <Link to={faq.link.to} className="link mt-3 inline-block text-sm">
                  {faq.link.label}
                </Link>
              )}
            </div>
          </details>
        ))}
        <p className="m-0 mt-8 text-sm text-fg-3">
          Still have questions?{' '}
          <a href="mailto:hello@skyglass.dev" className="link">
            Reach out
          </a>
        </p>
      </div>
    </section>
  )
}
