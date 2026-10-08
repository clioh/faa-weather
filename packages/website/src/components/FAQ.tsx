import { motion } from 'motion/react'
import { useInView } from 'motion/react'
import { useRef, useState } from 'react'

const faqs = [
  {
    question: 'What exactly is SkyGlass?',
    answer: 'SkyGlass is a smart mirror that looks like a regular mirror when idle. When you walk up to it, it detects your presence and displays aviation weather (METAR/TAF), TFRs, NOTAMs, your flight schedule, and more. Step away, and it returns to being just a mirror.',
  },
  {
    question: 'Where does the weather data come from?',
    answer: 'Weather data comes from the Aviation Weather Center (aviationweather.gov), the official source for US aviation weather. Data refreshes automatically and is typically less than 5 minutes old.',
  },
  {
    question: 'How does the face recognition work? Is it private?',
    answer: 'Face recognition runs entirely on-device using the Raspberry Pi. Your face embeddings are stored locally and never leave your home—not to our servers, not to any cloud. You can delete your data anytime through the companion app.',
  },
  {
    question: 'Can I use this for flight planning?',
    answer: 'No. SkyGlass is for awareness and convenience only—it\'s not a replacement for proper flight planning. Always use official sources like 1800wxbrief.com or ForeFlight for actual flight planning and pre-flight briefings.',
  },
  {
    question: 'How hard is it to set up?',
    answer: 'The Complete Kit takes about 30 minutes to assemble—just mount the mirror, connect the Pi, and run through the app setup. The Hardware Kit requires sourcing your own mirror and frame but includes detailed instructions. Software-only is for experienced DIYers.',
  },
  {
    question: 'What size mirror does it use?',
    answer: 'The Complete Kit includes a 24" display with a two-way mirror overlay. If you\'re building your own, any size works—just match your display size to your mirror. Most builders use 20-27" displays.',
  },
  {
    question: 'Can multiple people use it?',
    answer: 'Yes. SkyGlass supports multiple face profiles, each with their own home airports, calendar connections, and widget preferences. It automatically shows the right dashboard when it recognizes you.',
  },
  {
    question: 'Does it work without internet?',
    answer: 'Basic features like time, date, and cached weather work offline. Live weather updates, TFRs, and calendar sync require an internet connection. The mirror itself will always function.',
  },
]

export function FAQ() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <section id="faq" className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-void" />

      <div ref={ref} className="relative z-10 max-w-3xl mx-auto px-6">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-12"
        >
          <h2 className="font-display text-4xl md:text-5xl font-bold text-light mb-4">
            Common <span className="text-gradient-amber">questions</span>
          </h2>
          <p className="text-lg text-muted">
            Everything you need to know about SkyGlass.
          </p>
        </motion.div>

        {/* FAQ items */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="space-y-3"
        >
          {faqs.map((faq, index) => (
            <div
              key={index}
              className="instrument-card overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="w-full p-5 flex items-center justify-between text-left gap-4"
                aria-expanded={openIndex === index}
                aria-controls={`faq-answer-${index}`}
              >
                <span id={`faq-question-${index}`} className="font-display text-light font-medium">
                  {faq.question}
                </span>
                <motion.svg
                  animate={{ rotate: openIndex === index ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="w-5 h-5 text-amber flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </motion.svg>
              </button>
              <motion.div
                id={`faq-answer-${index}`}
                initial={false}
                animate={{
                  height: openIndex === index ? 'auto' : 0,
                  opacity: openIndex === index ? 1 : 0,
                }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
                role="region"
                aria-labelledby={`faq-question-${index}`}
              >
                <div className="px-5 pb-5 pt-0">
                  <div className="h-px bg-border mb-4" />
                  <p className="text-muted leading-relaxed">
                    {faq.answer}
                  </p>
                </div>
              </motion.div>
            </div>
          ))}
        </motion.div>

        {/* Contact CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-12 text-center"
        >
          <p className="text-muted text-sm">
            Still have questions?{' '}
            <a href="mailto:hello@skyglass.dev" className="text-amber hover:underline">
              Reach out
            </a>
          </p>
        </motion.div>
      </div>
    </section>
  )
}
